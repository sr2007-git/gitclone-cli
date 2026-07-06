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

export interface SandboxFile {
  relativePath: string;
  content: string;
  size: number;
}

export interface Commit {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  parent: string | null;
  parent2?: string | null;
  branch: string | null;
  snapshot: { [filePath: string]: string };
}

export interface BranchInfo {
  name: string;
  latestCommitId: string | null;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'normal';
  content: string;
  lineNumA?: number;
  lineNumB?: number;
}

export interface VCSInternals {
  head: { type: 'branch' | 'commit'; value: string } | null;
  index: { [filePath: string]: string };
  objectCount: number;
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

export interface TagInfo {
  name: string;
  commitId: string;
}

