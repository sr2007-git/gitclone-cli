import fs from 'fs';
import path from 'path';
import {
  readIndex,
  readHEAD,
  getBranchCommitId,
  readCommit,
  getWorkingFiles,
  SANDBOX_DIR
} from './storage';
import { computeSHA1 } from './hash';

export interface FileStatus {
  path: string;
  status: 'untracked' | 'staged_new' | 'modified_staged' | 'modified_unstaged' | 'deleted_unstaged' | 'staged_deleted' | 'up_to_date' | 'conflict';
  workingHash?: string;
  stagedHash?: string;
  committedHash?: string;
}

export interface RepoStatusResult {
  isInitialized: boolean;
  currentBranch: string | null;
  currentCommitId: string | null;
  isDetached: boolean;
  files: FileStatus[];
}

export function getRepoStatus(): RepoStatusResult {
  const result: RepoStatusResult = {
    isInitialized: false,
    currentBranch: null,
    currentCommitId: null,
    isDetached: false,
    files: []
  };

  const head = readHEAD();
  if (!head) {
    return result;
  }

  result.isInitialized = true;

  let baseCommitId: string | null = null;
  if (head.type === 'branch') {
    result.currentBranch = head.value;
    baseCommitId = getBranchCommitId(head.value);
    result.currentCommitId = baseCommitId;
    result.isDetached = false;
  } else {
    result.currentCommitId = head.value;
    result.isDetached = true;
  }

  // Read base commit snapshot
  let baseSnapshot: { [filePath: string]: string } = {};
  if (baseCommitId) {
    const baseCommit = readCommit(baseCommitId);
    if (baseCommit) {
      baseSnapshot = baseCommit.snapshot;
    }
  } else if (result.isDetached && result.currentCommitId) {
    const baseCommit = readCommit(result.currentCommitId);
    if (baseCommit) {
      baseSnapshot = baseCommit.snapshot;
    }
  }

  // Read staging index
  const stagedIndex = readIndex();

  // Read files currently in working directory
  const workingFilesList = getWorkingFiles();
  const workingMap: { [filePath: string]: { content: string; hash: string } } = {};
  
  for (const f of workingFilesList) {
    const hash = computeSHA1(f.content);
    workingMap[f.relativePath] = { content: f.content, hash };
  }

  // Collect all unique file paths across working directory, staging index, and base commit
  const allPaths = new Set([
    ...Object.keys(workingMap),
    ...Object.keys(stagedIndex),
    ...Object.keys(baseSnapshot)
  ]);

  const fileStatuses: FileStatus[] = [];

  for (const filePath of allPaths) {
    const onDisk = filePath in workingMap;
    const inStaged = filePath in stagedIndex;
    const inBase = filePath in baseSnapshot;

    const workingHash = onDisk ? workingMap[filePath].hash : undefined;
    const stagedHash = inStaged ? stagedIndex[filePath] : undefined;
    const committedHash = inBase ? baseSnapshot[filePath] : undefined;

    let status: FileStatus['status'] = 'up_to_date';

    // Check for conflict markers in the working directory file content
    const hasConflict = onDisk && workingMap[filePath].content.includes('<<<<<<< HEAD') && workingMap[filePath].content.includes('=======');

    if (hasConflict) {
      status = 'conflict';
    } else if (onDisk && !inStaged && !inBase) {
      // 1. Exists on disk, not in staging and not in last commit -> Untracked
      status = 'untracked';
    } else if (onDisk && inStaged && !inBase) {
      // 2. Exists on disk, is staged, but not in last commit -> New file staged or modified unstaged
      if (workingHash === stagedHash) {
        status = 'staged_new';
      } else {
        status = 'modified_unstaged'; // staged but has unstaged modifications
      }
    } else if (onDisk && inStaged && inBase) {
      // 3. Exists on disk, is staged, and is in last commit
      if (workingHash !== stagedHash) {
        // Content on disk differs from staged content
        status = 'modified_unstaged';
      } else if (stagedHash !== committedHash) {
        // Staged content matches disk, but differs from committed content -> Modified (staged)
        status = 'modified_staged';
      } else {
        status = 'up_to_date';
      }
    } else if (onDisk && !inStaged && inBase) {
      // 4. Exists on disk, NOT in staging, is in last commit -> Modified (unstaged) or staged deletion (wait, if it is on disk, it's modified unstaged because it's not staged!)
      if (workingHash !== committedHash) {
        status = 'modified_unstaged';
      } else {
        // It was in base, it's on disk, but it is NOT in index. This can happen if index is cleared or we untracked it.
        status = 'modified_unstaged';
      }
    } else if (!onDisk && inStaged && inBase) {
      // 5. Deleted from disk, but still in index -> Deleted (unstaged)
      status = 'deleted_unstaged';
    } else if (!onDisk && inStaged && !inBase) {
      // 6. Staged as new but since deleted on disk
      status = 'deleted_unstaged';
    } else if (!onDisk && !inStaged && inBase) {
      // 7. Deleted from disk, and removed from index -> Staged deleted
      status = 'staged_deleted';
    }

    fileStatuses.push({
      path: filePath,
      status,
      workingHash,
      stagedHash,
      committedHash
    });
  }

  // Sort files alphabetically by path
  fileStatuses.sort((a, b) => a.path.localeCompare(b.path));

  result.files = fileStatuses;
  return result;
}
