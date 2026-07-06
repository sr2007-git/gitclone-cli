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
  readObject,
  writeObject,
  SANDBOX_DIR,
  Commit,
  VCS_DIR,
  logMessage
} from './storage';
import { computeSHA1 } from './hash';
import { commitChanges } from './commit';
import { appendReflog } from './reflog';

function getAncestors(commitId: string): Set<string> {
  const ancestors = new Set<string>();
  const queue: string[] = [commitId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    const commit = readCommit(current);
    if (commit) {
      if (commit.parent) {
        queue.push(commit.parent);
      }
      if ((commit as any).parent2) {
        queue.push((commit as any).parent2);
      }
    }
  }
  return ancestors;
}

function findCommonAncestor(commitIdA: string, commitIdB: string): string | null {
  const ancestorsA = getAncestors(commitIdA);
  const queue: string[] = [commitIdB];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (ancestorsA.has(current)) {
      return current; // Found the common ancestor!
    }
    const commit = readCommit(current);
    if (commit) {
      if (commit.parent) {
        queue.push(commit.parent);
      }
      if ((commit as any).parent2) {
        queue.push((commit as any).parent2);
      }
    }
  }
  return null;
}

export interface ConflictInfo {
  path: string;
  oursHash: string | null;
  theirsHash: string | null;
  baseHash: string | null;
  oursContent: string;
  theirsContent: string;
  baseContent: string;
}

export function attemptMerge(targetBranch: string): {
  success: boolean;
  message: string;
  conflict?: boolean;
  conflicts?: ConflictInfo[];
  mode?: 'fast-forward' | 'already-up-to-date' | 'auto-merge' | 'conflict';
  oursCommitId?: string | null;
  theirsCommitId?: string | null;
} {
  const head = readHEAD();
  if (!head) {
    return { success: false, message: 'Repository not initialized.' };
  }

  // Determine ours (current branch tip)
  let oursBranch: string | null = null;
  let oursCommitId: string | null = null;
  if (head.type === 'branch') {
    oursBranch = head.value;
    oursCommitId = getBranchCommitId(oursBranch);
  } else {
    oursCommitId = head.value;
  }

  if (!oursCommitId) {
    return { success: false, message: 'Current branch has no commits. Cannot merge.' };
  }

  // Determine theirs (target branch tip)
  const theirsCommitId = getBranchCommitId(targetBranch);
  if (!theirsCommitId) {
    return { success: false, message: `Branch "${targetBranch}" has no commits or does not exist.` };
  }

  if (oursCommitId === theirsCommitId) {
    return { success: true, mode: 'already-up-to-date', message: 'Already up to date. Branches point to the same commit.' };
  }

  // Find common ancestor (base commit)
  const baseCommitId = findCommonAncestor(oursCommitId, theirsCommitId);
  if (!baseCommitId) {
    // Disjoint history, we will assume empty base commit
  }

  // Case 1: Fast-forward
  if (baseCommitId === oursCommitId) {
    // Ours is an ancestor of theirs. We can just fast-forward our branch tip!
    const theirsCommit = readCommit(theirsCommitId);
    if (!theirsCommit) {
      return { success: false, message: 'Failed to read target branch commit.' };
    }

    // Update current branch commit ID
    if (oursBranch) {
      setBranchCommitId(oursBranch, theirsCommitId);
    } else {
      writeHEAD('commit', theirsCommitId);
    }

    // Write all snapshot files to sandbox disk
    writeSnapshotToDisk(theirsCommit.snapshot);

    // Update index
    writeIndex({ ...theirsCommit.snapshot });

    appendReflog(
      'merge',
      oursCommitId,
      theirsCommitId,
      `merge ${targetBranch}: fast-forward`
    );

    return {
      success: true,
      mode: 'fast-forward',
      message: `Fast-forward merged branch "${targetBranch}" into active head.`
    };
  }

  // Case 2: Already up to date
  if (baseCommitId === theirsCommitId) {
    return {
      success: true,
      mode: 'already-up-to-date',
      message: `Branch "${targetBranch}" is already merged into current branch.`
    };
  }

  // Case 3: Three-way merge
  const baseCommit = baseCommitId ? readCommit(baseCommitId) : null;
  const oursCommit = readCommit(oursCommitId);
  const theirsCommit = readCommit(theirsCommitId);

  if (!oursCommit || !theirsCommit) {
    return { success: false, message: 'Could not load parent commits for merging.' };
  }

  const baseSnapshot = baseCommit ? baseCommit.snapshot : {};
  const oursSnapshot = oursCommit.snapshot;
  const theirsSnapshot = theirsCommit.snapshot;

  // Gather all unique file paths
  const allPaths = new Set([
    ...Object.keys(baseSnapshot),
    ...Object.keys(oursSnapshot),
    ...Object.keys(theirsSnapshot)
  ]);

  const conflicts: ConflictInfo[] = [];
  const mergedIndex: { [path: string]: string } = {};

  for (const filePath of allPaths) {
    const baseHash = baseSnapshot[filePath] || null;
    const oursHash = oursSnapshot[filePath] || null;
    const theirsHash = theirsSnapshot[filePath] || null;

    if (oursHash === theirsHash) {
      // Both are the same (either both modified to same, or both unchanged, or both deleted)
      if (oursHash !== null) {
        mergedIndex[filePath] = oursHash;
      }
    } else if (oursHash === baseHash) {
      // Ours is unchanged since base, but theirs changed (or deleted)
      if (theirsHash !== null) {
        mergedIndex[filePath] = theirsHash;
      }
    } else if (theirsHash === baseHash) {
      // Theirs is unchanged since base, but ours changed (or deleted)
      if (oursHash !== null) {
        mergedIndex[filePath] = oursHash;
      }
    } else {
      // Both modified from base, and modified differently!
      // This is a conflict!
      const oursContent = oursHash ? (readObject(oursHash) || '') : '';
      const theirsContent = theirsHash ? (readObject(theirsHash) || '') : '';

      // Construct visual conflict markers in the file content on disk (Requirement 6)
      const conflictMarkup = `<<<<<<< HEAD\n${oursContent}\n=======\n${theirsContent}\n>>>>>>> ${targetBranch}`;
      
      const fullPath = path.join(SANDBOX_DIR, filePath);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, conflictMarkup, 'utf-8');

      conflicts.push({
        path: filePath,
        oursHash,
        theirsHash,
        baseHash,
        oursContent,
        theirsContent,
        baseContent: baseHash ? (readObject(baseHash) || '') : ''
      });
    }
  }

  if (conflicts.length > 0) {
    logMessage('WARNING', `Merge conflict in ${conflicts.length} files during merge with ${targetBranch}`);
    return {
      success: false,
      conflict: true,
      mode: 'conflict',
      message: `Merge conflict in ${conflicts.length} file(s). Conflict resolution required.`,
      conflicts,
      oursCommitId,
      theirsCommitId
    };
  }

  // Auto-merge succeeds! Let's write the merged index to disk and commit.
  writeSnapshotToDisk(mergedIndex);
  writeIndex(mergedIndex);

  // Create a merge commit
  const branchName = oursBranch || 'detached HEAD';
  const mergeMessage = `Merge branch '${targetBranch}' into '${branchName}'`;
  
  const result = commitChanges(mergeMessage, 'Developer <developer@gitclone.internal>', theirsCommitId);
  if (result.success && result.commit) {
    appendReflog(
      'merge',
      oursCommitId,
      result.commit.id,
      `merge: Auto-merged branch '${targetBranch}'`
    );
    return {
      success: true,
      mode: 'auto-merge',
      message: `Auto-merge successful. Created merge commit ${result.commit.id.substring(0, 7)}.`
    };
  } else {
    return {
      success: false,
      message: `Auto-merge succeeded but commit failed: ${result.message}`
    };
  }
}

