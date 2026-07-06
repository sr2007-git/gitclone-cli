import { getHistory } from './commit';
import { readObject, readCommit } from './storage';

export interface BlameLine {
  lineNumber: number;
  content: string;
  commitId: string;
  author: string;
  timestamp: string;
  message: string;
}

// LCS algorithm to map line inheritance from parent revision to child revision (Requirement 9)
export function computeLineLCS(prevLines: string[], newLines: string[]): { prevIndex: number; newIndex: number }[] {
  const m = prevLines.length;
  const n = newLines.length;
  
  // Quick check for empty or single line optimizations
  if (m === 0 || n === 0) return [];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (prevLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const matches: { prevIndex: number; newIndex: number }[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (prevLines[i - 1] === newLines[j - 1]) {
      matches.push({ prevIndex: i - 1, newIndex: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return matches.reverse();
}

export function getFileBlame(filePath: string, startCommitId: string): BlameLine[] | null {
  // Get full history from start commit (newest first)
  const historyDesc = getHistory(startCommitId);
  if (historyDesc.length === 0) return null;

  // Filter commits that actually contained the file
  const fileCommitsDesc = historyDesc.filter(commit => filePath in commit.snapshot);
  if (fileCommitsDesc.length === 0) return null;

  // Reverse to process chronologically from oldest to newest
  const fileCommitsAsc = [...fileCommitsDesc].reverse();

  let blameList: { content: string; commitId: string; author: string; timestamp: string; message: string }[] = [];

  for (let cIdx = 0; cIdx < fileCommitsAsc.length; cIdx++) {
    const commit = fileCommitsAsc[cIdx];
    const fileHash = commit.snapshot[filePath];
    const fileContent = readObject(fileHash);
    if (fileContent === null) continue;

    // Split file contents into lines (support CRLF / LF)
    const lines = fileContent.split(/\r?\n/);
    // If empty file, lines has one empty string, which is fine

    const commitMeta = {
      commitId: commit.id,
      author: commit.author,
      timestamp: commit.timestamp,
      message: commit.message
    };

    if (cIdx === 0) {
      // First commit: all lines are introduced by this commit
      blameList = lines.map(line => ({
        content: line,
        ...commitMeta
      }));
    } else {
      const prevCommit = fileCommitsAsc[cIdx - 1];
      const prevHash = prevCommit.snapshot[filePath];
      
      if (prevHash === fileHash) {
        // Unchanged file: blame remains identical to previous commit blame list
        continue;
      }

      const prevContent = readObject(prevHash) || '';
      const prevLines = prevContent.split(/\r?\n/);

      // Create a default blame list for the new revision attributing everything to this commit
      const currentBlame = lines.map(line => ({
        content: line,
        ...commitMeta
      }));

      // Compute LCS to see which lines matched the previous commit and retain their attribution
      const matches = computeLineLCS(prevLines, lines);
      for (const match of matches) {
        currentBlame[match.newIndex] = {
          content: lines[match.newIndex],
          commitId: blameList[match.prevIndex].commitId,
          author: blameList[match.prevIndex].author,
          timestamp: blameList[match.prevIndex].timestamp,
          message: blameList[match.prevIndex].message
        };
      }

      blameList = currentBlame;
    }
  }

  // Format response with line numbers (1-indexed)
  return blameList.map((entry, idx) => ({
    lineNumber: idx + 1,
    ...entry
  }));
}
