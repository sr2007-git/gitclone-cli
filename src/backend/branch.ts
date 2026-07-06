import {
  listBranches,
  getBranchCommitId,
  setBranchCommitId,
  readHEAD,
  deleteBranch as storageDeleteBranch
} from './storage';

export function createBranch(name: string): { success: boolean; message: string } {
  const cleanName = name.trim();
  if (!cleanName) {
    return { success: false, message: 'Branch name cannot be empty.' };
  }

  // Basic branch name validation
  const nameRegex = /^[a-zA-Z0-9_\-\/]+$/;
  if (!nameRegex.test(cleanName)) {
    return {
      success: false,
      message: 'Invalid branch name. Only alphanumeric characters, hyphens, underscores, and forward slashes are allowed.'
    };
  }

  const existingBranches = listBranches();
  if (existingBranches.includes(cleanName)) {
    return { success: false, message: `Branch "${cleanName}" already exists.` };
  }

  const head = readHEAD();
  if (!head) {
    return { success: false, message: 'Repository is not initialized.' };
  }

  // Find what commit we are currently on
  let currentCommitId: string | null = null;
  if (head.type === 'branch') {
    currentCommitId = getBranchCommitId(head.value);
  } else {
    currentCommitId = head.value;
  }

  if (!currentCommitId) {
    return {
      success: false,
      message: 'Cannot create a new branch because the repository has no commits yet. Please make your first commit on the default branch first.'
    };
  }

  try {
    setBranchCommitId(cleanName, currentCommitId);
    return {
      success: true,
      message: `Created branch "${cleanName}" starting at commit ${currentCommitId.substring(0, 7)}.`
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to create branch: ${error.message}`
    };
  }
}

export function removeBranch(name: string): { success: boolean; message: string } {
  const cleanName = name.trim();
  const head = readHEAD();
  
  if (!head) {
    return { success: false, message: 'Repository is not initialized.' };
  }

  if (head.type === 'branch' && head.value === cleanName) {
    return { success: false, message: 'Cannot delete the currently checked out branch.' };
  }

  const existingBranches = listBranches();
  if (!existingBranches.includes(cleanName)) {
    return { success: false, message: `Branch "${cleanName}" does not exist.` };
  }

  try {
    storageDeleteBranch(cleanName);
    return { success: true, message: `Successfully deleted branch "${cleanName}".` };
  } catch (error: any) {
    return { success: false, message: `Failed to delete branch: ${error.message}` };
  }
}
