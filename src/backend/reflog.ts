import fs from 'fs';
import path from 'path';
import { VCS_DIR, logMessage } from './storage';
import { checkoutTarget } from './checkout';

export interface ReflogEntry {
  id: string;
  timestamp: string;
  action: string;
  before: string | null;
  after: string | null;
  message: string;
}

function getReflogPath(): string {
  return path.join(VCS_DIR, 'reflog.json');
}

export function readReflog(): ReflogEntry[] {
  const filePath = getReflogPath();
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

export function appendReflog(
  action: string,
  before: string | null,
  after: string | null,
  message: string
): void {
  try {
    const filePath = getReflogPath();
    const entry: ReflogEntry = {
      id: `reflog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      action,
      before,
      after,
      message
    };

    const list = readReflog();
    list.push(entry);
    
    // Create VCS_DIR if somehow not exists (for tests)
    if (!fs.existsSync(VCS_DIR)) {
      fs.mkdirSync(VCS_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
    logMessage('DEBUG', `Reflog added [${action}]: ${message}`);
  } catch (error: any) {
    logMessage('ERROR', `Reflog write error: ${error.message}`);
  }
}

export function resetToCommit(commitId: string): { success: boolean; message: string } {
  try {
    const beforeHead = checkoutTarget(commitId, true); // force checkout to go back safely
    if (beforeHead.success) {
      appendReflog('reset', null, commitId, `Reset HEAD to commit ${commitId.substring(0, 7)}`);
      return {
        success: true,
        message: `Successfully reset HEAD and working directory to commit ${commitId.substring(0, 7)}.`
      };
    }
    return { success: false, message: `Failed to reset HEAD: ${beforeHead.message}` };
  } catch (error: any) {
    return { success: false, message: `Reset error: ${error.message}` };
  }
}
