import { RepoStatusResult, Commit, BranchInfo, TagInfo } from '../types';

export interface LearnLesson {
  id: string;
  title: string;
  description: string;
  instructions: string;
  conceptText: string;
  realWorldImpact: string;
  graphPreviewDesc: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  estTime: string;
  check: (
    status: RepoStatusResult | null,
    history: Commit[],
    branches: BranchInfo[],
    tags: TagInfo[],
    playgroundStepCount: number
  ) => boolean;
}

export const LEARN_LESSONS: LearnLesson[] = [
  {
    id: 'lesson_repo',
    title: '1. The Repository & Hidden Database',
    description: 'Learn what a repository and the hidden .gitclone system folder represent.',
    instructions: 'Initialize your practice workspace repository or ensure it is initialized.',
    conceptText: 'Every version control system begins with a repository. In Git, a repository is just a directory on your computer containing all your project files, plus a special hidden database directory named `.git` (or `.gitclone` in GitClone).\n\nThis hidden directory contains the entire content-addressed database of your project’s history, storing every single commit, file snapshot, and branch pointer. If you delete this folder, you lose your entire history, but your current files remain completely untouched on disk.',
    realWorldImpact: 'In professional software engineering, running `git init` is the first command you ever run. It creates the hidden `.git` folder, instantly transforming a normal folder of files into a fully tracked, content-addressed database.',
    graphPreviewDesc: 'The commit graph starts with a clean starting point representing an initialized workspace database.',
    difficulty: 'Beginner',
    estTime: '2 mins',
    check: (status) => status?.isInitialized === true
  },
  {
    id: 'lesson_stage',
    title: '2. Tracking & Staging (The Index)',
    description: 'Understand the purpose of the staging area (index) and file tracking.',
    instructions: 'Create a new file or edit an existing file, then add it to the staging area.',
    conceptText: 'Before you can save your changes, you must tell Git which files should be included in the next snapshot. This is called "tracking" and "staging".\n\nThe staging area (or index) is a preparation zone. It is a simple list of file paths and their staged content hashes. This intermediate step allows you to craft cohesive commits, staging only a subset of your working changes rather than blindly committing everything at once.',
    realWorldImpact: 'Staging gives you precise control. If you fix a bug in `auth.js` and start writing a new feature in `profile.js`, you can stage and commit only `auth.js` first, keeping your commit logs clean and focused.',
    graphPreviewDesc: 'In the status view, staged files are shown in green (ready to be committed) while modified/unstaged files are shown in orange.',
    difficulty: 'Beginner',
    estTime: '3 mins',
    check: (status) => {
      return status?.files?.some(f => f.status === 'staged_new' || f.status === 'modified_staged' || f.status === 'staged_deleted') === true;
    }
  },
  {
    id: 'lesson_commit',
    title: '3. Immutable Commit Snapshots',
    description: 'Discover why commits are full immutable snapshots, not file diffs.',
    instructions: 'Commit your staged changes with a descriptive message in the Status or sidebar panel.',
    conceptText: 'A commit is the fundamental unit of history. Unlike other VCS platforms that store lists of file changes (diffs), GitClone stores a complete **snapshot** of your entire project directory at that specific moment.\n\nTo save space, Git uses content-addressable storage: if a file hasn\'t changed between commits, the new commit simply points to the existing stored version rather than duplicating it. Every commit is completely immutable and has a unique ID computed as a SHA-1 cryptographic hash of its contents, timestamp, author, and parent pointer.',
    realWorldImpact: 'Since commits are content-addressed and cryptographically linked, your project history is absolutely tamper-proof. If a single character in a file changes, its hash changes, alert-triggering immediate detection.',
    graphPreviewDesc: 'In the commit graph, each commit appears as a circular node. Hovering reveals its metadata and SHA-1 identifier.',
    difficulty: 'Beginner',
    estTime: '3 mins',
    check: (status, history) => history.length > 0
  },
  {
    id: 'lesson_branch',
    title: '4. Branches: Lightweight Pointers',
    description: 'Understand how branches work as simple pointers, not file copies.',
    instructions: 'Create a new branch named "feature-docs" in the Branches tab.',
    conceptText: 'In many traditional version control systems, creating a branch means duplicating your entire project folder. This is slow and wasteful.\n\nIn Git, a branch is incredibly simple: it is just a tiny text file containing a 40-character commit hash. It is literally a **moving pointer** to a commit node. Because a branch is just a pointer, creating a branch is instantaneous and uses virtually zero disk space, no matter how large your codebase is.',
    realWorldImpact: 'Since branching is instant and safe, modern teams create branches for every feature, bug fix, or experiment. This isolates work and prevents unstable code from breaking the production line.',
    graphPreviewDesc: 'In the commit graph, branch names appear as rectangular badges pointing directly to their corresponding commit nodes.',
    difficulty: 'Beginner',
    estTime: '2 mins',
    check: (status, history, branches) => branches.some(b => b.name === 'feature-docs')
  },
  {
    id: 'lesson_checkout',
    title: '5. Moving HEAD (Checkout)',
    description: 'Learn how checkout updates your working files and moves HEAD.',
    instructions: 'Switch (checkout) to your newly created branch "feature-docs" in the Branches drawer.',
    conceptText: 'If you have multiple branches, how does Git know which branch you are currently working on? It uses a special pointer called `HEAD`.\n\n`HEAD` is usually a "pointer to a pointer"—it points to a branch name, which in turn points to a commit. When you perform a **checkout**, Git moves the `HEAD` pointer to the target branch and, crucially, updates the actual files in your workspace directory to match that branch\'s latest snapshot.',
    realWorldImpact: 'Checking out is like teleporting through time and space. You can instantly switch between working on a new feature on `feature-docs` and a critical hotfix on `main` without having to copy files or manage multiple workspaces manually.',
    graphPreviewDesc: 'The commit graph displays a glowing ring or halo around the commit node that is currently checked out (HEAD).',
    difficulty: 'Beginner',
    estTime: '3 mins',
    check: (status) => status?.currentBranch === 'feature-docs'
  },
  {
    id: 'lesson_conflict',
    title: '6. Merge Conflict Safe Zone',
    description: 'Deliberately trigger and understand merge conflicts safely.',
    instructions: 'Click the "Trigger Merge Conflict" button below to set up a conflict on index.js, then go to the Conflicts tab.',
    conceptText: 'When you merge two branches that modified different files, Git merges them automatically. But if both branches modified the **same lines of the same file** in different ways, Git cannot decide which one to keep.\n\nThis is a **merge conflict**. Git halts the merge, marks the conflict in the files using conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), and asks you to choose. Merge conflicts are not failures; they are a safe guardrail preventing you from accidentally overwriting a teammate\'s changes.',
    realWorldImpact: 'Resolving merge conflicts safely is a core skill. Knowing the difference between "Ours" (your current branch) vs "Theirs" (the incoming branch) ensures you integrate code without introducing regression bugs.',
    graphPreviewDesc: 'The Conflicts tab lights up in red, offering side-by-side file contents (Ours vs Theirs vs Common Ancestor) with interactive resolution buttons.',
    difficulty: 'Intermediate',
    estTime: '5 mins',
    check: (status, history, branches, tags) => {
      return status?.files?.some(f => f.status === 'conflict') === true;
    }
  },
  {
    id: 'lesson_detached',
    title: '7. The Detached HEAD State',
    description: 'Explore the detached HEAD state and learn why it is harmless.',
    instructions: 'Checkout a specific commit directly by hash from the commit history dropdown or graph.',
    conceptText: 'Normally, `HEAD` points to a branch name (like `main`), which automatically moves forward when you make a commit. A **detached HEAD** state occurs when you checkout a specific commit SHA-1 hash directly instead of a branch name.\n\nIn this state, `HEAD` points directly to the commit. You can look around, run the code, and make experimental commits—but if you switch away, those experimental commits won\'t belong to any branch, and could be lost.',
    realWorldImpact: 'Detached HEAD is perfect for debugging. If a bug was introduced last week, you can checkout a commit from last week to see if the bug exists there, without affecting your current branch work.',
    graphPreviewDesc: 'In the commit graph, the HEAD pointer highlights a commit hash node with no branch label attached to it.',
    difficulty: 'Intermediate',
    estTime: '4 mins',
    check: (status) => status?.currentBranch === null && status?.currentCommitId !== null && status?.currentCommitId !== ''
  },
  {
    id: 'lesson_reflog',
    title: '8. Reflog Time-Travel Net',
    description: 'Use the Reference Log (reflog) to recover lost commits or undo mistakes.',
    instructions: 'Switch back to the "main" branch (checkout main) and ensure you have completed at least 6 step actions in total.',
    conceptText: 'What happens if you delete a branch by accident, or do a hard reset that seemingly deletes three commits? Are they gone forever?\n\nNo! Git has a local diary called the **Reflog** (Reference Log). Every time `HEAD` moves—whether you checkout, commit, reset, or merge—the reflog records the old and new hashes. Because Git doesn\'t actually delete commit objects immediately (they are kept in memory for a few weeks as "dangling commits"), you can find the lost commit hash in the reflog and checkout or reset to it, completely recovering your work!',
    realWorldImpact: 'The reflog is the ultimate panic button. Almost nothing committed to Git is truly lost. If you make a mistake, you can always open the reflog and restore your repository to exactly how it looked five minutes ago.',
    graphPreviewDesc: 'The Reflog panel shows a chronological list of actions with descriptions like "checkout: moving from main to feature-docs" or "commit: feat: authentication".',
    difficulty: 'Advanced',
    estTime: '5 mins',
    check: (status, history, branches, tags, stepCount) => {
      return status?.currentBranch === 'main' && stepCount >= 6;
    }
  }
];
