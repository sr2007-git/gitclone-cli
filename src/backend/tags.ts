import fs from 'fs';
import path from 'path';
import { VCS_DIR, logMessage } from './storage';
import { checkoutTarget } from './checkout';

export interface TagInfo {
  name: string;
  commitId: string;
}

export function createTag(tagName: string, commitId: string): { success: boolean; message: string } {
  if (!tagName || tagName.trim() === '') {
    return { success: false, message: 'Tag name cannot be empty.' };
  }
  
  const tagsDir = path.join(VCS_DIR, 'tags');
  if (!fs.existsSync(tagsDir)) {
    fs.mkdirSync(tagsDir, { recursive: true });
  }

  const tagPath = path.join(tagsDir, tagName.trim());
  if (fs.existsSync(tagPath)) {
    return { success: false, message: `Tag "${tagName}" already exists.` };
  }

  try {
    fs.writeFileSync(tagPath, `${commitId.trim()}\n`, 'utf-8');
    logMessage('INFO', `Created tag "${tagName}" pointing to commit ${commitId.substring(0, 7)}`);
    return { success: true, message: `Successfully created tag "${tagName}" pointing to commit ${commitId.substring(0, 7)}.` };
  } catch (error: any) {
    logMessage('ERROR', `Failed to create tag: ${error.message}`);
    return { success: false, message: `Failed to create tag: ${error.message}` };
  }
}

export function listTags(): TagInfo[] {
  const tagsDir = path.join(VCS_DIR, 'tags');
  if (!fs.existsSync(tagsDir)) return [];
  
  try {
    return fs.readdirSync(tagsDir)
      .filter(file => fs.statSync(path.join(tagsDir, file)).isFile())
      .map(name => {
        const commitId = fs.readFileSync(path.join(tagsDir, name), 'utf-8').trim();
        return { name, commitId };
      });
  } catch {
    return [];
  }
}

export function deleteTag(tagName: string): { success: boolean; message: string } {
  const tagPath = path.join(VCS_DIR, 'tags', tagName);
  if (!fs.existsSync(tagPath)) {
    return { success: false, message: `Tag "${tagName}" does not exist.` };
  }

  try {
    fs.unlinkSync(tagPath);
    logMessage('INFO', `Deleted tag "${tagName}"`);
    return { success: true, message: `Successfully deleted tag "${tagName}".` };
  } catch (error: any) {
    logMessage('ERROR', `Failed to delete tag: ${error.message}`);
    return { success: false, message: `Failed to delete tag: ${error.message}` };
  }
}

export function checkoutTag(tagName: string, force: boolean = false): { success: boolean; message: string; isDetached: boolean } {
  const tagPath = path.join(VCS_DIR, 'tags', tagName);
  if (!fs.existsSync(tagPath)) {
    return { success: false, message: `Tag "${tagName}" does not exist.`, isDetached: false };
  }

  try {
    const commitId = fs.readFileSync(tagPath, 'utf-8').trim();
    const result = checkoutTarget(commitId, force);
    if (result.success) {
      logMessage('INFO', `Checked out tag "${tagName}" (commit ${commitId.substring(0, 7)})`);
      return {
        success: true,
        message: `Successfully checked out tag "${tagName}" (detaching HEAD at commit ${commitId.substring(0, 7)}).`,
        isDetached: true
      };
    }
    return result;
  } catch (error: any) {
    return { success: false, message: `Failed to checkout tag: ${error.message}`, isDetached: false };
  }
}
