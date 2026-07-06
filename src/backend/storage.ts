import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

export const isVercel = process.env.VERCEL === '1' || 
                 !!process.env.VERCEL || 
                 process.env.NOW_REGION !== undefined || 
                 process.env.LAMBDA_TASK_ROOT !== undefined || 
                 process.env.VERCEL_ENV !== undefined ||
                 process.cwd() === '/var/task';
const baseDir = isVercel ? '/tmp' : process.cwd();

export let SANDBOX_DIR = path.resolve(baseDir, 'sandbox');
export let VCS_DIR = path.resolve(SANDBOX_DIR, '.gitclone');

export function setPlaygroundMode(enabled: boolean): void {
  if (enabled) {
    SANDBOX_DIR = path.resolve(baseDir, 'sandbox_playground');
    VCS_DIR = path.resolve(SANDBOX_DIR, '.gitclone');
  } else {
    SANDBOX_DIR = path.resolve(baseDir, 'sandbox');
    VCS_DIR = path.resolve(SANDBOX_DIR, '.gitclone');
  }
}

export interface StagingIndex {
  [filePath: string]: string; // relativePath -> SHA-1 hash
}

export interface Commit {
  id: string;
  message: string;
  author: string;
  timestamp: string; // ISO String
  parent: string | null;
  parent2?: string | null;
  branch: string | null; // branch name or null (if detached)
  snapshot: { [filePath: string]: string }; // relativePath -> SHA-1 hash
}

export interface HEADInfo {
  type: 'branch' | 'commit';
  value: string; // e.g., "main" (branch) or "abc1234..." (commit ID)
}

export interface RepoConfig {
  authorName: string;
  authorEmail: string;
  ignorePatterns: string[];
}

export interface TreeEntry {
  name: string;
  type: 'blob' | 'tree';
  hash: string;
}

// Structured Logging (Requirement 14)
export function logMessage(level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR', message: string): void {
  try {
    if (!fs.existsSync(VCS_DIR)) return;
    const logPath = path.join(VCS_DIR, 'gitclone.log');
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(logPath, logLine, 'utf-8');
  } catch {
    // Silently ignore logging errors during bootstrap
  }
}

// Concurrency Safety Locking Mechanism (Requirement 12)
export function acquireLock(): boolean {
  if (!fs.existsSync(VCS_DIR)) return true;
  const lockPath = path.join(VCS_DIR, 'lock');
  const now = Date.now();
  if (fs.existsSync(lockPath)) {
    try {
      const content = fs.readFileSync(lockPath, 'utf-8').trim();
      const [pidStr, timestampStr] = content.split(':');
      const timestamp = parseInt(timestampStr, 10);
      if (Date.now() - timestamp < 15000) {
        // Lock is active (15s timeout)
        logMessage('WARNING', `Access denied: active lock file held by PID ${pidStr}`);
        return false;
      }
      logMessage('WARNING', `Breaking stale lock file held by PID ${pidStr} (age: ${Date.now() - timestamp}ms)`);
    } catch {
      // parse error: ignore and break
    }
  }
  fs.writeFileSync(lockPath, `${process.pid}:${now}`, 'utf-8');
  return true;
}

export function releaseLock(): void {
  if (!fs.existsSync(VCS_DIR)) return;
  const lockPath = path.join(VCS_DIR, 'lock');
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

// Config management (Requirement 11)
export function readConfig(): RepoConfig {
  const configPath = path.join(VCS_DIR, 'config.json');
  const defaults: RepoConfig = {
    authorName: 'Developer',
    authorEmail: 'developer@gitclone.internal',
    ignorePatterns: ['.gitclone', 'node_modules', '*.log', '.DS_Store', 'dist']
  };
  if (!fs.existsSync(configPath)) {
    return defaults;
  }
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

export function writeConfig(config: Partial<RepoConfig>): void {
  const configPath = path.join(VCS_DIR, 'config.json');
  const current = readConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  logMessage('INFO', `Updated repo config: ${JSON.stringify(config)}`);
}

export function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some(pattern => {
    if (pattern.startsWith('*')) {
      const escaped = pattern.slice(1).replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escaped + '$');
      return regex.test(filePath);
    }
    if (pattern.endsWith('/')) {
      const dir = pattern.slice(0, -1);
      return filePath.split('/').includes(dir);
    }
    return filePath.split('/').includes(pattern) || filePath === pattern;
  });
}

