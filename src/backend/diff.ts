import { readObject } from './storage';

export interface DiffLine {
  type: 'add' | 'remove' | 'normal';
  content: string;
  lineNumA?: number;
  lineNumB?: number;
}

export function computeLineDiff(textA: string | null, textB: string | null): DiffLine[] {
  const linesA = textA !== null ? textA.split(/\r?\n/) : [];
  const linesB = textB !== null ? textB.split(/\r?\n/) : [];

  const m = linesA.length;
  const n = linesB.length;

  // Simple LCS implementation
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const diff: DiffLine[] = [];
  let i = m;
  let j = n;

  // Backtrack to assemble diff in reverse order
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      diff.push({
        type: 'normal',
        content: linesA[i - 1],
        lineNumA: i,
        lineNumB: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({
        type: 'add',
        content: linesB[j - 1],
        lineNumB: j
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.push({
        type: 'remove',
        content: linesA[i - 1],
        lineNumA: i
      });
      i--;
    }
  }

  return diff.reverse();
}

export function diffObjects(hashA: string | null, hashB: string | null): DiffLine[] {
  const textA = hashA ? readObject(hashA) : '';
  const textB = hashB ? readObject(hashB) : '';
  return computeLineDiff(textA, textB);
}
