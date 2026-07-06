import fs from 'fs';
import path from 'path';
import { readCommit, readHEAD, getBranchCommitId, readIndex, writeIndex, readObject, writeSandboxFile, deleteSandboxFile, VCS_DIR, logMessage } from './storage';
import { commitChanges, getHistory } from './commit';
import { checkoutTarget } from './checkout';
import { appendReflog } from './reflog';

// Helper to find the common ancestor of two commits (Requirement 6 & 7)
export function findCommonAncestor(commitIdA: string, commitIdB: string): string | null {
  const historyA = getHistory(commitIdA).map(c => c.id);
  const setA = new Set(historyA);

  let currentId: string | null = commitIdB;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    if (setA.has(currentId)) {
      return currentId;
    }

    const commit = readCommit(currentId);
    if (!commit) break;
    currentId = commit.parent;
  }

  return null;
}

export function cherryPick(
  targetCommitId: string,
  author?: string
): { success: boolean; message: string; newCommitId?: string } {
  try {
    const head = readHEAD();
    if (!head) {
      return { success: false, message: 'Repository is not initialized.' };
    }

    const targetCommit = readCommit(targetCommitId);
    if (!targetCommit) {
      return { success: false, message: `Commit ${targetCommitId} not found.` };
    }

    // Get parent snapshot of target commit to compute its specific changes (diff)
    let parentSnapshot: { [path: string]: string } = {};
    if (targetCommit.parent) {
      const parentCommit = readCommit(targetCommit.parent);
      if (parentCommit) {
        parentSnapshot = parentCommit.snapshot;
      }
    }

    // Read current staging index
    const index = readIndex();

    // 1. Calculate the file-level diff introduced by targetCommit
    const targetSnapshot = targetCommit.snapshot;
    const modifiedOrAdded: { [path: string]: string } = {};
    const deleted: string[] = [];

    for (const [filePath, hash] of Object.entries(targetSnapshot)) {
      if (parentSnapshot[filePath] !== hash) {
        modifiedOrAdded[filePath] = hash;
      }
    }

    for (const filePath of Object.keys(parentSnapshot)) {
      if (!(filePath in targetSnapshot)) {
        deleted.push(filePath);
      }
    }

    // 2. Apply these changes to the working directory and the staging index
    for (const [filePath, hash] of Object.entries(modifiedOrAdded)) {
      const content = readObject(hash);
      if (content !== null) {
        writeSandboxFile(filePath, content);
        index[filePath] = hash;
      }
    }

    for (const filePath of deleted) {
      deleteSandboxFile(filePath);
      delete index[filePath];
    }

    // Save index
    writeIndex(index);

    // 3. Create cherry-pick commit
    const commitMsg = `${targetCommit.message}\n\n(cherry picked from commit ${targetCommitId})`;
    const commitAuthor = author || targetCommit.author;
    const result = commitChanges(commitMsg, commitAuthor);

    if (result.success && result.commit) {
      appendReflog(
        'cherry-pick',
        head.value,
        result.commit.id,
        `cherry-pick: applied ${targetCommitId.substring(0, 7)}`
      );
      return {
        success: true,
        message: `Successfully cherry-picked commit ${targetCommitId.substring(0, 7)}: "${targetCommit.message}".`,
        newCommitId: result.commit.id
      };
    } else {
      return {
        success: false,
        message: `Failed to commit cherry-picked changes: ${result.message}`
      };
    }
  } catch (error: any) {
    logMessage('ERROR', `Cherry-pick error: ${error.message}`);
    return { success: false, message: `Failed to cherry-pick: ${error.message}` };
  }
}

export function rebaseBranch(
  sourceBranch: string,
  targetBranch: string,
  author?: string
): { success: boolean; message: string } {
  try {
    const sourceCommitId = getBranchCommitId(sourceBranch);
    const targetCommitId = getBranchCommitId(targetBranch);

    if (!sourceCommitId) {
      return { success: false, message: `Source branch "${sourceBranch}" has no commits.` };
    }
    if (!targetCommitId) {
      return { success: false, message: `Target branch "${targetBranch}" has no commits.` };
    }

    // 1. Find the common ancestor commit of both branches
    const ancestorId = findCommonAncestor(sourceCommitId, targetCommitId);
    if (!ancestorId) {
      return { success: false, message: 'No common ancestor found between these branches.' };
    }

    if (ancestorId === sourceCommitId) {
      return { success: true, message: `Source branch "${sourceBranch}" is already merged into target branch "${targetBranch}".` };
    }

    // 2. Locate all commits on the source branch up to the ancestor (chronologically ordered oldest to newest)
    const sourceHistoryDesc = getHistory(sourceCommitId);
    const uniqueCommitsAsc: string[] = [];

    for (const commit of sourceHistoryDesc) {
      if (commit.id === ancestorId) break;
      uniqueCommitsAsc.push(commit.id);
    }
    uniqueCommitsAsc.reverse(); // oldest to newest

    if (uniqueCommitsAsc.length === 0) {
      return { success: true, message: `No unique commits on source branch "${sourceBranch}" to rebase.` };
    }

    // Save HEAD state before rebase for safety reflogging
    const headBefore = readHEAD();
    const headBeforeVal = headBefore ? headBefore.value : null;

    // 3. Switch HEAD to target branch tip (temp detached state or attached)
    const switchTarget = checkoutTarget(targetBranch, true);
    if (!switchTarget.success) {
      return { success: false, message: `Failed to switch to target branch: ${switchTarget.message}` };
    }

    logMessage('INFO', `Rebasing branch ${sourceBranch} onto ${targetBranch}: replaying ${uniqueCommitsAsc.length} commit(s)`);

    // 4. Sequentially cherry-pick each unique commit
    let lastCommitId = targetCommitId;
    for (const commitId of uniqueCommitsAsc) {
      const cpResult = cherryPick(commitId, author);
      if (!cpResult.success || !cpResult.newCommitId) {
        // Rollback attempt by restoring HEAD back to before rebase
        if (headBeforeVal) checkoutTarget(headBeforeVal, true);
        return {
          success: false,
          message: `Rebase halted: failed to apply commit ${commitId.substring(0, 7)} during replay. ${cpResult.message}`
        };
      }
      lastCommitId = cpResult.newCommitId;
    }

    // 5. Update the source branch pointer to point to the final replayed commit
    const branchPath = path.join(VCS_DIR, 'branches', sourceBranch);
    fs.writeFileSync(branchPath, `${lastCommitId}\n`, 'utf-8');

    // 6. Switch checkout back to the rebased source branch
    checkoutTarget(sourceBranch, true);

    appendReflog(
      'rebase',
      headBeforeVal,
      lastCommitId,
      `rebase: rebased ${sourceBranch} onto ${targetBranch}`
    );

    return {
      success: true,
      message: `Successfully rebased branch "${sourceBranch}" onto "${targetBranch}". Replayed ${uniqueCommitsAsc.length} commit(s). Note: Replay has changed commit IDs due to updated parent linkages.`
    };
  } catch (error: any) {
    logMessage('ERROR', `Rebase error: ${error.message}`);
    return { success: false, message: `Rebase failed: ${error.message}` };
  }
}