// Low level helpers
export function ensureSandboxExists(): void {
  try {
    if (!fs.existsSync(SANDBOX_DIR)) {
      fs.mkdirSync(SANDBOX_DIR, { recursive: true });
      // Write some initial sample files for the playground
      fs.writeFileSync(path.join(SANDBOX_DIR, 'main.js'), `// Welcome to GitClone sandbox!\nconsole.log("Hello, GitClone!");\n`);
      fs.writeFileSync(path.join(SANDBOX_DIR, 'readme.md'), `# My Sample Project\n\nThis is a sample project managed by GitClone.\nModify files and track changes!\n`);
      const docsDir = path.join(SANDBOX_DIR, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'about.txt'), `GitClone is an elegant, content-addressed VCS.\nWritten in pure TypeScript.\n`);
    }
  } catch (error) {
    console.error('Failed to ensure sandbox exists:', error);
  }
}

export function isRepoInit(): boolean {
  return fs.existsSync(VCS_DIR) && fs.existsSync(path.join(VCS_DIR, 'HEAD'));
}

export function readIndex(): StagingIndex {
  const indexPath = path.join(VCS_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeIndex(index: StagingIndex): void {
  const indexPath = path.join(VCS_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function readHEAD(): HEADInfo | null {
  const headPath = path.join(VCS_DIR, 'HEAD');
  if (!fs.existsSync(headPath)) return null;
  const content = fs.readFileSync(headPath, 'utf-8').trim();
  if (content.startsWith('ref: ')) {
    return { type: 'branch', value: content.substring(5) };
  }
  return { type: 'commit', value: content };
}

export function writeHEAD(type: 'branch' | 'commit', value: string): void {
  const headPath = path.join(VCS_DIR, 'HEAD');
  if (type === 'branch') {
    fs.writeFileSync(headPath, `ref: ${value}\n`, 'utf-8');
  } else {
    fs.writeFileSync(headPath, `${value}\n`, 'utf-8');
  }
}

export function getBranchCommitId(branchName: string): string | null {
  const branchPath = path.join(VCS_DIR, 'branches', branchName);
  if (!fs.existsSync(branchPath)) return null;
  return fs.readFileSync(branchPath, 'utf-8').trim();
}

export function setBranchCommitId(branchName: string, commitId: string): void {
  const branchPath = path.join(VCS_DIR, 'branches', branchName);
  const branchesDir = path.dirname(branchPath);
  if (!fs.existsSync(branchesDir)) {
    fs.mkdirSync(branchesDir, { recursive: true });
  }
  fs.writeFileSync(branchPath, `${commitId}\n`, 'utf-8');
}

export function listBranches(): string[] {
  const branchesDir = path.join(VCS_DIR, 'branches');
  if (!fs.existsSync(branchesDir)) return [];
  return fs.readdirSync(branchesDir).filter(file => {
    return fs.statSync(path.join(branchesDir, file)).isFile();
  });
}

export function deleteBranch(branchName: string): void {
  const branchPath = path.join(VCS_DIR, 'branches', branchName);
  if (fs.existsSync(branchPath)) {
    fs.unlinkSync(branchPath);
  }
}

// Unified Git Object Model (Requirement 1 & 2)
// Every object is compressed and integrity-verified with checksum matches.
export function readObject(hash: string): string | null {
  const objectPath = path.join(VCS_DIR, 'objects', hash);
  if (!fs.existsSync(objectPath)) return null;
  
  try {
    const fileBuffer = fs.readFileSync(objectPath);
    let decompressed: Buffer;
    
    try {
      decompressed = zlib.inflateSync(fileBuffer);
    } catch {
      // Fallback: it's an old uncompressed object (raw blob string)
      const rawContent = fileBuffer.toString('utf-8');
      // Integrity check of raw uncompressed object
      const computedHash = crypto.createHash('sha1').update(rawContent, 'utf-8').digest('hex');
      if (computedHash !== hash) {
        throw new Error(`Integrity error: object content mismatch for hash ${hash}`);
      }
      return rawContent;
    }

    // New format (with type tag header): [type] [size]\u0000[content]
    const nullIndex = decompressed.indexOf(0);
    if (nullIndex !== -1) {
      const header = decompressed.toString('utf-8', 0, nullIndex);
      const parts = header.split(' ');
      if (parts.length === 2 && (parts[0] === 'blob' || parts[0] === 'tree' || parts[0] === 'commit')) {
        const contentStr = decompressed.toString('utf-8', nullIndex + 1);
        
        // Integrity Check: verify hash matches decompressed payload
        const computedHash = crypto.createHash('sha1').update(decompressed).digest('hex');
        if (computedHash !== hash) {
          throw new Error(`Integrity error: object content mismatch for hash ${hash}`);
        }
        return contentStr;
      }
    }

    // fallback decompressed without header
    const plainStr = decompressed.toString('utf-8');
    const computedHash = crypto.createHash('sha1').update(plainStr, 'utf-8').digest('hex');
    if (computedHash !== hash) {
      throw new Error(`Integrity error: object content mismatch for hash ${hash}`);
    }
    return plainStr;
  } catch (error: any) {
    logMessage('ERROR', `readObject failure for ${hash}: ${error.message}`);
    throw error;
  }
}

export function writeObject(hash: string, content: string | Buffer): void {
  const objectsDir = path.join(VCS_DIR, 'objects');
  if (!fs.existsSync(objectsDir)) {
    fs.mkdirSync(objectsDir, { recursive: true });
  }
  
  const objectPath = path.join(objectsDir, hash);
  const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  
  // Compress transparently with zlib.deflateSync
  const compressed = zlib.deflateSync(contentBuffer);
  fs.writeFileSync(objectPath, compressed);
  logMessage('DEBUG', `Wrote object ${hash.substring(0, 7)} (size: ${contentBuffer.length} bytes)`);
}

// High-level object reading layer resolving hash to generic typed object (Requirement 1)
export function readGitObject(hash: string): { type: 'blob' | 'tree' | 'commit'; content: string } | null {
  const objectPath = path.join(VCS_DIR, 'objects', hash);
  if (!fs.existsSync(objectPath)) return null;
  
  try {
    const fileBuffer = fs.readFileSync(objectPath);
    let decompressed: Buffer;
    
    try {
      decompressed = zlib.inflateSync(fileBuffer);
    } catch {
      // Old raw format (always treated as blob)
      const content = fileBuffer.toString('utf-8');
      return { type: 'blob', content };
    }

    const nullIndex = decompressed.indexOf(0);
    if (nullIndex !== -1) {
      const header = decompressed.toString('utf-8', 0, nullIndex);
      const parts = header.split(' ');
      if (parts.length === 2 && (parts[0] === 'blob' || parts[0] === 'tree' || parts[0] === 'commit')) {
        const type = parts[0] as 'blob' | 'tree' | 'commit';
        const content = decompressed.toString('utf-8', nullIndex + 1);
        return { type, content };
      }
    }
    
    return { type: 'blob', content: decompressed.toString('utf-8') };
  } catch {
    return null;
  }
}

// Writes typed object with correct header metadata and zlib compression
export function writeGitObject(type: 'blob' | 'tree' | 'commit', content: string): string {
  const size = Buffer.byteLength(content, 'utf-8');
  const header = `${type} ${size}\u0000`;
  const payload = Buffer.concat([
    Buffer.from(header, 'utf-8'),
    Buffer.from(content, 'utf-8')
  ]);
  const hash = crypto.createHash('sha1').update(payload).digest('hex');
  writeObject(hash, payload);
  return hash;
}

// Three-Object Model recursive bottom-up Tree Builders & Reconstructors (Requirement 1)
export function buildTreeFromFlatIndex(index: StagingIndex): string {
  const buildSubTree = (paths: { relativePath: string; hash: string }[]): string => {
    const files: { name: string; hash: string }[] = [];
    const directories: { [dirName: string]: { relativePath: string; hash: string }[] } = {};

    for (const item of paths) {
      const parts = item.relativePath.split('/');
      if (parts.length === 1) {
        files.push({ name: parts[0], hash: item.hash });
      } else {
        const dirName = parts[0];
        const subPath = parts.slice(1).join('/');
        if (!directories[dirName]) {
          directories[dirName] = [];
        }
        directories[dirName].push({ relativePath: subPath, hash: item.hash });
      }
    }

    const entries: TreeEntry[] = [];

    for (const f of files) {
      entries.push({ name: f.name, type: 'blob', hash: f.hash });
    }

    for (const [dirName, subPaths] of Object.entries(directories)) {
      const subTreeHash = buildSubTree(subPaths);
      entries.push({ name: dirName, type: 'tree', hash: subTreeHash });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    const content = JSON.stringify(entries, null, 2);
    return writeGitObject('tree', content);
  };

  const list = Object.entries(index).map(([relativePath, hash]) => ({ relativePath, hash }));
  return buildSubTree(list);
}

export function reconstructFlatIndexFromTree(treeHash: string): StagingIndex {
  const index: StagingIndex = {};

  const traverseTree = (hash: string, currentPrefix: string) => {
    const obj = readGitObject(hash);
    if (!obj || obj.type !== 'tree') return;

    try {
      const entries: TreeEntry[] = JSON.parse(obj.content);
      for (const entry of entries) {
        const relativePath = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
        if (entry.type === 'blob') {
          index[relativePath] = entry.hash;
        } else if (entry.type === 'tree') {
          traverseTree(entry.hash, relativePath);
        }
      }
    } catch {
      // ignore parsing errors
    }
  };

  traverseTree(treeHash, '');
  return index;
}

export function readCommit(commitId: string): Commit | null {
  // Try reading commit object from objects directory first
  const gitObj = readGitObject(commitId);
  if (gitObj && gitObj.type === 'commit') {
    try {
      const commitData = JSON.parse(gitObj.content);
      const snapshot = reconstructFlatIndexFromTree(commitData.tree);
      return {
        id: commitId,
        message: commitData.message,
        author: commitData.author,
        timestamp: commitData.timestamp,
        parent: commitData.parent,
        parent2: commitData.parent2 || null,
        branch: commitData.branch || null,
        snapshot
      };
    } catch {
      // fallback to commits/json
    }
  }

  // Fallback to commits folder for backward compatibility
  const commitPath = path.join(VCS_DIR, 'commits', `${commitId}.json`);
  if (!fs.existsSync(commitPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(commitPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeCommit(commitId: string, commit: Commit): void {
  // 1. Build and write bottom-up trees for the commit snapshot
  const rootTreeHash = buildTreeFromFlatIndex(commit.snapshot);

  // 2. Write commit object into objects folder
  const commitContent = JSON.stringify({
    tree: rootTreeHash,
    parent: commit.parent,
    parent2: (commit as any).parent2 || null,
    author: commit.author,
    timestamp: commit.timestamp,
    message: commit.message,
    branch: commit.branch
  }, null, 2);
  
  const objHash = writeGitObject('commit', commitContent);
  logMessage('INFO', `Wrote commit object ${objHash} with tree ${rootTreeHash}`);

  // 3. Write legacy JSON commit file for 100% fail-safe backward compatibility
  const commitsDir = path.join(VCS_DIR, 'commits');
  if (!fs.existsSync(commitsDir)) {
    fs.mkdirSync(commitsDir, { recursive: true });
  }
  const commitLegacyPath = path.join(commitsDir, `${commitId}.json`);
  fs.writeFileSync(commitLegacyPath, JSON.stringify(commit, null, 2), 'utf-8');
}

export function countObjects(): number {
  const objectsDir = path.join(VCS_DIR, 'objects');
  if (!fs.existsSync(objectsDir)) return 0;
  return fs.readdirSync(objectsDir).length;
}

export interface WorkingFile {
  relativePath: string;
  content: string;
}

export function getWorkingFiles(dir: string = SANDBOX_DIR): WorkingFile[] {
  const results: WorkingFile[] = [];
  if (!fs.existsSync(dir)) return [];
  const config = readConfig();

  function traverse(currentDir: string) {
    const list = fs.readdirSync(currentDir);
    for (const file of list) {
      const fullPath = path.join(currentDir, file);
      const stat = fs.statSync(fullPath);
      
      const relativePath = path.relative(SANDBOX_DIR, fullPath);
      if (isIgnored(relativePath, config.ignorePatterns)) {
        continue;
      }
      
      if (stat && stat.isDirectory()) {
        traverse(fullPath);
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          results.push({ relativePath, content });
        } catch {
          // ignore
        }
      }
    }
  }

  traverse(dir);
  return results;
}

export function writeSandboxFile(relativePath: string, content: string): void {
  const fullPath = path.join(SANDBOX_DIR, relativePath);
  const parentDir = path.dirname(fullPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf-8');
}

export function deleteSandboxFile(relativePath: string): void {
  const fullPath = path.join(SANDBOX_DIR, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    let parentDir = path.dirname(fullPath);
    while (parentDir !== SANDBOX_DIR) {
      if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
        parentDir = path.dirname(parentDir);
      } else {
        break;
      }
    }
  }
}
