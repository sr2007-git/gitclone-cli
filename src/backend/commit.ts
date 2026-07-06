import fs from 'fs';
import path from 'path';
import {
  readIndex,
  writeIndex,
  readHEAD,
  writeHEAD,
  getBranchCommitId,
  setBranchCommitId,
  readCommit,
  writeCommit,
  writeObject,
  getWorkingFiles,
  SANDBOX_DIR,
  Commit,
  VCS_DIR,
  writeGitObject,
  buildTreeFromFlatIndex,
  readConfig,
  isIgnored,
  logMessage
} from './storage';
import { computeSHA1 } from './hash';
import crypto from 'crypto';
import { appendReflog } from './reflog';

// Phase 2: Track specific file or all files
export function trackFiles(specificPath?: string): { success: boolean; message: string; tracked: { path: string; hash: string }[] } {
  try {
    const index = readIndex();
    const tracked: { path: string; hash: string }[] = [];
    const config = readConfig();

    if (specificPath) {
      if (isIgnored(specificPath, config.ignorePatterns)) {
        return {
          success: false,
          message: `File matches ignore patterns and cannot be tracked: ${specificPath}`,
          tracked: []
        };
      }
      // Track a single file
      const fullPath = path.join(SANDBOX_DIR, specificPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const hash = writeGitObject('blob', content);
        index[specificPath] = hash;
        tracked.push({ path: specificPath, hash });
      } else {
        // If file doesn't exist, we assume it's a deletion and untrack it
        if (specificPath in index) {
          delete index[specificPath];
          tracked.push({ path: specificPath, hash: 'DELETED' });
        } else {
          return {
            success: false,
            message: `File not found on disk: ${specificPath}`,
            tracked: []
          };
        }
      }
    } else {
      // Track all changed/new/deleted files ("git add .")
      const workingFiles = getWorkingFiles();
      const workingPaths = new Set<string>();

      // Track active files
      for (const file of workingFiles) {
        workingPaths.add(file.relativePath);
        const hash = writeGitObject('blob', file.content);
        
        // Only report if it's new or modified compared to index
        if (index[file.relativePath] !== hash) {
          index[file.relativePath] = hash;
          tracked.push({ path: file.relativePath, hash });
        } else {
          // If already in index with same hash, we still keep it in index (it's tracked)
          index[file.relativePath] = hash;
        }
      }

      // Track deletions: if a file was in index but no longer exists on disk, remove it from index
      for (const indexedPath of Object.keys(index)) {
        if (!workingPaths.has(indexedPath)) {
          delete index[indexedPath];
          tracked.push({ path: indexedPath, hash: 'DELETED' });
        }
      }
    }

    writeIndex(index);
    logMessage('INFO', `Tracked changes for ${tracked.length} file(s)`);
    return {
      success: true,
      message: tracked.length > 0
        ? `Successfully tracked changes in ${tracked.length} file(s).`
        : 'No modifications to track. Staging index is up-to-date.',
      tracked
    };
  } catch (error: any) {
    logMessage('ERROR', `Failed to track files: ${error.message}`);
    return {
      success: false,
      message: `Failed to track files: ${error.message}`,
      tracked: []
    };
  }
}

