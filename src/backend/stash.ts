import fs from 'fs';
import path from 'path';
import {
  VCS_DIR,
  readHEAD,
  getBranchCommitId,
  readCommit,
  getWorkingFiles,
  writeGitObject,
  writeIndex,
  readObject,
  writeSandboxFile,
  deleteSandboxFile,
  readIndex,
  logMessage
} from './storage';
import { getRepoStatus } from './status';

export interface StashEntry {
  id: string;
  message: string;
  timestamp: string;
  headCommitId: string;
  snapshot: { [filePath: string]: string }; // relativePath -> blob SHA-1
}

function getStashFilePath(): string {
  return path.join(VCS_DIR, 'stashes.json');
}

export function readStashes(): StashEntry[] {
  const filePath = getStashFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

export function writeStashes(stashes: StashEntry[]): void {
  const filePath = getStashFilePath();
  fs.writeFileSync(filePath, JSON.stringify(stashes, null, 2), 'utf-8');
}

export function saveStash(message?: string): { success: boolean; message: string; id?: string } {
  try {
    const head = readHEAD();
    if (!head) {
      return { success: false, message: 'Repository is not initialized.' };
    }

    let headCommitId: string | null = null;
    if (head.type === 'branch') {
      headCommitId = getBranchCommitId(head.value);
    } else {
      headCommitId = head.value;
    }

    if (!headCommitId) {
      return { success: false, message: 'No commits to stash on. Create a commit first.' };
    }

    const headCommit = readCommit(headCommitId);
    if (!headCommit) {
      return { success: false, message: 'Failed to read HEAD commit.' };
    }

    // Get current index (staged files)
    const currentIndex = readIndex();
    
    // We want to save both staged and unstaged working directory changes!
    // Get all files on disk
    const workingFiles = getWorkingFiles();
    const workingSnapshot: { [filePath: string]: string } = {};

    // First write all active workspace contents into objects as blobs and build working snapshot
    for (const file of workingFiles) {
      const blobHash = writeGitObject('blob', file.content);
      workingSnapshot[file.relativePath] = blobHash;
    }

    // Compare working snapshot against HEAD commit snapshot to verify if there are actually any changes
    const headSnapshot = headCommit.snapshot;
    let hasChanges = false;

    // Check for modifications or new files
    for (const [filePath, hash] of Object.entries(workingSnapshot)) {
      if (headSnapshot[filePath] !== hash) {
        hasChanges = true;
        break;
      }
    }

    // Check for deleted files
    if (!hasChanges) {
      for (const filePath of Object.keys(headSnapshot)) {
        if (!(filePath in workingSnapshot)) {
          hasChanges = true;
          break;
        }
      }
    }

    if (!hasChanges) {
      return { success: false, message: 'No changes found in working directory. Nothing to stash.' };
    }

    // Create stash entry
    const timestamp = new Date().toISOString();
    const id = `stash_${Date.now()}`;
    const desc = message && message.trim() !== ''
      ? message.trim()
      : `WIP on ${head.type === 'branch' ? head.value : 'detached HEAD'}: stashed at ${new Date().toLocaleTimeString()}`;

    const newEntry: StashEntry = {
      id,
      message: desc,
      timestamp,
      headCommitId,
      snapshot: workingSnapshot
    };

    const stashes = readStashes();
    stashes.unshift(newEntry); // newest first
    writeStashes(stashes);

    // RESTORE working directory to HEAD commit state
    // Delete any files present in working directory but not in HEAD commit
    for (const file of workingFiles) {
      if (!(file.relativePath in headSnapshot)) {
        deleteSandboxFile(file.relativePath);
      }
    }

    // Write back files from HEAD commit snapshot
    for (const [filePath, hash] of Object.entries(headSnapshot)) {
      const content = readObject(hash);
      if (content !== null) {
        writeSandboxFile(filePath, content);
      }
    }

    // Restore index to match HEAD commit snapshot
    writeIndex({ ...headSnapshot });

    logMessage('INFO', `Saved stash "${desc}"`);
    return {
      success: true,
      message: `Saved working directory and index state: ${desc}`,
      id
    };
  } catch (error: any) {
    logMessage('ERROR', `Stash failed: ${error.message}`);
    return { success: false, message: `Failed to stash changes: ${error.message}` };
  }
}

export function applyStash(id: string): { success: boolean; message: string } {
  try {
    const stashes = readStashes();
    const stash = stashes.find(s => s.id === id);
    if (!stash) {
      return { success: false, message: `Stash with ID "${id}" not found.` };
    }

    // Replay the stashed snapshot onto the working directory
    const snapshot = stash.snapshot;
    
    // 1. Scan current working files and delete any file not in stashed snapshot
    const currentFiles = getWorkingFiles();
    for (const file of currentFiles) {
      if (!(file.relativePath in snapshot)) {
        deleteSandboxFile(file.relativePath);
      }
    }

    // 2. Restore stashed files to working directory
    for (const [filePath, hash] of Object.entries(snapshot)) {
      const content = readObject(hash);
      if (content !== null) {
        writeSandboxFile(filePath, content);
      }
    }

    // 3. Keep index in sync with applied state
    writeIndex({ ...snapshot });

    logMessage('INFO', `Applied stash "${stash.message}"`);
    return {
      success: true,
      message: `Successfully applied stash: ${stash.message}`
    };
  } catch (error: any) {
    logMessage('ERROR', `Stash apply failed: ${error.message}`);
    return { success: false, message: `Failed to apply stash: ${error.message}` };
  }
}

export function dropStash(id: string): { success: boolean; message: string } {
  try {
    const stashes = readStashes();
    const index = stashes.findIndex(s => s.id === id);
    if (index === -1) {
      return { success: false, message: `Stash with ID "${id}" not found.` };
    }

    const message = stashes[index].message;
    stashes.splice(index, 1);
    writeStashes(stashes);

    logMessage('INFO', `Dropped stash "${message}"`);
    return {
      success: true,
      message: `Successfully dropped stash: ${message}`
    };
  } catch (error: any) {
    logMessage('ERROR', `Stash drop failed: ${error.message}`);
    return { success: false, message: `Failed to drop stash: ${error.message}` };
  }
}
