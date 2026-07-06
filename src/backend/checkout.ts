import fs from 'fs';
import path from 'path';
import {
  readHEAD,
  writeHEAD,
  getBranchCommitId,
  readCommit,
  readObject,
  writeSandboxFile,
  deleteSandboxFile,
  writeIndex,
  getWorkingFiles,
  listBranches
} from './storage';
import { getRepoStatus } from './status';
import { appendReflog } from './reflog';

export function checkoutTarget(
  target: string, // branch name or commit ID
  force: boolean = false
): { success: boolean; message: string; isDetached: boolean } {
  try {
    const head = readHEAD();
    if (!head) {
      return { success: false, message: 'Repository is not initialized.', isDetached: false };
    }
    const headBeforeVal = head.value;

    // Check for uncommitted changes first (unless force is true)
    if (!force) {
      const status = getRepoStatus();
      const hasUncommitted = status.files.some(
        f => f.status !== 'untracked' && f.status !== 'up_to_date'
      );
      if (hasUncommitted) {
        return {
          success: false,
          message: 'You have uncommitted changes. Please commit or stash your changes before checking out, or check "Force Checkout" to discard changes.',
          isDetached: head.type === 'commit'
        };
      }
    }

    const branches = listBranches();
    const isBranch = branches.includes(target);

    let targetCommitId: string | null = null;
    let targetBranchName: string | null = null;

    if (isBranch) {
      targetBranchName = target;
      targetCommitId = getBranchCommitId(target);
    } else {
      // Check if it's a valid commit ID (by checking if the commit file exists)
      const commit = readCommit(target);
      if (commit) {
        targetCommitId = target;
      } else {
        return {
          success: false,
          message: `Target "${target}" is neither an existing branch nor a valid commit ID.`,
          isDetached: head.type === 'commit'
        };
      }
    }

    // If target is a branch but has NO commits yet (empty repository default branch switching)
    if (isBranch && !targetCommitId) {
      // Just switch HEAD to this branch and clear the index
      writeHEAD('branch', targetBranchName!);
      writeIndex({});
      return {
        success: true,
        message: `Switched to empty branch "${targetBranchName}". Ready for your first commit!`,
        isDetached: false
      };
    }

    // Now we must have a targetCommitId
    if (!targetCommitId) {
      return {
        success: false,
        message: `Could not resolve target "${target}" to a commit ID.`,
        isDetached: head.type === 'commit'
      };
    }

    const commitObj = readCommit(targetCommitId);
    if (!commitObj) {
      return {
        success: false,
        message: `Failed to load commit data for ID ${targetCommitId}.`,
        isDetached: head.type === 'commit'
      };
    }

    const snapshot = commitObj.snapshot;

    // 1. Scan current working files and remove files not in the snapshot
    const currentFiles = getWorkingFiles();
    for (const file of currentFiles) {
      if (!(file.relativePath in snapshot)) {
        deleteSandboxFile(file.relativePath);
      }
    }

    // 2. Write files from snapshot back to working directory
    for (const [filePath, hash] of Object.entries(snapshot)) {
      const content = readObject(hash);
      if (content !== null) {
        writeSandboxFile(filePath, content);
      }
    }

    // 3. Update the staging index to match the snapshot exactly
    writeIndex({ ...snapshot });

    // 4. Update HEAD
    let resultingDetached = false;
    if (targetBranchName) {
      writeHEAD('branch', targetBranchName);
      resultingDetached = false;
    } else {
      // Checking out a specific commit. Let's see if this commit is the tip of any existing branch.
      // If it matches a branch tip, we'll attach HEAD to that branch! This matches smart checkout.
      // Otherwise, we enter detached state.
      let matchingBranch: string | null = null;
      for (const b of branches) {
        if (getBranchCommitId(b) === targetCommitId) {
          matchingBranch = b;
          break;
        }
      }

      if (matchingBranch) {
        writeHEAD('branch', matchingBranch);
        resultingDetached = false;
      } else {
        writeHEAD('commit', targetCommitId);
        resultingDetached = true;
      }
    }

    const shortId = targetCommitId.substring(0, 7);
    const successMsg = targetBranchName
      ? `Switched to branch "${targetBranchName}" at commit ${shortId}.`
      : `Switched to commit ${shortId} (Detached HEAD). Warning: modifications in this state will not belong to any branch unless a new branch is created!`;

    appendReflog(
      'checkout',
      headBeforeVal,
      targetBranchName || targetCommitId,
      `checkout: moving from ${headBeforeVal} to ${targetBranchName || shortId}`
    );

    return {
      success: true,
      message: successMsg,
      isDetached: resultingDetached
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to checkout: ${error.message}`,
      isDetached: false
    };
  }
}
