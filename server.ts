import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import AdmZip from 'adm-zip';

// Import our modular VCS backend code
import {
  ensureSandboxExists,
  isRepoInit,
  readIndex,
  readHEAD,
  listBranches,
  getBranchCommitId,
  countObjects,
  writeSandboxFile,
  deleteSandboxFile,
  readCommit,
  readObject,
  VCS_DIR,
  acquireLock,
  releaseLock,
  readConfig,
  writeConfig,
  logMessage,
  setPlaygroundMode,
  SANDBOX_DIR
} from './src/backend/storage';
import { initRepo } from './src/backend/init';
import { getRepoStatus } from './src/backend/status';
import { trackFiles, commitChanges, getHistory, getAllCommits } from './src/backend/commit';
import { createBranch, removeBranch } from './src/backend/branch';
import { checkoutTarget } from './src/backend/checkout';
import { computeLineDiff } from './src/backend/diff';
import { attemptMerge, completeMerge } from './src/backend/merge';

// Phase 2 + Advanced modular imports
import { listTags, createTag, deleteTag, checkoutTag } from './src/backend/tags';
import { readStashes, saveStash, applyStash, dropStash } from './src/backend/stash';
import { readReflog, resetToCommit } from './src/backend/reflog';
import { getFileBlame } from './src/backend/blame';
import { cherryPick, rebaseBranch } from './src/backend/cherry_pick';
import { checkIntegrity, runGarbageCollection } from './src/backend/integrity';
import { generateBranchyResponse, generateBranchyResponseStream } from './src/backend/companion';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
  app.use(express.json());

  // --- Simple Server-Side Session Auth ---
  const sessionStore = new Map<string, { username: string; expires: number }>();

  const getSessionCookie = (req: express.Request): string | null => {
    // 1. Check Authorization Header (Bearer Token)
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    // 2. Check Custom Header
    const tokenHeader = req.headers['x-session-token'];
    if (tokenHeader && typeof tokenHeader === 'string') {
      return tokenHeader;
    }

    // 3. Fallback to Cookie
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const match = cookieHeader.match(/gc_session_token=([^;]+)/);
    return match ? match[1] : null;
  };

  const getAuthConfig = () => {
    const defaultUsers = {
      users: [
        { username: 'developer', password: 'password123' },
        { username: 'admin', password: 'adminpassword' }
      ]
    };
    try {
      const configPath = path.resolve(process.cwd(), 'auth-config.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to read auth-config.json', e);
    }
    return defaultUsers;
  };

  // Auth Middleware
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Allow public auth endpoints and health check
    const isAuthPath = req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/') || req.path.includes('/auth/');
    const isHealthPath = req.path === '/health' || req.path === '/api/health' || req.path.endsWith('/health');
    const isPlayground = req.headers['x-is-playground'] === 'true' || req.query.playground === 'true';
    
    if (isPlayground || isAuthPath || isHealthPath) {
      return next();
    }
    
    const token = getSessionCookie(req);
    if (!token) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    
    const session = sessionStore.get(token);
    if (!session || session.expires < Date.now()) {
      if (session) sessionStore.delete(token); // clean up expired
      res.status(401).json({ success: false, message: 'Session expired or invalid' });
      return;
    }
    
    // Extend session expiry on activity (2 hours)
    session.expires = Date.now() + 2 * 60 * 60 * 1000;
    next();
  };

  // Register Playground context middleware FIRST
  app.use('/api', (req, res, next) => {
    const isPlayground = req.headers['x-is-playground'] === 'true' || req.query.playground === 'true';
    setPlaygroundMode(isPlayground);
    ensureSandboxExists();
    next();
  });

  // Register Auth check middleware for all /api/* requests
  app.use('/api', requireAuth);

  // Authentication Endpoints
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Username and password are required' });
      return;
    }
    
    const authConfig = getAuthConfig();
    const user = authConfig.users.find(
      (u: any) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
    );
    
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid username or password' });
      return;
    }
    
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expires = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
    
    sessionStore.set(token, { username: user.username, expires });
    
    res.setHeader('Set-Cookie', `gc_session_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200`);
    res.json({ success: true, username: user.username, token });
  });

  app.get('/api/auth/session', (req, res) => {
    const token = getSessionCookie(req);
    if (!token) {
      res.json({ success: false, message: 'No active session' });
      return;
    }
    
    const session = sessionStore.get(token);
    if (!session || session.expires < Date.now()) {
      if (session) sessionStore.delete(token);
      res.json({ success: false, message: 'Session expired or invalid' });
      return;
    }
    
    res.json({ success: true, username: session.username });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = getSessionCookie(req);
    if (token) {
      sessionStore.delete(token);
    }
    res.setHeader('Set-Cookie', `gc_session_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // Concurrency Safe Locking Middleware (Requirement 12)
  const stateMutatingLock = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!acquireLock()) {
      logMessage('WARNING', `Concurrency lock active. Blocked request: ${req.method} ${req.path}`);
      res.status(409).json({
        success: false,
        message: 'The repository is currently locked by another background process. Please try again shortly.'
      });
      return;
    }

    const release = () => {
      releaseLock();
    };

    res.on('finish', release);
    res.on('close', release);

    next();
  };

  // Ensure the sandbox folder with sample files is created at startup
  ensureSandboxExists();

  // ==================== API ENDPOINTS ====================

  // 1. Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 2. Initialize repo
  app.post('/api/init', stateMutatingLock, (req, res) => {
    const result = initRepo();
    res.json(result);
  });

  // 3. Get repo status
  app.get('/api/status', (req, res) => {
    try {
      const status = getRepoStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 3b. Companion chat endpoint with Branchy the Fox
  app.post('/api/companion/chat', async (req, res) => {
    try {
      const { message, history, context } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required' });
      }
      const responseText = await generateBranchyResponse(message, history || [], context);
      res.json({ success: true, text: responseText });
    } catch (error: any) {
      console.error('Error in /api/companion/chat endpoint:', error);
      res.status(500).json({ success: false, message: error.message || 'Companion error occurred' });
    }
  });

  // 3c. Companion chat streaming endpoint with Branchy the Fox
  app.post('/api/companion/chat-stream', async (req, res) => {
    try {
      const { message, history, context } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required' });
      }

      // Set headers for streaming text chunk response
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const generator = generateBranchyResponseStream(message, history || [], context);
      for await (const chunk of generator) {
        res.write(chunk);
      }
      res.end();
    } catch (error: any) {
      console.error('Error in /api/companion/chat-stream endpoint:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: error.message || 'Companion streaming error occurred' });
      } else {
        res.end();
      }
    }
  });

  // 4. Sandbox file management (playground)
  // List files currently in the sandbox on-disk
  app.get('/api/sandbox/files', (req, res) => {
    try {
      const results: { relativePath: string; content: string; size: number }[] = [];
      const traverse = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (file === '.gitclone') continue;
          if (stat.isDirectory()) {
            traverse(fullPath);
          } else {
            const relPath = path.relative(SANDBOX_DIR, fullPath);
            const content = fs.readFileSync(fullPath, 'utf-8');
            results.push({ relativePath: relPath, content, size: stat.size });
          }
        }
      };
      traverse(SANDBOX_DIR);
      res.json({ success: true, files: results });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Read single sandbox file
  app.get('/api/sandbox/file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'Path is required' });
      return;
    }
    try {
      const fullPath = path.join(SANDBOX_DIR, filePath);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ success: false, message: 'File not found' });
        return;
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ success: true, relativePath: filePath, content });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Create or update sandbox file
  app.post('/api/sandbox/file', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'Path is required' });
      return;
    }
    try {
      writeSandboxFile(filePath, content || '');
      res.json({ success: true, message: `Saved file "${filePath}"` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Delete sandbox file
  app.delete('/api/sandbox/file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'Path is required' });
      return;
    }
    try {
      const fullPath = path.join(SANDBOX_DIR, filePath);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ success: false, message: 'File not found' });
        return;
      }
      deleteSandboxFile(filePath);
      res.json({ success: true, message: `Deleted file "${filePath}"` });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 5. Track files (Stage)
  app.post('/api/track', stateMutatingLock, (req, res) => {
    const { path: filePath } = req.body; // if empty, stages all changed files
    const result = trackFiles(filePath);
    res.json(result);
  });

  // 6. Commit changes
  app.post('/api/commit', stateMutatingLock, (req, res) => {
    const { message, author } = req.body;
    const result = commitChanges(message, author);
    res.json(result);
  });

  // 7. Branch management
  app.get('/api/branches', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.json({ success: false, message: 'Repository not initialized', branches: [] });
        return;
      }
      const branches = listBranches().map(name => {
        return {
          name,
          latestCommitId: getBranchCommitId(name)
        };
      });
      res.json({ success: true, branches });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/branch', stateMutatingLock, (req, res) => {
    const { name } = req.body;
    const result = createBranch(name);
    res.json(result);
  });

  app.delete('/api/branch', stateMutatingLock, (req, res) => {
    const name = req.query.name as string;
    const result = removeBranch(name);
    res.json(result);
  });

  // Merge operations (Conflict Resolution Feature)
  app.post('/api/merge', stateMutatingLock, (req, res) => {
    const { targetBranch } = req.body;
    if (!targetBranch) {
      res.status(400).json({ success: false, message: 'Target branch is required for merge.' });
      return;
    }
    const result = attemptMerge(targetBranch);
    res.json(result);
  });

  app.post('/api/merge/complete', stateMutatingLock, (req, res) => {
    const { message, author, parentCommitId, parent2CommitId } = req.body;
    if (!message || !parentCommitId || !parent2CommitId) {
      res.status(400).json({ success: false, message: 'Message, parentCommitId and parent2CommitId are required.' });
      return;
    }
    const result = completeMerge(message, author, parentCommitId, parent2CommitId);
    res.json(result);
  });

  // 8. Commit history & Search (Linear history + full search with pagination)
  app.get('/api/history', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.json({ success: false, history: [] });
        return;
      }
      const head = readHEAD();
      if (!head) {
        res.json({ success: false, history: [] });
        return;
      }
      let baseCommitId: string | null = null;
      if (head.type === 'branch') {
        baseCommitId = getBranchCommitId(head.value);
      } else {
        baseCommitId = head.value;
      }
      const history = getHistory(baseCommitId);
      
      // Pagination implementation (Requirement 15)
      const page = parseInt(req.query.page as string || '1', 10);
      const limit = parseInt(req.query.limit as string || '10', 10);
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      const paginated = history.slice(startIndex, endIndex);

      res.json({
        success: true,
        history: paginated,
        total: history.length,
        page,
        limit,
        totalPages: Math.ceil(history.length / limit)
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Search across ALL commits in the system (Phase 10 with pagination)
  app.get('/api/commits/search', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.json({ success: false, commits: [] });
        return;
      }
      const query = (req.query.q as string || '').toLowerCase();
      const dateStart = req.query.start as string;
      const dateEnd = req.query.end as string;
      const branchName = req.query.branch as string;

      let allCommits = getAllCommits();

      // Filter by text search (commit ID or message or author)
      if (query) {
        allCommits = allCommits.filter(c => {
          return (
            c.id.toLowerCase().includes(query) ||
            c.message.toLowerCase().includes(query) ||
            c.author.toLowerCase().includes(query)
          );
        });
      }

      // Filter by branch
      if (branchName) {
        allCommits = allCommits.filter(c => c.branch === branchName);
      }

      // Filter by date range
      if (dateStart) {
        const startMs = new Date(dateStart).getTime();
        allCommits = allCommits.filter(c => new Date(c.timestamp).getTime() >= startMs);
      }
      if (dateEnd) {
        const endMs = new Date(dateEnd).getTime();
        allCommits = allCommits.filter(c => new Date(c.timestamp).getTime() <= endMs);
      }

      // Pagination implementation (Requirement 15)
      const page = parseInt(req.query.page as string || '1', 10);
      const limit = parseInt(req.query.limit as string || '10', 10);
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;
      const paginated = allCommits.slice(startIndex, endIndex);

      res.json({
        success: true,
        commits: paginated,
        total: allCommits.length,
        page,
        limit,
        totalPages: Math.ceil(allCommits.length / limit)
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 9. Checkout (Switch branch or specific commit)
  app.post('/api/checkout', stateMutatingLock, (req, res) => {
    const { target, force } = req.body;
    const result = checkoutTarget(target, force);
    res.json(result);
  });

  // ==================== NEW ADVANCED VCS ENDPOINTS ====================

  // Tags endpoints (Requirement 4)
  app.get('/api/tags', (req, res) => {
    try {
      res.json({ success: true, tags: listTags() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/tags/create', stateMutatingLock, (req, res) => {
    const { name, commitId } = req.body;
    if (!name || !commitId) {
      res.status(400).json({ success: false, message: 'Tag name and commit ID are required.' });
      return;
    }
    const result = createTag(name, commitId);
    res.json(result);
  });

  app.delete('/api/tags/delete', stateMutatingLock, (req, res) => {
    const name = req.query.name as string;
    if (!name) {
      res.status(400).json({ success: false, message: 'Tag name is required.' });
      return;
    }
    const result = deleteTag(name);
    res.json(result);
  });

  app.post('/api/tags/checkout', stateMutatingLock, (req, res) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: 'Tag name is required.' });
      return;
    }
    const result = checkoutTag(name);
    res.json(result);
  });

  // Stash endpoints (Requirement 5)
  app.get('/api/stash', (req, res) => {
    try {
      res.json({ success: true, stashes: readStashes() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/stash/save', stateMutatingLock, (req, res) => {
    const { message } = req.body;
    const result = saveStash(message);
    res.json(result);
  });

  app.post('/api/stash/apply', stateMutatingLock, (req, res) => {
    const { id } = req.body;
    if (!id) {
      res.status(400).json({ success: false, message: 'Stash ID is required.' });
      return;
    }
    const result = applyStash(id);
    res.json(result);
  });

  app.delete('/api/stash/drop', stateMutatingLock, (req, res) => {
    const id = req.query.id as string;
    if (!id) {
      res.status(400).json({ success: false, message: 'Stash ID is required.' });
      return;
    }
    const result = dropStash(id);
    res.json(result);
  });

  // Reflog endpoints (Requirement 8)
  app.get('/api/reflog', (req, res) => {
    try {
      res.json({ success: true, reflog: readReflog() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/reflog/reset', stateMutatingLock, (req, res) => {
    const { commitId } = req.body;
    if (!commitId) {
      res.status(400).json({ success: false, message: 'Commit ID is required.' });
      return;
    }
    const result = resetToCommit(commitId);
    res.json(result);
  });

  // Blame endpoint (Requirement 9)
  app.get('/api/blame', (req, res) => {
    const filePath = req.query.path as string;
    const commitId = req.query.commitId as string;
    if (!filePath || !commitId) {
      res.status(400).json({ success: false, message: 'Both file path and starting commit ID are required.' });
      return;
    }
    try {
      const blame = getFileBlame(filePath, commitId);
      if (blame === null) {
        res.status(404).json({ success: false, message: `No blame info found for "${filePath}" in commit "${commitId}"` });
      } else {
        res.json({ success: true, blame });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Cherry-pick & Rebase (Requirement 7)
  app.post('/api/cherry-pick', stateMutatingLock, (req, res) => {
    const { commitId, author } = req.body;
    if (!commitId) {
      res.status(400).json({ success: false, message: 'Commit ID is required for cherry-pick.' });
      return;
    }
    const result = cherryPick(commitId, author);
    res.json(result);
  });

  app.post('/api/rebase', stateMutatingLock, (req, res) => {
    const { sourceBranch, targetBranch, author } = req.body;
    if (!sourceBranch || !targetBranch) {
      res.status(400).json({ success: false, message: 'Both source and target branches are required for rebase.' });
      return;
    }
    const result = rebaseBranch(sourceBranch, targetBranch, author);
    res.json(result);
  });

  // Repository configuration (Requirement 11)
  app.get('/api/config', (req, res) => {
    try {
      res.json({ success: true, config: readConfig() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/config', stateMutatingLock, (req, res) => {
    const { userName, userEmail, ignorePatterns } = req.body;
    try {
      writeConfig({
        authorName: userName || 'Developer',
        authorEmail: userEmail || 'developer@gitclone.internal',
        ignorePatterns: ignorePatterns || []
      });
      res.json({ success: true, message: 'Configuration saved successfully.' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Diagnostics & Integrity checks (Requirement 10 & 13)
  app.get('/api/integrity-check', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.json({ success: false, message: 'Repository not initialized.' });
        return;
      }
      const report = checkIntegrity();
      res.json({ success: true, report });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/gc', stateMutatingLock, (req, res) => {
    const { dryRun } = req.body;
    try {
      if (!isRepoInit()) {
        res.json({ success: false, message: 'Repository not initialized.' });
        return;
      }
      const result = runGarbageCollection(dryRun === true);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 10. File diffing (staged vs committed, or commit A vs commit B)
  app.get('/api/diff', (req, res) => {
    const filePath = req.query.path as string;
    const commitA = req.query.commitA as string; // previous
    const commitB = req.query.commitB as string; // current (if empty, we can compare staged or working)
    const mode = req.query.mode as string; // 'staged_vs_committed' or 'working_vs_staged' or 'commit_vs_commit'

    if (!filePath) {
      res.status(400).json({ success: false, message: 'File path is required.' });
      return;
    }

    try {
      let textA: string | null = null;
      let textB: string | null = null;

      if (mode === 'commit_vs_commit') {
        // Compare same file across two specific commits
        if (!commitA || !commitB) {
          res.status(400).json({ success: false, message: 'Both commitA and commitB parameters are required for commit comparison mode.' });
          return;
        }
        const cA = readCommit(commitA);
        const cB = readCommit(commitB);
        const hashA = cA?.snapshot[filePath];
        const hashB = cB?.snapshot[filePath];
        textA = hashA ? readObject(hashA) : '';
        textB = hashB ? readObject(hashB) : '';
      } else if (mode === 'staged_vs_committed') {
        // Compare staged index vs last committed snapshot
        const head = readHEAD();
        let commitId: string | null = null;
        if (head) {
          commitId = head.type === 'branch' ? getBranchCommitId(head.value) : head.value;
        }
        const baseCommit = commitId ? readCommit(commitId) : null;
        const committedHash = baseCommit?.snapshot[filePath];
        const index = readIndex();
        const stagedHash = index[filePath];

        textA = committedHash ? readObject(committedHash) : '';
        textB = stagedHash ? readObject(stagedHash) : '';
      } else {
        // Default: working on-disk file vs staged index
        const index = readIndex();
        const stagedHash = index[filePath];
        textA = stagedHash ? readObject(stagedHash) : '';

        const fullPath = path.join(path.resolve(process.cwd(), 'sandbox'), filePath);
        if (fs.existsSync(fullPath)) {
          textB = fs.readFileSync(fullPath, 'utf-8');
        } else {
          textB = null; // deleted on disk
        }
      }

      const diffLines = computeLineDiff(textA, textB);
      res.json({ success: true, diff: diffLines });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 11. Debug / Internals Inspection
  app.get('/api/internals', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.json({ success: false, message: 'Repository not initialized' });
        return;
      }
      const head = readHEAD();
      const index = readIndex();
      const objectCount = countObjects();
      res.json({
        success: true,
        head,
        index,
        objectCount
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // 12. Export entire .gitclone repository as ZIP
  app.get('/api/export', (req, res) => {
    try {
      if (!isRepoInit()) {
        res.status(400).json({ success: false, message: 'Repository is not initialized.' });
        return;
      }

      const zip = new AdmZip();
      // Add the entire .gitclone directory as a local folder under the name ".gitclone"
      zip.addLocalFolder(VCS_DIR, '.gitclone');

      const zipBuffer = zip.toBuffer();

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename=gitclone-repository.zip');
      res.send(zipBuffer);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================== UNDO-REDO, COMPARISON, AI AND PLAYGROUND ENDPOINTS ====================

  // Get current state snapshot for Undo/Redo
  app.get('/api/undo-redo/snapshot', (req, res) => {
    try {
      const headPath = path.join(VCS_DIR, 'HEAD');
      const head = fs.existsSync(headPath) ? fs.readFileSync(headPath, 'utf-8') : '';

      const indexPath = path.join(VCS_DIR, 'index.json');
      const index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '{}';

      const branches: { [name: string]: string } = {};
      const branchesDir = path.join(VCS_DIR, 'branches');
      if (fs.existsSync(branchesDir)) {
        const files = fs.readdirSync(branchesDir);
        for (const file of files) {
          if (fs.statSync(path.join(branchesDir, file)).isFile()) {
            branches[file] = fs.readFileSync(path.join(branchesDir, file), 'utf-8').trim();
          }
        }
      }

      const sandbox: { [filePath: string]: string } = {};
      const traverse = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          if (file === '.gitclone') continue;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            traverse(fullPath);
          } else {
            const relPath = path.relative(SANDBOX_DIR, fullPath);
            sandbox[relPath] = fs.readFileSync(fullPath, 'utf-8');
          }
        }
      };
      traverse(SANDBOX_DIR);

      res.json({ success: true, snapshot: { head, index, branches, sandbox } });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Restore snapshots for Undo/Redo
  app.post('/api/undo-redo/restore', (req, res) => {
    const { snapshot } = req.body;
    if (!snapshot) {
      res.status(400).json({ success: false, message: 'Snapshot is required.' });
      return;
    }
    try {
      const { head, index, branches, sandbox } = snapshot;

      if (!fs.existsSync(VCS_DIR)) {
        fs.mkdirSync(VCS_DIR, { recursive: true });
      }

      fs.writeFileSync(path.join(VCS_DIR, 'HEAD'), head, 'utf-8');
      fs.writeFileSync(path.join(VCS_DIR, 'index.json'), index, 'utf-8');

      const branchesDir = path.join(VCS_DIR, 'branches');
      if (fs.existsSync(branchesDir)) {
        fs.rmSync(branchesDir, { recursive: true, force: true });
      }
      fs.mkdirSync(branchesDir, { recursive: true });
      for (const name of Object.keys(branches)) {
        fs.writeFileSync(path.join(branchesDir, name), branches[name] + '\n', 'utf-8');
      }

      const clearSandbox = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const fullPath = path.join(dir, file);
          if (file === '.gitclone') continue;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            clearSandbox(fullPath);
            try {
              if (fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
              }
            } catch {}
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      };
      clearSandbox(SANDBOX_DIR);

      for (const relPath of Object.keys(sandbox)) {
        const fullPath = path.join(SANDBOX_DIR, relPath);
        const fileDir = path.dirname(fullPath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(fullPath, sandbox[relPath], 'utf-8');
      }

      res.json({ success: true, message: 'State restored successfully.' });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Compare two branches to find unique commits in each
  app.get('/api/branches/compare', (req, res) => {
    const branchA = req.query.branchA as string;
    const branchB = req.query.branchB as string;

    if (!branchA || !branchB) {
      res.status(400).json({ success: false, message: 'Both branchA and branchB are required.' });
      return;
    }

    try {
      const commitAId = getBranchCommitId(branchA);
      const commitBId = getBranchCommitId(branchB);

      const getAncestors = (startId: string | null): Set<string> => {
        const ancestors = new Set<string>();
        const queue = startId ? [startId] : [];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (ancestors.has(id)) continue;
          ancestors.add(id);
          const commit = readCommit(id);
          if (commit) {
            if (commit.parent) queue.push(commit.parent);
            if (commit.parent2) queue.push(commit.parent2);
          }
        }
        return ancestors;
      };

      const ancestorsA = getAncestors(commitAId);
      const ancestorsB = getAncestors(commitBId);

      const uniqueToAIds = [...ancestorsA].filter(id => !ancestorsB.has(id));
      const uniqueToBIds = [...ancestorsB].filter(id => !ancestorsA.has(id));

      const uniqueToA = uniqueToAIds.map(readCommit).filter(Boolean);
      const uniqueToB = uniqueToBIds.map(readCommit).filter(Boolean);

      uniqueToA.sort((x: any, y: any) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
      uniqueToB.sort((x: any, y: any) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());

      res.json({
        success: true,
        uniqueToA,
        uniqueToB
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // AI-Assisted Commit Message Generator
  app.post('/api/ai/suggest-commit', (req, res) => {
    try {
      const index = readIndex();
      const files = Object.keys(index);
      if (files.length === 0) {
        res.json({ success: true, suggestion: 'chore: update repository files' });
        return;
      }

      // Procedural fallback that is fast, safe, and highly relevant:
      const featKeywords = ['add', 'create', 'new', 'feat', 'feature', 'component', 'view', 'page'];
      const fixKeywords = ['bug', 'fix', 'leak', 'issue', 'patch', 'error', 'resolve'];

      let suggestion = '';
      const mainFile = files[0];
      const isFix = files.some(f => fixKeywords.some(kw => f.toLowerCase().includes(kw)));
      const isFeat = files.some(f => featKeywords.some(kw => f.toLowerCase().includes(kw)));

      if (isFix) {
        suggestion = `fix: resolve bugs and patch issues in ${mainFile}`;
      } else if (isFeat) {
        suggestion = `feat: implement core modules and introduce ${mainFile}`;
      } else if (mainFile.endsWith('.md')) {
        suggestion = `docs: update documentation for ${mainFile}`;
      } else {
        suggestion = `refactor: optimize structures and refine ${mainFile}`;
      }

      res.json({ success: true, suggestion });
    } catch (e: any) {
      res.json({ success: true, suggestion: 'chore: update project assets' });
    }
  });

  // Reset Playground Repository
  app.post('/api/playground/reset', (req, res) => {
    try {
      const playgroundDir = path.resolve(process.cwd(), 'sandbox_playground');
      if (fs.existsSync(playgroundDir)) {
        fs.rmSync(playgroundDir, { recursive: true, force: true });
      }
      setPlaygroundMode(true);
      ensureSandboxExists();
      res.json({ success: true, message: 'Playground repository has been reset.' });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Trigger playground conflict automatically
  app.post('/api/playground/trigger-conflict', stateMutatingLock, (req, res) => {
    try {
      // Ensure playground mode is set
      setPlaygroundMode(true);
      ensureSandboxExists();
      initRepo(); // Ensure repo is initialized

      // 1. Force checkout main
      checkoutTarget('main', true);

      // 2. Write original file on main
      writeSandboxFile('index.js', '// Original Line\nconsole.log("Original value");\n');
      trackFiles('index.js');
      commitChanges('feat: add original console log', 'Developer <developer@gitclone.internal>');

      // 3. Create feature branch and switch to it
      createBranch('conflict-demo');
      checkoutTarget('conflict-demo', true);

      // 4. Modify file on feature branch
      writeSandboxFile('index.js', '// Changed on conflict-demo branch\nconsole.log("Demo incoming changes");\n');
      trackFiles('index.js');
      commitChanges('feat: modify console log in feature branch', 'Developer <developer@gitclone.internal>');

      // 5. Checkout main and modify same lines
      checkoutTarget('main', true);
      writeSandboxFile('index.js', '// Changed on main branch\nconsole.log("Main current changes");\n');
      trackFiles('index.js');
      commitChanges('feat: modify console log in main branch', 'Developer <developer@gitclone.internal>');

      // 6. Merge feature branch into main
      const mergeRes = attemptMerge('conflict-demo');

      res.json({
        success: true,
        message: 'Merge conflict triggered successfully on index.js! Go to the Conflicts tab to resolve it.',
        mergeResult: mergeRes
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ==================== VITE AND STATIC ASSETS ====================

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({
      success: false,
      message: err?.message || 'An internal server error occurred',
      stack: process.env.NODE_ENV !== 'production' || process.env.VERCEL === '1' ? err?.stack : undefined
    });
  });

  async function bootstrap() {
    if (process.env.VERCEL !== '1') {
      if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: 'spa'
        });
        app.use(vite.middlewares);
      } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      }

      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

  bootstrap();

export default app;