// Phase 3: Committing
export function commitChanges(message: string, author: string, parent2CommitId: string | null = null): { success: boolean; message: string; commit?: Commit } {
  if (!message || message.trim() === '') {
    return { success: false, message: 'Commit message cannot be empty.' };
  }

  try {
    const index = readIndex();
    const head = readHEAD();

    if (!head) {
      return { success: false, message: 'Repository is not initialized.' };
    }

    // Determine current parent commit
    let parentId: string | null = null;
    if (head.type === 'branch') {
      parentId = getBranchCommitId(head.value);
    } else {
      parentId = head.value;
    }

    // Get previous snapshot if parent exists
    let parentSnapshot: { [filePath: string]: string } = {};
    if (parentId) {
      const parentCommit = readCommit(parentId);
      if (parentCommit) {
        parentSnapshot = parentCommit.snapshot;
      }
    }

    // Check if anything has actually changed since the last commit
    const indexKeys = Object.keys(index);
    const parentKeys = Object.keys(parentSnapshot);

    const isStagingEmpty = indexKeys.length === 0;
    
    // Check if index matches parent snapshot exactly
    let hasChanges = false;
    if (indexKeys.length !== parentKeys.length || parent2CommitId) {
      hasChanges = true;
    } else {
      for (const key of indexKeys) {
        if (index[key] !== parentSnapshot[key]) {
          hasChanges = true;
          break;
        }
      }
    }

    // Explicit check for nothing to commit
    if (isStagingEmpty) {
      return {
        success: false,
        message: 'Nothing to commit. The staging index is completely empty. Create or track files first.'
      };
    }

    if (!hasChanges) {
      return {
        success: false,
        message: 'No changes staged for commit. Staging index matches the last commit snapshot.'
      };
    }

    // Generate real Git Object-model commit ID (SHA-1 hash of the commit object itself)
    const rootTreeHash = buildTreeFromFlatIndex(index);
    const timestamp = new Date().toISOString();
    const cleanAuthor = author && author.trim() !== '' ? author.trim() : 'Developer <developer@gitclone.internal>';

    const commitObjContent = JSON.stringify({
      tree: rootTreeHash,
      parent: parentId,
      parent2: parent2CommitId,
      author: cleanAuthor,
      timestamp,
      message: message.trim(),
      branch: head.type === 'branch' ? head.value : null
    }, null, 2);

    const size = Buffer.byteLength(commitObjContent, 'utf-8');
    const header = `commit ${size}\u0000`;
    const payload = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      Buffer.from(commitObjContent, 'utf-8')
    ]);
    const commitId = crypto.createHash('sha1').update(payload).digest('hex');

    const commit: Commit = {
      id: commitId,
      message: message.trim(),
      author: cleanAuthor,
      timestamp,
      parent: parentId,
      parent2: parent2CommitId,
      branch: head.type === 'branch' ? head.value : null,
      snapshot: { ...index }
    };

    // Write the commit (this will write both commit object and legacy commit file)
    writeCommit(commitId, commit);

    // Update branch reference or detached HEAD
    if (head.type === 'branch') {
      setBranchCommitId(head.value, commitId);
    } else {
      writeHEAD('commit', commitId);
    }

    appendReflog(
      'commit',
      parentId,
      commitId,
      `commit: ${message.trim()}`
    );

    logMessage('INFO', `Created commit ${commitId.substring(0, 7)}: ${commit.message}`);
    return {
      success: true,
      message: `Created commit ${commitId.substring(0, 7)}: ${commit.message}`,
      commit
    };
  } catch (error: any) {
    logMessage('ERROR', `Failed to create commit: ${error.message}`);
    return {
      success: false,
      message: `Failed to create commit: ${error.message}`
    };
  }
}

// Get the full linear commit history starting from a specific commit ID
export function getHistory(startCommitId: string | null): Commit[] {
  const history: Commit[] = [];
  let currentId = startCommitId;
  const visited = new Set<string>(); // Prevent infinite loop in case of corrupt state

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const commit = readCommit(currentId);
    if (!commit) break;

    history.push(commit);
    currentId = commit.parent;
  }

  return history;
}

// Retrieve ALL commits stored in the repository (unsorted)
export function getAllCommits(): Commit[] {
  const commitsDir = path.join(VCS_DIR, 'commits');
  if (!fs.existsSync(commitsDir)) return [];
  
  const files = fs.readdirSync(commitsDir).filter(f => f.endsWith('.json'));
  const commits: Commit[] = [];
  
  for (const file of files) {
    const commitId = file.replace('.json', '');
    const commit = readCommit(commitId);
    if (commit) {
      commits.push(commit);
    }
  }
  
  // Sort by timestamp descending by default
  return commits.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