export function completeMerge(
  message: string,
  author: string,
  parentCommitId: string,
  parent2CommitId: string
): { success: boolean; message: string; commit?: Commit } {
  try {
    const result = commitChanges(message, author, parent2CommitId);
    if (result.success && result.commit) {
      appendReflog(
        'merge',
        parentCommitId,
        result.commit.id,
        `merge: Successfully resolved conflicts and merged ${parent2CommitId.substring(0, 7)}`
      );
      return {
        success: true,
        message: `Successfully resolved conflicts and created merge commit ${result.commit.id.substring(0, 7)}!`,
        commit: result.commit
      };
    }
    return {
      success: false,
      message: result.message
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to complete merge commit: ${error.message}`
    };
  }
}

// Helper to write a specific snapshot back to the sandbox working directory
function writeSnapshotToDisk(snapshot: { [filePath: string]: string }) {
  // First, delete files that are not in the snapshot
  const listFiles = (dir: string): string[] => {
    const results: string[] = [];
    const traverse = (current: string) => {
      if (!fs.existsSync(current)) return;
      const list = fs.readdirSync(current);
      for (const item of list) {
        if (item === '.gitclone') continue;
        const full = path.join(current, item);
        if (fs.statSync(full).isDirectory()) {
          traverse(full);
        } else {
          results.push(path.relative(SANDBOX_DIR, full));
        }
      }
    };
    traverse(SANDBOX_DIR);
    return results;
  };

  const existingPaths = listFiles(SANDBOX_DIR);
  existingPaths.forEach((relPath) => {
    if (!(relPath in snapshot)) {
      const full = path.join(SANDBOX_DIR, relPath);
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
      }
    }
  });

  // Write all current snapshots
  Object.entries(snapshot).forEach(([filePath, hash]) => {
    const content = readObject(hash);
    if (content !== null) {
      const fullPath = path.join(SANDBOX_DIR, filePath);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  });

  // Clean empty folders
  const cleanEmptyDirs = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        cleanEmptyDirs(full);
      }
    }
    // Re-check after cleaning children
    if (dir !== SANDBOX_DIR && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  };
  cleanEmptyDirs(SANDBOX_DIR);
}
