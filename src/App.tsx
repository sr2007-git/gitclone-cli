import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  Clock,
  FileCode,
  FilePlus,
  Trash2,
  RefreshCw,
  Search,
  ArrowRight,
  GitPullRequest,
  BookOpen,
  Sliders,
  AlertTriangle,
  Tag,
  Plus,
  Save,
  CheckCircle,
  Undo,
  Info,
  Calendar,
  FileText,
  Download,
  Lock,
  User,
  Sparkles,
  RotateCcw,
  RotateCw,
  Award,
  TrendingUp,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RepoStatusResult,
  SandboxFile,
  Commit,
  BranchInfo,
  DiffLine,
  VCSInternals,
  FileStatus,
  ConflictInfo,
  TagInfo
} from './types';
import { CommitGraph } from './components/CommitGraph';
import { VCSBackdrop } from './components/VCSBackdrop';
import { FileTree } from './components/FileTree';
import { MascotCompanion } from './components/MascotCompanion';
import { exportRepoToPDF } from './utils/pdfExport';
import { LEARN_LESSONS, LearnLesson } from './data/lessons';

export interface Challenge {
  title: string;
  description: string;
  instructions: string;
  check: (status: RepoStatusResult | null, history: Commit[], branches: BranchInfo[], tags: TagInfo[]) => boolean;
}

export const PLAYGROUND_CHALLENGES: Challenge[] = [
  {
    title: "1. Create Your First Commit",
    description: "Welcome to GitClone! The first step in any repository is recording a snapshot of your files.",
    instructions: "Create or modify any sandbox file, stage it (add to index), and commit it with a message.",
    check: (status, history) => history.length > 0
  },
  {
    title: "2. Branching Out",
    description: "Branches are lightweight pointers to commits. They let you develop new features in isolation.",
    instructions: "Create a new branch named 'feature-login' to start work on a login screen.",
    check: (status, history, branches) => branches.some(b => b.name === 'feature-login')
  },
  {
    title: "3. Commit on Feature Branch",
    description: "Now that you have a feature branch, you want to record progress on it without affecting the main branch.",
    instructions: "Switch to your new 'feature-login' branch and commit a file change.",
    check: (status, history) => status?.currentBranch === 'feature-login' && history.length >= 2
  },
  {
    title: "4. Reconcile and Merge",
    description: "Integrating feature branches back into your main line is the heartbeat of collaborative VCS.",
    instructions: "Switch back to the 'main' branch and merge 'feature-login' into it.",
    check: (status, history, branches) => status?.currentBranch === 'main' && history.some(c => c.parent && c.parent2)
  },
  {
    title: "5. Immortalize with Tags",
    description: "Tags are immutable bookmarks that label specific milestones, like releases, in your history.",
    instructions: "Create a lightweight tag named 'v1.0' on your latest merged commit.",
    check: (status, history, branches, tags) => tags.some(t => t.name === 'v1.0')
  }
];

// Define custom stable fetch wrapper to support iframe authentication without cookie issues
const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const token = localStorage.getItem('gc_session_token');
  init = init || {};
  init.headers = { ...init.headers };

  if (token) {
    (init.headers as any)['Authorization'] = `Bearer ${token}`;
    (init.headers as any)['x-session-token'] = token;
  }

  if ((window as any).isPlaygroundModeActive) {
    (init.headers as any)['x-is-playground'] = 'true';
    if (typeof input === 'string') {
      const separator = input.includes('?') ? '&' : '?';
      input = `${input}${separator}playground=true`;
    } else if (input instanceof URL) {
      input.searchParams.set('playground', 'true');
    }
  }
  return window.fetch(input, init);
};

const fetch = customFetch;

export default function App() {
  // Navigation & Active Tab
  const [activeTab, setActiveTab] = useState<string>('landing');

  // --- ADDITIONAL CORE STATES FOR GOD-TIER VCS FUNCTIONALITY ---
  const [isPlaygroundActive, setIsPlaygroundActive] = useState<boolean>(false);
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);
  
  // Playground & Challenges
  const [activeSubTab, setActiveSubTab] = useState<'lessons' | 'golf' | 'internals'>('lessons');
  const [currentLessonIndex, setCurrentLessonIndex] = useState<number>(0);
  const [completedLessons, setCompletedLessons] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('gc_completed_lessons');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentChallengeIndex, setCurrentChallengeIndex] = useState<number>(0);
  const [playgroundStepCount, setPlaygroundStepCount] = useState<number>(0);
  const [bestScores, setBestScores] = useState<{ [title: string]: number }>(() => {
    try {
      const saved = localStorage.getItem('gc_playground_best_scores');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Branch Comparison
  const [branchCompareA, setBranchCompareA] = useState<string>('');
  const [branchCompareB, setBranchCompareB] = useState<string>('');
  const [compareResults, setCompareResults] = useState<{ uniqueToA: Commit[]; uniqueToB: Commit[] } | null>(null);

  // Sync state with window global for customFetch transparency
  useEffect(() => {
    (window as any).isPlaygroundModeActive = isPlaygroundActive;
  }, [isPlaygroundActive]);

  // Reduced Motion Preference
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  // Authentication States
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Core States
  const [status, setStatus] = useState<RepoStatusResult | null>(null);
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [history, setHistory] = useState<Commit[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [internals, setInternals] = useState<VCSInternals | null>(null);

  // Tag Form States
  const [newTagName, setNewTagName] = useState('');
  const [tagCommitId, setTagCommitId] = useState('');

  // Conflict Resolution States
  const [activeConflicts, setActiveConflicts] = useState<ConflictInfo[]>([]);
  const [conflictTargetBranch, setConflictTargetBranch] = useState<string | null>(null);
  const [conflictOursCommitId, setConflictOursCommitId] = useState<string | null>(null);
  const [conflictTheirsCommitId, setConflictTheirsCommitId] = useState<string | null>(null);
  const [resolvedFiles, setResolvedFiles] = useState<{ [path: string]: { content: string; mode: 'ours' | 'theirs' | 'manual' } }>({});
  const [manualEditPath, setManualEditPath] = useState<string | null>(null);
  const [manualEditContent, setManualEditContent] = useState<string>('');

  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBranch, setSearchBranch] = useState('');
  const [searchDateStart, setSearchDateStart] = useState('');
  const [searchDateEnd, setSearchDateEnd] = useState('');
  const [searchResults, setSearchResults] = useState<Commit[]>([]);

  // Sandbox File Editor States
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  // Playground interactive states
  const [lesson2Path, setLesson2Path] = useState('welcome.js');
  const [lesson2Content, setLesson2Content] = useState('console.log("Welcome to GitClone!");');
  const [lesson3Message, setLesson3Message] = useState('feat: record first snapshot');
  const [lesson4Branch, setLesson4Branch] = useState('feature-docs');
  const [lesson5TargetBranch, setLesson5TargetBranch] = useState('feature-docs');
  const [lesson7TargetCommit, setLesson7TargetCommit] = useState('');

  // Commit Form States
  const [commitMessage, setCommitMessage] = useState('');
  const [authorName, setAuthorName] = useState('Developer <developer@gitclone.internal>');
  const [autoCreateTag, setAutoCreateTag] = useState(false);

  // Remote Repository Synchronization States
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('https://github.com/developer/sandbox.git');
  const [remoteStatus, setRemoteStatus] = useState<'synced' | 'ahead' | 'pushing' | 'not_configured'>('not_configured');
  const [aheadCount, setAheadCount] = useState(0);
  const [isPushing, setIsPushing] = useState(false);
  const [pushLogs, setPushLogs] = useState<string[]>([]);
  const [pushProgress, setPushProgress] = useState<number | null>(null);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);

  // Diff States
  const [diffFile, setDiffFile] = useState<string>('');
  const [diffMode, setDiffMode] = useState<'working_vs_staged' | 'staged_vs_committed' | 'commit_vs_commit'>('working_vs_staged');
  const [diffCommitA, setDiffCommitA] = useState('');
  const [diffCommitB, setDiffCommitB] = useState('');
  const [diffResult, setDiffResult] = useState<DiffLine[]>([]);

  // Branch Form
  const [newBranchName, setNewBranchName] = useState('');

  // Notifications / Alerts
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isForceCheckout, setIsForceCheckout] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Helper to trigger alert
  const showAlert = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setAlertMessage({ type, text });
    setTimeout(() => setAlertMessage(null), 6000);
  };

  // FETCH ROUTINES
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
      if (data.isInitialized) {
        fetchInternals();
      }
    } catch (e: any) {
      console.error('Failed to fetch status', e);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/sandbox/files');
      const data = await res.json();
      if (data.success) {
        setFiles(data.files);
        // Automatically select the first file for editor if none selected
        if (data.files.length > 0 && !selectedFile) {
          setSelectedFile(data.files[0].relativePath);
          setEditorContent(data.files[0].content);
        }
      }
    } catch (e: any) {
      console.error('Failed to fetch sandbox files', e);
    }
  }, [selectedFile]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch('/api/branches');
      const data = await res.json();
      if (data.success) {
        setBranches(data.branches);
      }
    } catch (e: any) {
      console.error('Failed to fetch branches', e);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.success) {
        setHistory(data.history);
      }
    } catch (e: any) {
      console.error('Failed to fetch history', e);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags');
      const data = await res.json();
      if (data.success) {
        setTags(data.tags);
      }
    } catch (e: any) {
      console.error('Failed to fetch tags', e);
    }
  }, []);

  const fetchInternals = useCallback(async () => {
    try {
      const res = await fetch('/api/internals');
      const data = await res.json();
      if (data.success) {
        setInternals({
          head: data.head,
          index: data.index,
          objectCount: data.objectCount
        });
      }
    } catch (e: any) {
      console.error('Failed to fetch internals', e);
    }
  }, []);

  const fetchDiff = useCallback(async () => {
    if (!diffFile) return;
    try {
      const params = new URLSearchParams({
        path: diffFile,
        mode: diffMode,
        commitA: diffCommitA,
        commitB: diffCommitB
      });
      const res = await fetch(`/api/diff?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setDiffResult(data.diff);
      } else {
        showAlert(data.message || 'Failed to compute diff', 'error');
        setDiffResult([]);
      }
    } catch (e: any) {
      console.error('Failed to fetch diff', e);
    }
  }, [diffFile, diffMode, diffCommitA, diffCommitB]);

  const fetchSearchResults = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        branch: searchBranch,
        start: searchDateStart,
        end: searchDateEnd
      });
      const res = await fetch(`/api/commits/search?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.commits);
      }
    } catch (e: any) {
      console.error('Failed to search commits', e);
    }
  }, [searchQuery, searchBranch, searchDateStart, searchDateEnd]);

  // Master refresh
  const refreshAll = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      fetchStatus(),
      fetchFiles(),
      fetchBranches(),
      fetchHistory(),
      fetchTags(),
      fetchSearchResults()
    ]).finally(() => {
      setIsLoading(false);
    });
  }, [fetchStatus, fetchFiles, fetchBranches, fetchHistory, fetchTags, fetchSearchResults]);

  const checkAuthSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
        setCurrentUser(data.username);
        setActiveTab((prev) => (prev === 'landing' || prev === 'login' ? 'dashboard' : prev));
        return true;
      } else {
        setIsAuthenticated(false);
        setCurrentUser(null);
        localStorage.removeItem('gc_session_token');
        setActiveTab('landing');
        return false;
      }
    } catch (e) {
      setIsAuthenticated(false);
      setCurrentUser(null);
      localStorage.removeItem('gc_session_token');
      setActiveTab('landing');
      return false;
    }
  }, []);

  const handleQuickLogin = async () => {
    setIsLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'developer',
          password: 'password123'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setCurrentUser(data.username);
        if (data.token) {
          localStorage.setItem('gc_session_token', data.token);
        }
        setLoginUsername('');
        setLoginPassword('');
        showAlert(`Welcome back, ${data.username}!`, 'success');
        setActiveTab('dashboard');
        // Now refresh all
        Promise.all([
          fetchStatus(),
          fetchFiles(),
          fetchBranches(),
          fetchHistory(),
          fetchTags(),
          fetchSearchResults()
        ]);
      } else {
        setLoginError(data.message || 'Invalid username or password');
      }
    } catch (err: any) {
      setLoginError(`Login failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim()) {
      setLoginError('Username cannot be empty');
      return;
    }
    if (!loginPassword.trim()) {
      setLoginError('Password cannot be empty');
      return;
    }
    setIsLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setCurrentUser(data.username);
        if (data.token) {
          localStorage.setItem('gc_session_token', data.token);
        }
        setLoginUsername('');
        setLoginPassword('');
        showAlert(`Welcome back, ${data.username}!`, 'success');
        setActiveTab('dashboard');
        // Now refresh all
        Promise.all([
          fetchStatus(),
          fetchFiles(),
          fetchBranches(),
          fetchHistory(),
          fetchTags(),
          fetchSearchResults()
        ]);
      } else {
        setLoginError(data.message || 'Invalid username or password');
      }
    } catch (err: any) {
      setLoginError(`Login failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        localStorage.removeItem('gc_session_token');
        showAlert('Logged out successfully', 'info');
        setActiveTab('landing');
      } else {
        showAlert('Logout failed', 'error');
      }
    } catch (err: any) {
      showAlert(`Logout error: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Enforce route protection: if user is not authenticated, restrict active tab to landing, login, or developer-login
  useEffect(() => {
    if (isAuthenticated === false) {
      if (activeTab !== 'landing' && activeTab !== 'login' && activeTab !== 'developer-login') {
        setActiveTab('login');
      }
    }
  }, [isAuthenticated, activeTab]);

  // --- GOD-TIER CORE ACTIONS ---
  
  const saveUndoState = async () => {
    try {
      const res = await fetch('/api/undo-redo/snapshot');
      const data = await res.json();
      if (data.success) {
        setUndoStack(prev => [...prev, data.snapshot]);
        setRedoStack([]); // Clear redo stack on new state mutation
      }
    } catch (e) {
      console.error('Failed to save undo state snapshot', e);
    }
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    setIsLoading(true);
    try {
      const currentRes = await fetch('/api/undo-redo/snapshot');
      const currentData = await currentRes.json();
      
      const previousSnapshot = undoStack[undoStack.length - 1];
      const newUndoStack = undoStack.slice(0, -1);
      
      const restoreRes = await fetch('/api/undo-redo/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: previousSnapshot })
      });
      const restoreData = await restoreRes.json();
      
      if (restoreData.success) {
        if (currentData.success) {
          setRedoStack(prev => [...prev, currentData.snapshot]);
        }
        setUndoStack(newUndoStack);
        showAlert('Undone last action successfully!', 'success');
        refreshAll();
      } else {
        showAlert(restoreData.message || 'Failed to undo action.', 'error');
      }
    } catch (e: any) {
      showAlert(`Undo failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    setIsLoading(true);
    try {
      const currentRes = await fetch('/api/undo-redo/snapshot');
      const currentData = await currentRes.json();
      
      const nextSnapshot = redoStack[redoStack.length - 1];
      const newRedoStack = redoStack.slice(0, -1);
      
      const restoreRes = await fetch('/api/undo-redo/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: nextSnapshot })
      });
      const restoreData = await restoreRes.json();
      
      if (restoreData.success) {
        if (currentData.success) {
          setUndoStack(prev => [...prev, currentData.snapshot]);
        }
        setRedoStack(newRedoStack);
        showAlert('Redone action successfully!', 'success');
        refreshAll();
      } else {
        showAlert(restoreData.message || 'Failed to redo action.', 'error');
      }
    } catch (e: any) {
      showAlert(`Redo failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestCommitMessage = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/ai/suggest-commit', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCommitMessage(data.suggestion);
        showAlert('AI suggested commit message!', 'success');
      } else {
        showAlert('AI suggestion failed', 'error');
      }
    } catch (e: any) {
      showAlert(`AI suggestion failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBranchCompare = async () => {
    if (!branchCompareA || !branchCompareB) {
      showAlert('Please select two branches to compare.', 'error');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/branches/compare?branchA=${encodeURIComponent(branchCompareA)}&branchB=${encodeURIComponent(branchCompareB)}`);
      const data = await res.json();
      if (data.success) {
        setCompareResults({
          uniqueToA: data.uniqueToA,
          uniqueToB: data.uniqueToB
        });
        showAlert(`Compared branches successfully!`, 'success');
      } else {
        showAlert(data.message || 'Comparison failed', 'error');
      }
    } catch (e: any) {
      showAlert(`Branch comparison failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPlayground = async () => {
    if (!confirm('Are you sure you want to reset the playground repository? All custom files, branches, and commit histories in the playground sandbox will be deleted.')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/playground/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setUndoStack([]);
        setRedoStack([]);
        setPlaygroundStepCount(0);
        showAlert('Playground environment reset!', 'success');
        
        // Auto init
        const initRes = await fetch('/api/init', { method: 'POST' });
        const initData = await initRes.json();
        if (initData.success) {
          showAlert('Playground initialized and ready to practice.', 'success');
        }
        refreshAll();
      } else {
        showAlert(data.message || 'Reset failed', 'error');
      }
    } catch (e: any) {
      showAlert(`Reset failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const incrementPlaygroundSteps = () => {
    if (isPlaygroundActive) {
      setPlaygroundStepCount(prev => prev + 1);
    }
  };

  // Handle initialization on mount
  useEffect(() => {
    checkAuthSession().then((loggedIn) => {
      if (loggedIn) {
        refreshAll();
      }
    });
  }, [checkAuthSession]);

  // Update diff when file or parameters change
  useEffect(() => {
    if (isAuthenticated && diffFile) {
      fetchDiff();
    }
  }, [isAuthenticated, diffFile, diffMode, diffCommitA, diffCommitB, fetchDiff]);

  // Update search results when filters change
  useEffect(() => {
    if (isAuthenticated) {
      fetchSearchResults();
    }
  }, [isAuthenticated, searchQuery, searchBranch, searchDateStart, searchDateEnd, fetchSearchResults]);

  // Automated, real-time check for interactive lesson completion against the practice repository
  useEffect(() => {
    if (isPlaygroundActive && activeTab === 'playground' && activeSubTab === 'lessons') {
      const lesson = LEARN_LESSONS[currentLessonIndex];
      if (lesson && !completedLessons.includes(lesson.id)) {
        const isCompleted = lesson.check(status, history, branches, tags, playgroundStepCount);
        if (isCompleted) {
          const updated = [...completedLessons, lesson.id];
          setCompletedLessons(updated);
          localStorage.setItem('gc_completed_lessons', JSON.stringify(updated));
          showAlert(`🎉 Lesson Completed: "${lesson.title}"! Excellent job.`, 'success');
        }
      }
    }
  }, [status, history, branches, tags, isPlaygroundActive, activeTab, activeSubTab, currentLessonIndex, completedLessons, playgroundStepCount]);

  // --- INTERACTIVE QUICK ACTIONS FOR LESSONS ---
  const handleQuickCreateFile = async (filePath: string, fileContent: string) => {
    setIsLoading(true);
    incrementPlaygroundSteps();
    try {
      // 1. Write the file content
      const writeRes = await fetch('/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: fileContent })
      });
      const writeData = await writeRes.json();
      if (!writeData.success) {
        showAlert(`File creation failed: ${writeData.message}`, 'error');
        return;
      }

      // 2. Stage the file (track it)
      const trackRes = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const trackData = await trackRes.json();
      if (trackData.success) {
        showAlert(`Successfully created and staged file "${filePath}"!`, 'success');
        refreshAll();
      } else {
        showAlert(`File created, but staging failed: ${trackData.message}`, 'error');
      }
    } catch (err: any) {
      showAlert(`Quick action failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickCommit = async (message: string) => {
    if (!message.trim()) {
      showAlert('Please enter a commit message.', 'error');
      return;
    }
    await saveUndoState();
    setIsLoading(true);
    incrementPlaygroundSteps();
    try {
      const res = await fetch('/api/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), author: 'Student <student@gitclone.internal>' })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || 'Successfully recorded commit snapshot!', 'success');
        refreshAll();
      } else {
        showAlert(data.message || 'Commit failed.', 'error');
      }
    } catch (err: any) {
      showAlert(`Commit failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickCreateBranch = async (branchName: string) => {
    if (!branchName.trim()) {
      showAlert('Branch name cannot be empty', 'error');
      return;
    }
    await saveUndoState();
    setIsLoading(true);
    incrementPlaygroundSteps();
    try {
      const res = await fetch('/api/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: branchName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || `Successfully created branch pointer "${branchName}"!`, 'success');
        refreshAll();
      } else {
        showAlert(data.message || 'Branch creation failed.', 'error');
      }
    } catch (err: any) {
      showAlert(`Branch creation failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickCheckout = async (target: string) => {
    if (!target) return;
    await saveUndoState();
    setIsLoading(true);
    incrementPlaygroundSteps();
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, force: true })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || `HEAD moved to "${target}"! Workspace files updated on disk.`, 'success');
        refreshAll();
      } else {
        showAlert(data.message || 'Checkout failed.', 'error');
      }
    } catch (err: any) {
      showAlert(`Checkout failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickTriggerConflict = async () => {
    await saveUndoState();
    setIsLoading(true);
    incrementPlaygroundSteps();
    try {
      const res = await fetch('/api/playground/trigger-conflict', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message || 'Failed to trigger conflict.', 'error');
      }
    } catch (err: any) {
      showAlert(`Conflict action failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // API ACTIONS
  const handleInitRepo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/init', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Initialization failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInitRepoAndGoToLearn = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/init', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showAlert('Repository initialized! Welcome to the Interactive Learn VCS Academy.', 'success');
        setIsPlaygroundActive(true);
        setActiveTab('playground');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Initialization failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportRepository = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Export failed with status ${res.status}`);
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gitclone-repository.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showAlert('Repository backup ZIP downloaded successfully!', 'success');
    } catch (e: any) {
      console.error('Failed to export repository', e);
      showAlert(e.message || 'Failed to export repository ZIP.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = () => {
    setIsLoading(true);
    try {
      if (!status?.isInitialized) {
        throw new Error('Repository is not initialized. Please initialize first before exporting report.');
      }
      exportRepoToPDF(status, history, branches);
      showAlert('VCS Repository Audit Report generated and downloaded successfully as a PDF!', 'success');
    } catch (e: any) {
      console.error('Failed to export PDF report', e);
      showAlert(e.message || 'Failed to export PDF report.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTrackFile = async (filePath?: string) => {
    await saveUndoState();
    incrementPlaygroundSteps();
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Tracking failed: ${e.message}`, 'error');
    }
  };

  const triggerRemotePush = async (currentHeadId?: string | null) => {
    setIsPushing(true);
    setRemoteStatus('pushing');
    setPushProgress(10);
    setPushLogs([`Connecting to remote repository at ${remoteUrl}...`]);

    const logsAndProgress = [
      { delay: 400, progress: 30, log: 'Posterity: authenticating developer@gitclone.internal...' },
      { delay: 800, progress: 50, log: 'Counting objects: 100% (5/5), done.' },
      { delay: 1200, progress: 70, log: 'Compressing objects: 100% (3/3), done.' },
      { delay: 1600, progress: 90, log: 'Writing objects: 100% (3/3), 482 bytes | 241 KiB/s, done.' },
      { delay: 2000, progress: 100, log: `To ${remoteUrl}\n   ${currentHeadId?.substring(0, 7) || status?.currentCommitId?.substring(0, 7) || 'HEAD'}..main -> main\nBranch main synchronized with remote server.` }
    ];

    for (const step of logsAndProgress) {
      await new Promise(resolve => setTimeout(resolve, step.delay - (logsAndProgress[logsAndProgress.indexOf(step) - 1]?.delay || 0)));
      setPushProgress(step.progress);
      setPushLogs(prev => [...prev, step.log]);
    }

    await new Promise(resolve => setTimeout(resolve, 300));
    setIsPushing(false);
    setRemoteStatus('synced');
    setAheadCount(0);
    setPushProgress(null);
    showAlert('Push completed successfully! Remote is fully synchronized.', 'success');
  };

  const executeCommit = async (shouldPush: boolean) => {
    if (!commitMessage.trim()) {
      showAlert('Please enter a commit message.', 'error');
      return;
    }
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    const msgToTag = commitMessage.trim();
    const isPushingFlow = shouldPush && remoteEnabled;
    try {
      const res = await fetch('/api/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage, author: authorName })
      });
      const data = await res.json();
      if (data.success) {
        // If remote is enabled but we aren't pushing yet, increment the ahead count
        if (remoteEnabled && !isPushingFlow) {
          setAheadCount(prev => prev + 1);
          setRemoteStatus('ahead');
        }

        if (autoCreateTag && data.commit?.id) {
          try {
            const tagRes = await fetch('/api/tags/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: msgToTag, commitId: data.commit.id })
            });
            const tagData = await tagRes.json();
            if (tagData.success) {
              showAlert(`Created commit and automatic lightweight tag "${msgToTag}"`, 'success');
            } else {
              showAlert(`Commit succeeded, but tag creation failed: ${tagData.message}`, 'error');
            }
          } catch (tagErr: any) {
            showAlert(`Commit succeeded, but tag creation failed: ${tagErr.message}`, 'error');
          }
        } else if (!isPushingFlow) {
          showAlert(data.message, 'success');
        }
        setCommitMessage('');
        refreshAll();

        // If pushing flow was requested, start the push animation
        if (isPushingFlow) {
          await triggerRemotePush(data.commit?.id);
        }
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Commit failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeCommit(false);
  };

  const handleCommitAndPush = async (e: React.MouseEvent) => {
    e.preventDefault();
    await executeCommit(true);
  };

  const handleCheckout = async (target: string) => {
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, force: isForceCheckout })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Checkout failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) {
      showAlert('Branch name cannot be empty', 'error');
      return;
    }
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBranchName })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        setNewBranchName('');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Create branch failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    if (!confirm(`Are you sure you want to delete branch "${name}"?`)) return;
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch(`/api/branch?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Delete branch failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) {
      showAlert('Tag name cannot be empty', 'error');
      return;
    }
    if (!tagCommitId.trim()) {
      showAlert('Commit ID cannot be empty', 'error');
      return;
    }
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/tags/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), commitId: tagCommitId.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || `Successfully created tag '${newTagName}'`, 'success');
        setNewTagName('');
        setTagCommitId('');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Create tag failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTag = async (name: string) => {
    if (!confirm(`Are you sure you want to delete tag "${name}"?`)) return;
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch(`/api/tags/delete?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || `Successfully deleted tag '${name}'`, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Delete tag failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckoutTag = async (name: string) => {
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/tags/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message || `Successfully checked out tag '${name}'`, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Checkout tag failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Conflict Resolution Action Handlers
  const handleMerge = async (targetBranch: string) => {
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetBranch })
      });
      const data = await res.json();
      if (data.conflict) {
        showAlert('Merge conflict detected! Competing content hashes must be resolved.', 'error');
        setActiveConflicts(data.conflicts);
        setConflictTargetBranch(data.targetBranch);
        setConflictOursCommitId(data.oursCommitId);
        setConflictTheirsCommitId(data.theirsCommitId);
        
        // Pre-fill resolvedFiles with 'ours' option as default
        const initialResolutions: typeof resolvedFiles = {};
        data.conflicts.forEach((c: ConflictInfo) => {
          initialResolutions[c.path] = {
            content: c.oursContent,
            mode: 'ours'
          };
        });
        setResolvedFiles(initialResolutions);
        
        // Pre-fill standard merge commit message
        setCommitMessage(`Merge branch '${data.targetBranch}' into '${status?.currentBranch || 'active-head'}'`);
        
        setActiveTab('conflicts');
      } else if (data.success) {
        showAlert(data.message, 'success');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Merge failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChooseResolution = (filePath: string, mode: 'ours' | 'theirs' | 'manual', content: string) => {
    setResolvedFiles(prev => ({
      ...prev,
      [filePath]: { content, mode }
    }));
  };

  const handleResolveConflictFile = async (filePath: string) => {
    const resolution = resolvedFiles[filePath];
    if (!resolution) {
      showAlert('No resolution chosen', 'error');
      return;
    }
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      // 1. Write the resolved content to the sandbox file
      const saveRes = await fetch('/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: resolution.content })
      });
      const saveData = await saveRes.json();
      if (!saveData.success) {
        throw new Error(saveData.message || 'Failed to save file content');
      }

      // 2. Stage the file (track changes in index)
      const trackRes = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const trackData = await trackRes.json();
      if (!trackData.success) {
        throw new Error(trackData.message || 'Failed to stage file');
      }

      showAlert(`Resolved and staged: ${filePath}`, 'success');
      
      // Remove file from active conflicts list
      setActiveConflicts(prev => prev.filter(c => c.path !== filePath));
      refreshAll();
    } catch (e: any) {
      showAlert(`Resolution failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteMergeCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) {
      showAlert('Commit message is required', 'error');
      return;
    }
    await saveUndoState();
    incrementPlaygroundSteps();
    setIsLoading(true);
    try {
      const res = await fetch('/api/merge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage.trim(),
          author: authorName,
          parentCommitId: conflictOursCommitId,
          parent2CommitId: conflictTheirsCommitId
        })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(data.message, 'success');
        // Clear conflict state
        setActiveConflicts([]);
        setConflictTargetBranch(null);
        setConflictOursCommitId(null);
        setConflictTheirsCommitId(null);
        setResolvedFiles({});
        setCommitMessage('');
        setActiveTab('history');
        refreshAll();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (e: any) {
      showAlert(`Merge commit completion failed: ${e.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Sandbox Playground Actions
  const handleSelectFile = async (path: string) => {
    try {
      const res = await fetch(`/api/sandbox/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.success) {
        setSelectedFile(path);
        setEditorContent(data.content);
      }
    } catch (e) {
      showAlert('Failed to read file contents', 'error');
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    try {
      const res = await fetch('/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: editorContent })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Saved changes to ${selectedFile}`, 'success');
        refreshAll();
      }
    } catch (e) {
      showAlert('Failed to save file changes', 'error');
    }
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim()) {
      showAlert('File path is required', 'error');
      return;
    }
    try {
      const res = await fetch('/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newFilePath, content: newFileContent })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Created file ${newFilePath}`, 'success');
        setShowNewFileModal(false);
        setSelectedFile(newFilePath);
        setEditorContent(newFileContent);
        setNewFilePath('');
        setNewFileContent('');
        refreshAll();
      }
    } catch (e) {
      showAlert('Failed to create file', 'error');
    }
  };

  const handleTreeCreateFile = async (path: string, content: string = '') => {
    try {
      const res = await fetch('/api/sandbox/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content })
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Created successfully: ${path}`, 'success');
        // If it's a real code/text file (not a placeholder .gitkeep), select it
        if (!path.endsWith('.gitkeep')) {
          setSelectedFile(path);
          setEditorContent(content);
        }
        refreshAll();
      } else {
        showAlert(data.message || 'Failed to create item', 'error');
      }
    } catch (e: any) {
      showAlert(`Creation failed: ${e.message}`, 'error');
    }
  };

  const handleDeleteFile = async (path: string) => {
    if (!confirm(`Are you sure you want to delete "${path}" from your working directory?`)) return;
    try {
      const res = await fetch(`/api/sandbox/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showAlert(`Deleted file "${path}"`, 'success');
        if (selectedFile === path) {
          setSelectedFile(null);
          setEditorContent('');
        }
        refreshAll();
      }
    } catch (e) {
      showAlert('Failed to delete file', 'error');
    }
  };

  // Helper to get status class names
  const getStatusBadge = (fileStatus: FileStatus['status']) => {
    switch (fileStatus) {
      case 'untracked':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#D9D8D5] text-[#141414] border border-[#141414] uppercase">untracked</span>;
      case 'staged_new':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E8F5E9] text-emerald-950 border border-emerald-900 uppercase">staged: new</span>;
      case 'modified_staged':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E8F5E9] text-emerald-950 border border-emerald-900 uppercase">staged: mod</span>;
      case 'modified_unstaged':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#FFF3E0] text-amber-950 border border-amber-900 uppercase">unstaged: mod</span>;
      case 'deleted_unstaged':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#FFEBEE] text-rose-950 border border-rose-900 uppercase">unstaged: del</span>;
      case 'staged_deleted':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E8F5E9] text-emerald-950 border border-emerald-900 uppercase">staged: del</span>;
      case 'up_to_date':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#E3F2FD] text-blue-950 border border-blue-900 uppercase">tracked</span>;
      case 'conflict':
        return <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-[#FFEBEE] text-rose-950 border border-rose-900 uppercase animate-pulse">conflict</span>;
      default:
        return null;
    }
  };

  const renderLandingPage = () => {
    // Framer motion animation variants for core capabilities section
    const containerVariants = {
      hidden: { opacity: 0 },
      visible: {
        opacity: 1,
        transition: { staggerChildren: 0.04 }
      }
    };

    const cardVariants = {
      hidden: { opacity: 0, y: 12 },
      visible: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 120, damping: 16 }
      }
    };

    const containerAnimateProps = reducedMotion
      ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
      : {
          initial: "hidden",
          whileInView: "visible",
          viewport: { once: true, margin: "-40px" },
          variants: containerVariants
        };

    const capabilities = [
      {
        title: 'Sandbox Workspace',
        desc: 'Create, modify, and delete mock file revisions inside a robust, isolated sandbox folder directory on-disk.'
      },
      {
        title: 'Snapshot Committing',
        desc: 'Stage changed files and commit snapshots with message metadata, author info, and cryptographic SHA-1 hashes.'
      },
      {
        title: 'Lineage History',
        desc: 'Render interactive, full-fidelity repository commit lineage structures and state tracking networks.'
      },
      {
        title: 'Active Branching',
        desc: 'Create, switch, and delete branch pointers dynamically, with clear HEAD state detached and detached-branch awareness.'
      },
      {
        title: 'Lightweight Tagging',
        desc: 'Add version references (lightweight tags) to specific snapshots and check out exact past release points.'
      },
      {
        title: 'Conflict Resolution',
        desc: 'Identify and resolve three-way merge conflict blocks interactively, staging either version or editing manually.'
      },
      {
        title: 'Line Difference Engine',
        desc: 'View comprehensive line-by-line diff reports across working, staging index, and different commit snapshots.'
      },
      {
        title: 'Core Internals Inspection',
        desc: 'Inspect the live staging index, active HEAD pointers, and raw SHA-1 content object stores inside the workspace.'
      },
      {
        title: 'Visual PDF Exports',
        desc: 'Generate and download highly professional, beautifully formatted PDF audit summaries of all repository states.'
      }
    ];

    return (
      <div className="flex-1 flex flex-col bg-[#E4E3E0]">
        {/* HERO SECTION */}
        <section className="relative w-full border-b border-[#141414]/15 overflow-hidden bg-[#E4E3E0]">
          {/* Ambient 3D Commit Branching Graph backdrop */}
          <VCSBackdrop />
          
          <div className="relative z-10 py-16 md:py-24 px-6 max-w-5xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 bg-[#141414] text-[#E4E3E0] text-[11px] font-mono uppercase font-bold tracking-widest border border-[#141414] shadow-[2px_2px_0px_#888888]">
              <GitPullRequest className="w-3.5 h-3.5" />
              <span>Local Version Control System</span>
            </div>
            
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-mono font-bold uppercase text-[#141414] tracking-tight leading-tight max-w-3xl mx-auto">
              A raw, visual content-addressable file database
            </h1>
            
            <p className="text-sm sm:text-base md:text-lg font-serif italic text-zinc-700 max-w-2xl mx-auto leading-relaxed">
              GitClone is a high-fidelity local version control engine. Track edits, build branching hierarchies, visualize revision graphs, and resolve three-way merge conflicts in a clean, sandboxed workspace.
            </p>

            <div className="pt-4 sm:pt-6">
              <button
                onClick={() => setActiveTab('login')}
                className="px-8 py-4 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] font-mono uppercase tracking-widest text-xs font-bold border border-[#141414] shadow-[4px_4px_0px_#888888] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#888888] active:translate-y-[3px] active:shadow-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#D35400] outline-none transition duration-150 cursor-pointer"
                id="hero-workspace-cta-button"
              >
                Enter Workspace &rarr;
              </button>
            </div>
          </div>
        </section>

        {/* CORE CAPABILITIES GRID */}
        <section className="py-12 md:py-16 bg-[#D9D8D5]/30 border-t border-b border-[#141414]/10 px-6" id="capabilities-section">
          <div className="max-w-5xl mx-auto space-y-10">
            <div className="text-center">
              <h2 className="text-[11px] font-serif italic uppercase text-[#141414] tracking-widest opacity-65">Core System Capabilities</h2>
              <p className="text-sm font-mono font-bold uppercase text-[#141414] mt-1">Engineered Features Registry</p>
            </div>

            <motion.div 
              {...containerAnimateProps}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {capabilities.map((cap, i) => (
                <motion.div
                  key={i}
                  variants={reducedMotion ? undefined : cardVariants}
                  tabIndex={0}
                  className="bg-[#F0EFED] border border-[#141414] p-5 shadow-[4px_4px_0px_#141414] space-y-2 focus-visible:ring-2 focus-visible:ring-[#D35400] focus-visible:ring-offset-1 outline-none group hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_#141414] transition-all duration-200 cursor-pointer"
                  onClick={() => setActiveTab('login')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveTab('login');
                    }
                  }}
                  id={`capability-card-${i}`}
                >
                  <div className="font-mono text-xs font-bold text-zinc-400 group-hover:text-[#D35400] transition-colors duration-150">0{i+1}/</div>
                  <h3 className="font-mono text-sm font-bold uppercase text-[#141414]">{cap.title}</h3>
                  <p className="text-xs font-serif italic text-zinc-700 leading-relaxed">{cap.desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* REINFORCED CTA BANNER */}
        <section className="py-16 px-6 text-center max-w-3xl mx-auto space-y-5">
          <h2 className="text-lg sm:text-xl font-mono font-bold uppercase tracking-tight text-[#141414]">Ready to evaluate GitClone?</h2>
          <p className="text-xs font-serif italic text-zinc-600 max-w-lg mx-auto">
            Authenticate using secure credentials to enter your dedicated version control dashboard.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => setActiveTab('login')}
              className="px-8 py-4 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] font-mono uppercase tracking-widest text-xs font-bold border border-[#141414] shadow-[4px_4px_0px_#888888] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#888888] active:translate-y-[3px] active:shadow-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#D35400] outline-none transition duration-150 cursor-pointer w-full sm:w-auto"
              id="bottom-login-cta-button"
            >
              Sign In to Workspace
            </button>
          </div>
        </section>

        {/* DEDICATED DEVELOPER BYPASS PORTAL ENTRY */}
        <section className="border-t border-[#141414]/10 bg-[#DEDCD9]/40 py-12 px-6">
          <div className="max-w-2xl mx-auto text-center space-y-3.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 text-amber-800 text-[10px] font-mono uppercase font-bold border border-amber-500/20 rounded-sm">
              <Award className="w-3.5 h-3.5 text-amber-700 animate-pulse" />
              <span>Developer Evaluation & Sandbox Access</span>
            </div>
            <h3 className="text-base font-mono font-bold uppercase tracking-tight text-[#141414]">Developer Sandbox Bypass</h3>
            <p className="text-xs font-serif italic text-zinc-600 max-w-md mx-auto leading-relaxed">
              Are you evaluating the GitClone environment as an administrator or reviewer? You can use our dedicated, isolated Developer Portal to bypass manual login with one click.
            </p>
            <div className="pt-2">
              <button
                onClick={() => setActiveTab('developer-login')}
                className="px-6 py-2.5 bg-emerald-800 hover:bg-emerald-900 text-[#E4E3E0] text-[10px] font-mono uppercase tracking-wider font-bold border border-emerald-950 shadow-[3px_3px_0px_#064e3b] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_#064e3b] active:translate-y-[3px] active:shadow-none transition duration-150 cursor-pointer"
                id="landing-dev-portal-button"
              >
                Go to Dedicated Developer Portal &rarr;
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderLoginPage = () => {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#E4E3E0]">
        <div className="w-full max-w-md bg-[#F0EFED] border border-[#141414] p-8 shadow-[6px_6px_0px_#141414] space-y-6">
          <div className="text-center space-y-1.5 border-b border-[#141414]/10 pb-4">
            <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Secure Workspace</h2>
            <p className="text-xs font-serif italic text-zinc-600">Authenticate to enter the version control dashboard.</p>
          </div>

          {loginError && (
            <div className="p-4 bg-rose-100 border border-rose-900 text-rose-950 font-mono text-xs flex items-start gap-2 shadow-[2px_2px_0px_#be123c]">
              <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4 font-mono">
            <div className="space-y-1.5">
              <label className="block text-[10px] text-zinc-700 uppercase tracking-widest font-bold">Username</label>
              <div className="relative">
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/20 text-xs text-[#141414] focus:outline-none focus:bg-white focus:ring-1 focus:ring-zinc-900"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] text-zinc-700 uppercase tracking-widest font-bold">Password</label>
              <div className="relative">
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/20 text-xs text-[#141414] focus:outline-none focus:bg-white focus:ring-1 focus:ring-zinc-900"
                  required
                />
              </div>
            </div>

            <div className="pt-3">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-xs font-mono uppercase tracking-widest font-bold border border-[#141414] shadow-[4px_4px_0px_#888888] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#888888] active:translate-y-[3px] active:shadow-none transition duration-150 cursor-pointer flex items-center justify-center gap-2"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span>Authenticate Session</span>
              </button>
            </div>
          </form>

          <div className="pt-4 border-t border-[#141414]/10 text-center">
            <button
              onClick={() => setActiveTab('landing')}
              className="text-[10px] font-mono text-zinc-600 hover:text-black uppercase underline tracking-wider cursor-pointer"
            >
              &larr; Back to Product Details
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDeveloperLoginPage = () => {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0E0F11] relative overflow-hidden">
        {/* Abstract Cyber Grid decoration */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
        
        {/* Warning caution stripes effect */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[repeating-linear-gradient(45deg,#d97706,#d97706_10px,#1e293b_10px,#1e293b_20px)] opacity-60" />

        <div className="w-full max-w-md bg-[#181A1F] border-2 border-[#D97706]/70 p-8 shadow-[8px_8px_0px_#000] relative z-10 space-y-6">
          <div className="text-center space-y-2 border-b border-[#D97706]/20 pb-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/30 mb-2">
              <Award className="w-6 h-6 animate-pulse" />
            </div>
            <h2 className="text-lg font-mono font-bold uppercase tracking-wider text-[#D97706]">Developer Portal</h2>
            <p className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">Isolated Sandbox Evaluation</p>
          </div>

          <div className="p-4 bg-amber-500/5 border border-amber-500/20 text-zinc-300 font-mono text-xs leading-relaxed space-y-2.5">
            <p className="font-bold text-amber-500 text-[10px] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
              Bypass Active
            </p>
            <p className="text-[11px] text-zinc-400 leading-normal">
              This terminal provides rapid, pre-authenticated access specifically for product evaluators. Clicking below bypasses manual credential requirements and provisions a full sandbox session.
            </p>
          </div>

          <div className="space-y-4 pt-2">
            <button
              type="button"
              onClick={handleQuickLogin}
              disabled={isLoading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono uppercase tracking-widest font-bold border border-emerald-700 shadow-[4px_4px_0px_#064e3b] hover:translate-y-[1px] hover:shadow-[3px_3px_0px_#064e3b] active:translate-y-[3px] active:shadow-none transition duration-150 cursor-pointer flex items-center justify-center gap-2"
              id="quick-demo-login-btn-dedicated"
            >
              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
              <span>One-Click Developer Login</span>
            </button>
            <div className="text-center space-y-1">
              <p className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">
                System will authenticate as:
              </p>
              <div className="inline-block px-2.5 py-1 bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-mono">
                username: <span className="text-amber-500 font-bold">developer</span> • pass: <span className="text-amber-500 font-bold">password123</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800 text-center flex flex-col gap-2.5">
            <button
              onClick={() => setActiveTab('login')}
              className="text-[10px] font-mono text-zinc-400 hover:text-white uppercase underline tracking-wider cursor-pointer"
            >
              Return to Secure Manual Login Page
            </button>
            <button
              onClick={() => setActiveTab('landing')}
              className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 uppercase underline tracking-wider cursor-pointer"
            >
              &larr; Back to Product Details
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex flex-col items-center justify-center antialiased">
        <div className="flex flex-col items-center gap-4 font-mono text-xs uppercase">
          <RefreshCw className="w-8 h-8 animate-spin text-[#141414]" />
          <span>Verifying secure workspace session...</span>
        </div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex flex-col antialiased selection:bg-[#141414] selection:text-[#E4E3E0]">
        
        {/* HEADER BAR FOR LOGGED-OUT USERS */}
        <header className="h-16 border-b border-[#141414] bg-[#E4E3E0] flex items-center px-6 justify-between sticky top-0 z-30 select-none">
          <div className="flex items-center gap-2.5">
            <GitPullRequest className="w-5 h-5 text-[#141414]" />
            <h1 className="font-mono font-bold text-xl tracking-tighter uppercase text-[#141414]">GitClone.core</h1>
          </div>
          
          <div className="flex items-center gap-2.5 sm:gap-4">
            {activeTab === 'landing' ? (
              <button
                onClick={() => setActiveTab('login')}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 text-xs font-mono font-bold uppercase border border-[#141414] shadow-[2px_2px_0px_#888888] cursor-pointer"
              >
                Login
              </button>
            ) : (
              <button
                onClick={() => setActiveTab('landing')}
                className="px-4 py-2 border border-[#141414] text-[#141414] hover:bg-[#D9D8D5] text-xs font-mono font-bold uppercase cursor-pointer"
              >
                Back
              </button>
            )}
          </div>
        </header>

        {/* ALERTS */}
        <AnimatePresence>
          {alertMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`mx-6 mt-4 p-4 border border-[#141414] flex items-start gap-3 shadow-[4px_4px_0px_#141414] ${
                alertMessage.type === 'success'
                  ? 'bg-[#E3F2FD] text-emerald-950 border-emerald-900'
                  : alertMessage.type === 'error'
                  ? 'bg-rose-100 text-rose-950 border-rose-900'
                  : 'bg-[#F0EFED] text-[#141414]'
              }`}
            >
              <Info className={`w-5 h-5 shrink-0 ${alertMessage.type === 'success' ? 'text-emerald-700' : alertMessage.type === 'error' ? 'text-rose-700' : 'text-blue-700'}`} />
              <div className="flex-1 text-sm font-mono leading-relaxed">{alertMessage.text}</div>
              <button onClick={() => setAlertMessage(null)} className="text-zinc-600 hover:text-black font-bold px-1 text-xs">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* CONTENT */}
        {activeTab === 'landing' ? (
          renderLandingPage()
        ) : activeTab === 'developer-login' ? (
          renderDeveloperLoginPage()
        ) : (
          renderLoginPage()
        )}

        {/* FOOTER */}
        <footer className="mt-auto border-t border-[#141414] bg-[#D9D8D5] py-6 px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#141414] font-mono">
          <div>
            GitClone Engine v1.0.0 • Pure TypeScript VCS File System Integration.
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setActiveTab('developer-login')} 
              className="text-emerald-800 hover:text-emerald-900 font-bold uppercase underline cursor-pointer"
            >
              Developer Portal
            </button>
            <span>•</span>
            <span>Created on 2026-07-05</span>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex flex-col antialiased selection:bg-[#141414] selection:text-[#E4E3E0]">
      
      {/* HEADER BAR */}
      <header className="h-16 border-b border-[#141414] bg-[#E4E3E0] flex items-center px-6 justify-between sticky top-0 z-30 select-none">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <GitPullRequest className="w-5 h-5 text-[#141414]" />
            <h1 className="font-mono font-bold text-xl tracking-tighter uppercase text-[#141414]">GitClone.core</h1>
          </div>
          {isAuthenticated && status?.isInitialized && (
            <div className="flex items-center gap-2 px-3 py-1 bg-[#141414] text-[#E4E3E0] rounded-sm">
              <span className="text-[10px] font-mono opacity-60 uppercase">HEAD</span>
              <span className="text-xs font-mono font-bold">
                {status.isDetached ? `detached (${status.currentCommitId?.substring(0, 7)})` : `branch:${status.currentBranch}`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <div className="text-[10px] font-mono leading-none opacity-60 uppercase">Workspace</div>
            <div className="text-xs font-mono font-bold">./sandbox</div>
          </div>

          <button
            onClick={refreshAll}
            disabled={isLoading}
            className="p-2 border border-[#141414] rounded-sm text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-50"
            title="Refresh State From Disk"
            id="refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {currentUser && (
            <div className="flex items-center gap-2.5 border-l border-[#141414]/15 pl-4 shrink-0 font-mono">
              <div className="text-right hidden sm:block">
                <div className="text-[9px] leading-none opacity-60 uppercase">Account</div>
                <div className="text-xs font-bold text-[#141414]">{currentUser}</div>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider transition cursor-pointer"
                title="Log out of system session"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ALERT BOX CONTAINER */}
      <AnimatePresence>
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`mx-6 mt-4 p-4 border border-[#141414] flex items-start gap-3 shadow-[4px_4px_0px_#141414] ${
              alertMessage.type === 'success'
                ? 'bg-[#E3F2FD] text-emerald-950 border-emerald-900'
                : alertMessage.type === 'error'
                ? 'bg-rose-100 text-rose-950 border-rose-900'
                : 'bg-[#F0EFED] text-[#141414]'
            }`}
          >
            <Info className={`w-5 h-5 shrink-0 ${alertMessage.type === 'success' ? 'text-emerald-700' : alertMessage.type === 'error' ? 'text-rose-700' : 'text-blue-700'}`} />
            <div className="flex-1 text-sm font-mono leading-relaxed">{alertMessage.text}</div>
            <button onClick={() => setAlertMessage(null)} className="text-zinc-600 hover:text-black font-bold px-1 text-xs">✕</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DETACHED HEAD WARNING BANNER */}
      {status?.isInitialized && status.isDetached && (
        <div className="mx-6 mt-4 p-4 border border-[#141414] bg-amber-100 text-amber-950 flex items-start gap-3 shadow-[4px_4px_0px_#141414]">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-700" />
          <div className="text-sm font-mono">
            <span className="font-bold">Detached HEAD state!</span> You have checked out a specific commit directly (ID: <code className="font-mono bg-amber-200 px-1 py-0.5 border border-[#141414]">{status.currentCommitId?.substring(0, 7)}</code>). Any commits made here will not belong to any branch branch tip. To preserve them, switch to the <span className="font-semibold underline cursor-pointer" onClick={() => setActiveTab('branches')}>Branch Manager</span> and create a new branch from this commit now.
          </div>
        </div>
      )}

      {/* REPOSITORY NOT INITIALIZED SCREEN */}
      {status && !status.isInitialized ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 max-w-4xl mx-auto space-y-8">
          <div className="text-center space-y-2 max-w-xl">
            <div className="p-3 bg-[#D9D8D5] border border-[#141414] mb-3 text-[#141414] shadow-[4px_4px_0px_#141414] w-14 h-14 flex items-center justify-center mx-auto">
              <GitPullRequest className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-mono font-bold uppercase tracking-tight">VCS Dashboard Uninitialized</h2>
            <p className="text-sm font-serif italic text-zinc-700 leading-relaxed">
              Welcome to <span className="font-semibold text-black">GitClone.core</span>. Select an entry path below to unlock either your custom sandbox working directory or the guided visual learning academy.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
            {/* CARD A: SANDBOX */}
            <div className="bg-[#F0EFED] border border-[#141414] p-6 shadow-[6px_6px_0px_#141414] flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#141414]/10">
                  <Plus className="w-5 h-5 text-zinc-700" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-[#141414]">Sandbox Explorer Mode</h3>
                </div>
                <p className="text-xs font-serif italic text-zinc-600 leading-relaxed">
                  Start with a clean slate to manually create mockup files, stage modifications, commit revision snapshots, and analyze low-level VCS internals inside your local sandbox.
                </p>
              </div>
              <button
                onClick={handleInitRepo}
                disabled={isLoading}
                className="w-full py-3 bg-[#141414] hover:opacity-90 text-[#E4E3E0] font-mono uppercase tracking-wider text-xs font-bold border border-[#141414] shadow-[3px_3px_0px_#888888] active:translate-y-[1.5px] active:shadow-[1.5px_1.5px_0px_#888888] transition cursor-pointer flex items-center justify-center gap-2"
                id="init-repo-btn"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span>Initialize Clean Sandbox</span>
              </button>
            </div>

            {/* CARD B: ACADEMY */}
            <div className="bg-[#EAFAF1] border border-emerald-900 p-6 shadow-[6px_6px_0px_#049669] flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-emerald-900/10">
                  <Award className="w-5 h-5 text-emerald-700" />
                  <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-950">VCS Learning Academy</h3>
                </div>
                <p className="text-xs font-serif italic text-emerald-900 leading-relaxed">
                  Jump directly into our interactive, step-by-step challenges! Practice branches, cherry-picking, resolving merge conflicts, and restoring historical commit snapshots.
                </p>
              </div>
              <button
                onClick={handleInitRepoAndGoToLearn}
                disabled={isLoading}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-mono uppercase tracking-wider text-xs font-bold border border-emerald-900 shadow-[3px_3px_0px_#047857] active:translate-y-[1.5px] active:shadow-[1.5px_1.5px_0px_#047857] transition cursor-pointer flex items-center justify-center gap-2"
                id="init-repo-learn-btn"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span>Start VCS Academy</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* CORE REPOSITORY INTERFACE */
        <div className="flex-1 flex flex-col md:flex-row border-t border-[#141414]">
          
          {/* SIDEBAR NAVIGATION & TELEMETRY */}
          <aside className="w-full md:w-64 border-r border-[#141414] flex flex-col bg-[#D9D8D5]/30">
            {/* System Navigation Tabs */}
            <div className="p-6 border-b border-[#141414] space-y-2">
              <h2 className="text-[11px] font-serif italic mb-4 opacity-60 uppercase tracking-widest">Navigator</h2>
              <nav className="flex flex-col gap-1.5 font-mono text-xs">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'dashboard' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-dashboard"
                >
                  <span className="font-bold">01/</span> Playground
                </button>
                <button
                  onClick={() => setActiveTab('status')}
                  className={`px-3 py-2 text-left transition-all border flex items-center justify-between ${activeTab === 'status' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-status"
                >
                  <span><span className="font-bold">02/</span> Repo Status</span>
                  {status && status.files.filter(f => f.status !== 'up_to_date').length > 0 && (
                    <span className="px-1.5 py-0.2 bg-amber-500 text-[#141414] text-[9px] font-mono font-bold">
                      {status.files.filter(f => f.status !== 'up_to_date').length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'history' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-history"
                >
                  <span className="font-bold">03/</span> Lineage Logs
                </button>
                <button
                  onClick={() => setActiveTab('branches')}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'branches' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-branches"
                >
                  <span className="font-bold">04/</span> Branches
                </button>
                <button
                  onClick={() => setActiveTab('tags')}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'tags' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-tags"
                >
                  <span className="font-bold">05/</span> Tags
                </button>
                <button
                  onClick={() => {
                    setActiveTab('diff');
                    if (status && status.files.length > 0 && !diffFile) {
                      setDiffFile(status.files[0].path);
                    }
                  }}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'diff' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-diff"
                >
                  <span className="font-bold">06/</span> Line Diff
                </button>
                <button
                  onClick={() => setActiveTab('internals')}
                  className={`px-3 py-2 text-left transition-all border ${activeTab === 'internals' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-internals"
                >
                  <span className="font-bold">07/</span> .gitclone Core
                </button>
                <button
                  onClick={() => setActiveTab('conflicts')}
                  className={`px-3 py-2 text-left transition-all border flex items-center justify-between cursor-pointer ${activeTab === 'conflicts' ? 'bg-rose-950 text-[#E4E3E0] border-rose-900 font-bold' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'} ${activeConflicts.length > 0 ? 'border-rose-800 bg-rose-100' : ''}`}
                  id="nav-conflicts"
                >
                  <span className="flex items-center gap-1">
                    <span className="font-bold">08/</span> Conflicts
                  </span>
                  {activeConflicts.length > 0 && (
                    <span className="px-1.5 py-0.2 bg-rose-600 text-[#E4E3E0] text-[9px] font-mono font-bold">
                      {activeConflicts.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setIsPlaygroundActive(true);
                    setActiveTab('playground');
                    refreshAll();
                  }}
                  className={`px-3 py-2 text-left transition-all border flex items-center justify-between cursor-pointer ${activeTab === 'playground' ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] font-bold' : 'text-[#141414] hover:bg-[#D9D8D5] border-transparent'}`}
                  id="nav-playground"
                >
                  <span className="flex items-center gap-1">
                    <span className="font-bold">09/</span> Learn VCS
                  </span>
                  <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[9px] font-mono font-bold animate-pulse">
                    LIVE
                  </span>
                </button>
              </nav>
            </div>

            {/* Persistence Layer & Metrics */}
            <div className="p-6 border-b border-[#141414] space-y-4">
              <h2 className="text-[11px] font-serif italic mb-3 opacity-60 uppercase tracking-widest">Persistence</h2>
              <div className="space-y-3.5">
                <div>
                  <div className="text-[20px] font-mono leading-none font-bold text-[#141414]">
                    {internals?.objectCount || 0}
                  </div>
                  <div className="text-[9px] font-mono uppercase opacity-60">Objects Stored (SHA-1)</div>
                </div>
                <div>
                  <div className="text-[20px] font-mono leading-none font-bold text-[#141414]">
                    {history.length}
                  </div>
                  <div className="text-[9px] font-mono uppercase opacity-60">Snapshot Commits</div>
                </div>
                <div>
                  <div className="text-[20px] font-mono leading-none font-bold text-[#141414]">
                    {branches.length}
                  </div>
                  <div className="text-[9px] font-mono uppercase opacity-60">Branch Pointers</div>
                </div>
              </div>
            </div>

            {/* Sandbox Operations */}
            <div className="p-6 mt-auto border-t border-[#141414] bg-[#D9D8D5] space-y-3">
              <h2 className="text-[11px] font-serif italic opacity-60 uppercase tracking-widest">Operations</h2>
              <button
                onClick={() => setShowNewFileModal(true)}
                className="w-full py-2.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-mono uppercase tracking-wider hover:opacity-95 transition-opacity cursor-pointer"
                id="create-file-trigger"
              >
                + New Sandbox File
              </button>
              {status?.isInitialized && (
                <button
                  onClick={handleExportPDF}
                  disabled={isLoading}
                  className="w-full py-2.5 bg-[#E4E3E0] text-[#141414] hover:bg-zinc-200 text-[10px] font-mono font-bold uppercase border border-[#141414] shadow-[3px_3px_0px_#141414] flex items-center justify-center gap-1.5 transition cursor-pointer"
                  id="sidebar-export-pdf-btn"
                  title="Generate a beautiful PDF Report containing working status, logs, database snapshot meta"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Export PDF Report</span>
                </button>
              )}
              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="force-checkout-chk"
                  checked={isForceCheckout}
                  onChange={(e) => setIsForceCheckout(e.target.checked)}
                  className="rounded-none border-[#141414] text-[#141414] focus:ring-[#141414] w-3.5 h-3.5 mt-0.5 accent-[#141414]"
                />
                <label htmlFor="force-checkout-chk" className="text-[10px] font-mono text-zinc-700 select-none cursor-pointer leading-tight uppercase">
                  Force checkout / overwrite
                </label>
              </div>
            </div>
          </aside>

          {/* MAIN CONTENT WORKSPACE */}
          <main className="flex-1 min-w-0 p-8 bg-[#E4E3E0] overflow-y-auto">
            <div className="min-h-[500px]">
              
              {/* --- GOD-TIER INTERACTIVE CONTROL PANEL BAR --- */}
              <div className="mb-6 bg-[#F0EFED] border border-[#141414] p-4 shadow-[4px_4px_0px_#141414] flex flex-wrap items-center justify-between gap-4 font-mono">
                {/* Left Segment: Mode Toggle & Info */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      const newMode = !isPlaygroundActive;
                      setIsPlaygroundActive(newMode);
                      if (newMode) {
                        setActiveTab('playground');
                      } else {
                        setActiveTab('dashboard');
                      }
                      refreshAll();
                    }}
                    className={`px-3 py-1.5 text-xs font-bold uppercase border border-[#141414] shadow-[2px_2px_0px_#141414] active:translate-y-[1.5px] active:shadow-[0.5px_0.5px_0px_#141414] transition-all flex items-center gap-1.5 cursor-pointer ${
                      isPlaygroundActive
                        ? 'bg-emerald-600 text-[#E4E3E0]'
                        : 'bg-[#D9D8D5] text-[#141414] hover:bg-[#c9c8c5]'
                    }`}
                    id="workspace-mode-toggle"
                  >
                    <span className={`w-2 h-2 rounded-full ${isPlaygroundActive ? 'bg-green-300 animate-pulse' : 'bg-zinc-400'}`}></span>
                    <span>{isPlaygroundActive ? 'Challenge Sandbox Active' : 'Switch to Challenge Mode'}</span>
                  </button>

                  {isPlaygroundActive && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-l border-zinc-400 pl-3">
                      <span className="text-zinc-600 font-bold">Challenge:</span>
                      <span className="text-emerald-700 font-bold">{PLAYGROUND_CHALLENGES[currentChallengeIndex].title}</span>
                      <span className="text-zinc-600 font-bold">| Steps:</span>
                      <span className="text-[#141414] font-bold">{playgroundStepCount}</span>
                      <button
                        onClick={handleResetPlayground}
                        className="px-2 py-0.5 bg-rose-700 hover:bg-rose-800 text-white text-[10px] uppercase font-bold border border-rose-900 shadow-[1px_1px_0px_#141414] active:translate-y-px transition-transform cursor-pointer"
                        title="Reset all playground repository directories and history files"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>

                {/* Right Segment: One-Click Undo / Redo */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    className="px-3 py-1.5 text-xs font-bold uppercase border border-[#141414] bg-[#F0EFED] text-[#141414] hover:bg-[#D9D8D5] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#F0EFED] shadow-[2px_2px_0px_#141414] active:translate-y-[1.5px] active:shadow-[0.5px_0.5px_0px_#141414] transition-all flex items-center gap-1.5 cursor-pointer"
                    title="One-click Undo: Restores previous repository snapshot state"
                    id="vcs-undo-btn"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Undo</span>
                    {undoStack.length > 0 && (
                      <span className="bg-[#141414] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-sm shrink-0">
                        {undoStack.length}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="px-3 py-1.5 text-xs font-bold uppercase border border-[#141414] bg-[#F0EFED] text-[#141414] hover:bg-[#D9D8D5] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#F0EFED] shadow-[2px_2px_0px_#141414] active:translate-y-[1.5px] active:shadow-[0.5px_0.5px_0px_#141414] transition-all flex items-center gap-1.5 cursor-pointer"
                    title="One-click Redo: Replays next repository snapshot state"
                    id="vcs-redo-btn"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Redo</span>
                    {redoStack.length > 0 && (
                      <span className="bg-[#141414] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-sm shrink-0">
                        {redoStack.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              
              {/* TAB 1: SANDBOX PLAYGROUND */}
              {activeTab === 'dashboard' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Sandbox Working Directory</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Add, edit, or delete mock files directly inside your working directory sandbox.</p>
                    </div>
                    <div className="text-xs font-mono bg-[#141414] text-[#E4E3E0] px-3.5 py-2 border border-[#141414] shadow-[2px_2px_0px_#888888]">
                      Path: <span className="font-bold">./sandbox/</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    
                    {/* File List Pane - Replaced with Folder-Aware Hierarchical File Tree */}
                    <div className="lg:col-span-4">
                      <FileTree
                        files={files}
                        selectedFile={selectedFile}
                        onSelectFile={handleSelectFile}
                        onDeleteFile={handleDeleteFile}
                        onCreateFile={handleTreeCreateFile}
                        fileStatuses={status?.files || []}
                        onRefresh={refreshAll}
                        isLoading={isLoading}
                      />
                    </div>

                    {/* File Editor Pane */}
                    <div className="lg:col-span-8 flex flex-col gap-4">
                      {selectedFile ? (
                        <div className="flex-1 flex flex-col border border-[#141414] bg-[#F0EFED] overflow-hidden shadow-[4px_4px_0px_#141414]">
                          <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                              <span className="text-xs font-mono font-bold text-[#E4E3E0]">{selectedFile}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleTrackFile(selectedFile)}
                                className="px-2.5 py-1.5 border border-[#E4E3E0] text-[#E4E3E0] hover:bg-[#E4E3E0] hover:text-[#141414] text-[10px] font-mono font-bold uppercase transition"
                                title="Add file to staging index"
                              >
                                Stage Changes
                              </button>
                              <button
                                onClick={handleSaveFile}
                                className="px-2.5 py-1.5 bg-[#E4E3E0] text-[#141414] hover:opacity-90 text-[10px] font-mono font-bold uppercase transition flex items-center gap-1"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Save File
                              </button>
                            </div>
                          </div>
                          
                          <div className="relative flex-1">
                            <textarea
                              value={editorContent}
                              onChange={(e) => setEditorContent(e.target.value)}
                              className="w-full h-[320px] p-4 bg-[#F0EFED] text-[#141414] font-mono text-xs focus:outline-none focus:ring-0 leading-relaxed resize-none border-t border-[#141414]"
                              placeholder="// Write file contents here..."
                              spellCheck={false}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="border border-[#141414] border-dashed p-8 flex flex-col items-center justify-center text-center text-zinc-500 h-[380px] bg-[#D9D8D5]/20">
                          <FileCode className="w-10 h-10 mb-2 stroke-[1.5]" />
                          <p className="text-xs font-serif italic">
                            {files.length === 0
                              ? 'Your sandbox is empty. Use the Workspace Files tree on the left to create your first file or directory!'
                              : 'Select a file from the sidebar list to view, edit, or track its content.'}
                          </p>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 2: REPOSITORY STATUS & STAGE */}
              {activeTab === 'status' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Repository Status</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Compare your active disk directory against the staging index and latest commits.</p>
                    </div>
                    {status && status.files.length > 0 && (
                      <button
                        onClick={() => handleTrackFile()}
                        className="px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:opacity-95 text-xs font-mono uppercase font-bold border border-[#141414] shadow-[2px_2px_0px_#888888] transition flex items-center gap-1.5 self-start sm:self-auto"
                        id="stage-all-btn"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Stage All Changes (git add .)
                      </button>
                    )}
                  </div>

                  {!status || status.files.length === 0 ? (
                    <div className="text-center py-12 text-zinc-600 border border-[#141414] border-dashed bg-[#D9D8D5]/20">
                      <Sliders className="w-10 h-10 mx-auto mb-2 text-zinc-400" />
                      <p className="text-sm font-serif italic">No files tracked yet. Populate your sandbox playground first.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      
                      {/* Active File List */}
                      <div className="lg:col-span-7 space-y-4">
                        <div className="bg-[#D9D8D5]/30 border border-[#141414] p-4 shadow-[4px_4px_0px_#141414]">
                          <h3 className="text-[11px] font-serif italic uppercase text-[#141414] tracking-widest opacity-80 mb-3">File Status Matrix</h3>
                          <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                            {status.files.map(f => (
                              <div
                                key={f.path}
                                className="flex items-center justify-between px-3 py-3 border border-[#141414] bg-[#F0EFED] hover:bg-[#D9D8D5]/50 transition text-xs font-mono"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <FileCode className="w-4 h-4 shrink-0 text-zinc-600" />
                                  <div className="min-w-0">
                                    <p className="text-[#141414] font-bold truncate">{f.path}</p>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-zinc-600">
                                      <span>Idx: {f.stagedHash ? f.stagedHash.substring(0, 7) : 'none'}</span>
                                      <span>•</span>
                                      <span>Cmt: {f.committedHash ? f.committedHash.substring(0, 7) : 'none'}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  {getStatusBadge(f.status)}
                                  {f.status !== 'up_to_date' && (
                                    <button
                                      onClick={() => handleTrackFile(f.path)}
                                      className="px-2.5 py-1 bg-[#141414] text-[#E4E3E0] hover:opacity-90 font-mono text-[9px] uppercase font-bold"
                                    >
                                      Stage
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Commit Form Panel */}
                      <div className="lg:col-span-5 space-y-4">
                        <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-4 shadow-[4px_4px_0px_#141414]">
                          <div className="flex items-center gap-2 text-[#141414]">
                            <GitCommit className="w-4.5 h-4.5" />
                            <h3 className="text-xs font-mono font-bold uppercase tracking-wider">Create Snapshot Commit</h3>
                          </div>
                          
                          <form onSubmit={handleCommit} className="space-y-4">
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <label className="block text-[10px] font-mono text-zinc-700 uppercase tracking-wider font-bold">Commit Message</label>
                                  <button
                                    type="button"
                                    onClick={handleSuggestCommitMessage}
                                    className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-[#E4E3E0] text-[9px] font-mono font-bold uppercase rounded-sm border border-[#141414] shadow-[1px_1px_0px_#888888] hover:translate-y-[-0.5px] active:translate-y-[0.5px] transition-all flex items-center gap-1 cursor-pointer"
                                    title="Generate lightweight AI-assisted commit message based on diff"
                                  >
                                    <Sparkles className="w-3 h-3 text-amber-400" />
                                    <span>AI Suggest</span>
                                  </button>
                                </div>
                                <select
                                  onChange={(e) => {
                                    const prefix = e.target.value;
                                    if (prefix) {
                                      setCommitMessage(prev => {
                                        const clean = prev.replace(/^(feat|fix|chore|docs|refactor|style|test):\s*/i, '');
                                        return `${prefix}: ${clean}`;
                                      });
                                    }
                                    e.target.value = '';
                                  }}
                                  className="text-[10px] font-mono uppercase bg-[#E4E3E0] text-[#141414] border border-[#141414] px-2 py-1 focus:outline-none cursor-pointer hover:bg-zinc-200 transition-colors"
                                  id="commit-template-select"
                                >
                                  <option value="">-- Apply Template --</option>
                                  <option value="feat">feat: New Feature</option>
                                  <option value="fix">fix: Bug Fix</option>
                                  <option value="chore">chore: Maintenance</option>
                                  <option value="docs">docs: Documentation</option>
                                  <option value="refactor">refactor: Refactor</option>
                                  <option value="style">style: Code Style</option>
                                  <option value="test">test: Testing</option>
                                </select>
                              </div>
                              <textarea
                                value={commitMessage}
                                onChange={(e) => setCommitMessage(e.target.value)}
                                placeholder="e.g. Add validation logic for login endpoint"
                                className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] font-mono focus:outline-none focus:bg-white leading-relaxed resize-none h-24"
                                required
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-mono text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Author Info</label>
                              <input
                                type="text"
                                value={authorName}
                                onChange={(e) => setAuthorName(e.target.value)}
                                className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] font-mono focus:outline-none focus:bg-white"
                                required
                              />
                            </div>

                            <div className="flex items-start gap-2.5 pt-1">
                              <input
                                type="checkbox"
                                id="auto-create-tag-chk"
                                checked={autoCreateTag}
                                onChange={(e) => setAutoCreateTag(e.target.checked)}
                                className="rounded-none border-[#141414] text-[#141414] focus:ring-[#141414] w-3.5 h-3.5 mt-0.5 accent-[#141414]"
                              />
                              <label htmlFor="auto-create-tag-chk" className="text-[10px] font-mono text-zinc-700 select-none cursor-pointer leading-tight uppercase font-bold">
                                Auto-create lightweight tag with commit message
                              </label>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3">
                              <button
                                type="submit"
                                disabled={isLoading || status.files.filter(f => f.status.startsWith('staged_')).length === 0}
                                className="flex-1 py-2.5 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-xs font-mono uppercase tracking-wider font-bold border border-[#141414] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                id="commit-btn"
                              >
                                <GitCommit className="w-4 h-4" />
                                Commit Staged ({status.files.filter(f => f.status.startsWith('staged_')).length})
                              </button>

                              {remoteEnabled && (
                                <button
                                  type="button"
                                  onClick={handleCommitAndPush}
                                  disabled={isLoading || status.files.filter(f => f.status.startsWith('staged_')).length === 0}
                                  className="flex-1 py-2.5 bg-[#E4E3E0] hover:bg-zinc-200 text-[#141414] text-xs font-mono uppercase tracking-wider font-bold border border-[#141414] shadow-[3px_3px_0px_#141414] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                  id="commit-push-btn"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                  Commit & Push
                                </button>
                              )}
                            </div>
                          </form>

                          {status.files.filter(f => f.status.startsWith('staged_')).length === 0 && (
                            <div className="p-3 bg-amber-50 border border-[#141414] text-[11px] text-[#141414] leading-relaxed font-mono">
                              💡 Staging index is empty. Click <span className="underline font-semibold cursor-pointer" onClick={() => handleTrackFile()}>Stage All</span> above to stage changed on-disk files before committing.
                            </div>
                          )}
                        </div>

                        {/* Remote Repository Synchronization Panel */}
                        <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-4 shadow-[4px_4px_0px_#141414] font-mono">
                          <div className="flex items-center justify-between border-b border-[#141414] pb-2 text-[#141414]">
                            <div className="flex items-center gap-2">
                              <RefreshCw className={`w-4 h-4 ${isPushing ? 'animate-spin' : ''}`} />
                              <h3 className="text-xs font-bold uppercase tracking-wider">Remote Synchronization</h3>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase font-bold text-zinc-500">Status:</span>
                              {!remoteEnabled ? (
                                <span className="text-[9px] px-1.5 py-0.5 bg-zinc-200 text-zinc-700 border border-zinc-400 font-bold uppercase">Local Only</span>
                              ) : remoteStatus === 'pushing' ? (
                                <span className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-black border border-amber-800 font-bold uppercase animate-pulse">Syncing</span>
                              ) : remoteStatus === 'ahead' ? (
                                <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-900 border border-blue-800 font-bold uppercase">Ahead ({aheadCount})</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-950 border border-emerald-800 font-bold uppercase">Synced</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              id="remote-toggle-chk"
                              checked={remoteEnabled}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                setRemoteEnabled(enabled);
                                if (enabled) {
                                  setRemoteStatus('synced');
                                  setAheadCount(0);
                                } else {
                                  setRemoteStatus('not_configured');
                                }
                              }}
                              className="rounded-none border-[#141414] text-[#141414] focus:ring-[#141414] w-3.5 h-3.5 accent-[#141414] cursor-pointer"
                            />
                            <label htmlFor="remote-toggle-chk" className="text-[10px] text-zinc-700 select-none cursor-pointer leading-tight uppercase font-bold">
                              Configure Remote Repository Tracking
                            </label>
                          </div>

                          {remoteEnabled && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="space-y-4 pt-1"
                            >
                              <div>
                                <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Remote Repository URL</label>
                                <input
                                  type="text"
                                  value={remoteUrl}
                                  onChange={(e) => setRemoteUrl(e.target.value)}
                                  disabled={isPushing}
                                  placeholder="e.g. https://github.com/username/repo.git"
                                  className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] font-mono focus:outline-none focus:bg-white disabled:opacity-50"
                                />
                              </div>

                              {remoteStatus === 'ahead' && (
                                <div className="p-3 bg-blue-50 border border-blue-900 text-[11px] text-blue-950 leading-relaxed space-y-2">
                                  <p>💡 Local repository has <strong>{aheadCount}</strong> commit(s) ahead of remote server. Push changes to synchronize lineage history.</p>
                                  <button
                                    type="button"
                                    onClick={() => triggerRemotePush()}
                                    disabled={isPushing}
                                    className="px-3.5 py-1.5 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] text-[10px] font-bold uppercase tracking-wider border border-[#141414]"
                                  >
                                    Push Commits ({aheadCount})
                                  </button>
                                </div>
                              )}

                              {remoteStatus === 'synced' && (
                                <div className="p-3 bg-emerald-50 border border-emerald-900 text-[11px] text-emerald-950 leading-relaxed">
                                  ✓ Local repository is fully synchronized with remote head branch. No outgoing commits pending.
                                </div>
                              )}

                              {isPushing && (
                                <div className="space-y-2 pt-1">
                                  <div className="flex items-center justify-between text-[10px] font-bold text-zinc-600">
                                    <span>Simulating Git Push...</span>
                                    <span>{pushProgress}%</span>
                                  </div>
                                  <div className="w-full bg-[#D9D8D5] h-1.5 border border-[#141414] overflow-hidden">
                                    <motion.div
                                      className="bg-[#141414] h-full"
                                      animate={{ width: `${pushProgress}%` }}
                                      transition={{ duration: 0.1 }}
                                    />
                                  </div>
                                </div>
                              )}

                              {pushLogs.length > 0 && (
                                <div className="space-y-1">
                                  <div className="text-[10px] font-bold text-zinc-600 uppercase">Git Terminal Output</div>
                                  <div className="bg-[#141414] text-[#E4E3E0] p-3 rounded-none font-mono text-[9px] leading-normal space-y-1 overflow-x-auto whitespace-pre-wrap select-all max-h-[140px]">
                                    {pushLogs.map((log, lIdx) => (
                                      <div key={lIdx} className={log.startsWith('To ') || log.startsWith('   ') ? 'text-emerald-400 font-bold' : ''}>
                                        {log}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: COMMIT HISTORY */}
              {activeTab === 'history' && (
                <div className="space-y-6">
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-4">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Lineage Commit Logs</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Explore chronological logs, filter DAG graph topology, time travel, and export PDF audit records.</p>
                    </div>
                    <div>
                      <button
                        onClick={handleExportPDF}
                        disabled={isLoading}
                        className="px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 disabled:opacity-50 text-xs font-mono font-bold uppercase border border-[#141414] shadow-[4px_4px_0px_#888888] flex items-center gap-2 transition cursor-pointer"
                        title="Download a complete visual PDF Audit Report of files, branches, and commits"
                      >
                        <FileText className="w-4 h-4" />
                        Export PDF Report
                      </button>
                    </div>
                  </div>

                  {/* Search and Filter Panel (Phase 10) */}
                  <div className="bg-[#D9D8D5]/30 border border-[#141414] p-4 space-y-4 shadow-[4px_4px_0px_#141414]">
                    <div className="flex items-center gap-2 border-b border-[#141414] pb-2 mb-2">
                      <Search className="w-4 h-4 text-[#141414]" />
                      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414]">Filter & Query History</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Search Keywords</label>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Message, ID, author..."
                          className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Branch Context</label>
                        <select
                          value={searchBranch}
                          onChange={(e) => setSearchBranch(e.target.value)}
                          className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                        >
                          <option value="">-- All Branches --</option>
                          {branches.map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">From Date</label>
                        <input
                          type="date"
                          value={searchDateStart}
                          onChange={(e) => setSearchDateStart(e.target.value)}
                          className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">To Date</label>
                        <input
                          type="date"
                          value={searchDateEnd}
                          onChange={(e) => setSearchDateEnd(e.target.value)}
                          className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Visual Commit Branch Graph */}
                  <div className="space-y-4">
                    <div className="border-b border-[#141414] pb-3">
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Visual Lineage Map</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Interactive DAG showing commit history, branches, merges and checked-out pointers.</p>
                    </div>
                    <CommitGraph
                      commits={searchResults}
                      branches={branches}
                      tags={tags}
                      currentCommitId={status?.currentCommitId || null}
                      onCheckout={handleCheckout}
                      isLoading={isLoading}
                    />
                  </div>

                  {/* Commit Timeline Rendering */}
                  <div className="space-y-6">
                    <h2 className="text-xl font-mono font-bold uppercase border-b border-[#141414] pb-3 text-[#141414]">Commit Logs Chain</h2>
                    
                    {searchResults.length === 0 ? (
                      <div className="text-center py-12 text-zinc-600 border border-[#141414] border-dashed bg-[#D9D8D5]/20">
                        <Clock className="w-10 h-10 mx-auto mb-2 text-zinc-400" />
                        <p className="text-sm font-serif italic">No commits match your filters or query parameters.</p>
                      </div>
                    ) : (
                      <div className="relative border-l-2 border-[#141414] ml-4 pl-8 space-y-8 py-2">
                        {searchResults.map((commit, idx) => {
                          const isCurrentTip = status?.currentCommitId === commit.id;
                          return (
                            <div key={commit.id} className="relative group">
                              {/* Circle point on timeline */}
                              <div className={`absolute -left-[41px] top-1 w-6 h-6 rounded-none border border-[#141414] flex items-center justify-center transition ${
                                isCurrentTip
                                  ? 'bg-[#141414] text-[#E4E3E0] shadow-lg'
                                  : 'bg-[#E4E3E0] text-zinc-700 hover:bg-[#D9D8D5]'
                              }`}>
                                <GitCommit className="w-3.5 h-3.5" />
                              </div>

                              <div className={`p-5 border transition ${
                                isCurrentTip
                                  ? 'bg-[#F0EFED] border-[#141414] shadow-[4px_4px_0px_#141414]'
                                  : 'bg-[#D9D8D5]/10 border-zinc-400 hover:border-[#141414] hover:bg-[#D9D8D5]/30'
                              }`}>
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3 font-mono">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                      <h3 className="text-sm font-bold text-[#141414]">{commit.message}</h3>
                                      {commit.branch && (
                                        <span className="px-2 py-0.5 text-[9px] font-bold bg-[#E3F2FD] text-blue-950 border border-blue-900 uppercase">
                                          branch: {commit.branch}
                                        </span>
                                      )}
                                      {tags.filter(t => t.commitId === commit.id).map(t => (
                                        <span key={t.name} className="px-2 py-0.5 text-[9px] font-bold bg-[#D35400] text-[#E4E3E0] border border-[#141414] uppercase">
                                          🏷️ tag: {t.name}
                                        </span>
                                      ))}
                                      {isCurrentTip && (
                                        <span className="px-2 py-0.5 text-[9px] font-bold bg-[#E8F5E9] text-emerald-950 border border-emerald-900 uppercase">
                                          HEAD tip
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs font-serif italic text-zinc-700">
                                      Authored by <span className="font-mono text-[#141414] font-bold">{commit.author}</span>
                                    </p>
                                  </div>

                                  <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0 text-right">
                                    <span className="text-xs font-mono font-bold text-[#E4E3E0] bg-[#141414] px-2 py-1 border border-[#141414]">
                                      {commit.id.substring(0, 7)}
                                    </span>
                                    <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono">
                                      <Calendar className="w-3 h-3" />
                                      <span>{new Date(commit.timestamp).toLocaleString()}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Expandable Snapshots details */}
                                <div className="mt-4 pt-3 border-t border-dashed border-zinc-400">
                                  <details className="group/snapshot text-xs font-mono">
                                    <summary className="text-zinc-600 hover:text-black cursor-pointer list-none flex items-center gap-1.5 select-none">
                                      <span className="transition duration-150 group-open/snapshot:rotate-90">▶</span>
                                      <span className="font-bold">View File Snapshot ({Object.keys(commit.snapshot).length} tracked file(s))</span>
                                    </summary>
                                    <div className="mt-2 ml-4 pl-3 border-l border-[#141414] space-y-1 py-1 max-h-48 overflow-y-auto">
                                      {Object.entries(commit.snapshot).map(([file, hash]) => (
                                        <div key={file} className="flex items-center justify-between py-0.5 text-[11px]">
                                          <span className="text-zinc-700 font-bold">{file}</span>
                                          <span className="text-zinc-500">SHA-1: {(hash as string).substring(0, 10)}...</span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                </div>

                                {/* Checkout Restore Button */}
                                {!isCurrentTip && (
                                  <div className="mt-4 flex justify-end">
                                    <button
                                      onClick={() => handleCheckout(commit.id)}
                                      className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-mono font-bold uppercase border border-[#141414] shadow-[2px_2px_0px_#888888] flex items-center gap-1.5 transition"
                                    >
                                      <Undo className="w-3.5 h-3.5" />
                                      Time Travel: Checkout Commit
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB 4: BRANCH MANAGER */}
              {activeTab === 'branches' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Branch Manager</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Spawn independent development tracks, delete stale heads, and switch context seamlessly.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    
                    {/* Branch Pointer Table */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="bg-[#D9D8D5]/30 border border-[#141414] p-4 shadow-[4px_4px_0px_#141414]">
                        <h3 className="text-[11px] font-serif italic uppercase text-[#141414] tracking-widest opacity-80 mb-3">Branch Reference Registry</h3>
                        <div className="space-y-2">
                          {branches.map(b => {
                            const isCurrent = status?.currentBranch === b.name && !status.isDetached;
                            return (
                              <div
                                key={b.name}
                                className={`flex items-center justify-between px-4 py-3.5 border transition ${
                                  isCurrent
                                    ? 'border-[#141414] bg-[#F0EFED] shadow-[2px_2px_0px_#141414]'
                                    : 'border-zinc-400 bg-[#F0EFED]/40 hover:bg-[#D9D8D5]/30'
                                }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <GitBranch className={`w-5 h-5 shrink-0 ${isCurrent ? 'text-[#141414]' : 'text-zinc-500'}`} />
                                  <div className="min-w-0 font-mono">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-bold truncate ${isCurrent ? 'text-[#141414]' : 'text-zinc-700'}`}>
                                        {b.name}
                                      </span>
                                      {isCurrent && (
                                        <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-[#E8F5E9] text-emerald-950 border border-emerald-900 font-mono">
                                          Active
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-zinc-600 mt-0.5 truncate">
                                      Tip: {b.latestCommitId ? b.latestCommitId : 'empty branch (no commits)'}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {!isCurrent && (
                                    <>
                                      <button
                                        onClick={() => handleMerge(b.name)}
                                        className="px-2.5 py-1.5 bg-[#E4E3E0] text-[#141414] hover:bg-zinc-200 font-mono text-[10px] uppercase font-bold border border-[#141414] shadow-[2px_2px_0px_#141414] flex items-center gap-1 cursor-pointer"
                                        title={`Merge branch '${b.name}' into '${status?.currentBranch || 'HEAD'}'`}
                                      >
                                        <GitPullRequest className="w-3 h-3 text-[#141414]" />
                                        <span>Merge</span>
                                      </button>
                                      <button
                                        onClick={() => handleCheckout(b.name)}
                                        className="px-2.5 py-1.5 bg-[#141414] text-[#E4E3E0] hover:opacity-90 font-mono text-[10px] uppercase font-bold border border-[#141414] shadow-[2px_2px_0px_#888888] cursor-pointer"
                                      >
                                        Switch to
                                      </button>
                                      {b.name !== 'main' && (
                                        <button
                                          onClick={() => handleDeleteBranch(b.name)}
                                          className="p-2 border border-[#141414] text-[#141414] hover:bg-rose-100 hover:text-rose-700 hover:border-rose-900 transition cursor-pointer"
                                          title="Delete Branch"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* New Branch Form */}
                    <div className="lg:col-span-5 space-y-4">
                      <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-4 shadow-[4px_4px_0px_#141414]">
                        <div className="flex items-center gap-2 text-[#141414]">
                          <Plus className="w-4.5 h-4.5" />
                          <h3 className="text-xs font-mono font-bold uppercase tracking-wider">Create New Branch</h3>
                        </div>

                        <form onSubmit={handleCreateBranch} className="space-y-4 font-mono">
                          <div>
                            <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Branch Name</label>
                            <input
                              type="text"
                              value={newBranchName}
                              onChange={(e) => setNewBranchName(e.target.value)}
                              placeholder="e.g. feature-user-login"
                              className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] focus:outline-none focus:bg-white"
                              required
                            />
                            <p className="text-[10px] font-serif italic text-zinc-600 mt-1 leading-relaxed">
                              * Branches point initially to whatever commit you currently have checked out (HEAD).
                            </p>
                          </div>

                          <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-2.5 bg-[#141414] text-[#E4E3E0] text-xs uppercase tracking-widest font-bold border border-[#141414]"
                            id="create-branch-btn"
                          >
                            Spawn New Branch
                          </button>
                        </form>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 5: TAGS MANAGER */}
              {activeTab === 'tags' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Tag Manager</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Attach immutable lightweight tags to specific commits for easy version referencing.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    
                    {/* Tags List Table */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="bg-[#D9D8D5]/30 border border-[#141414] p-4 shadow-[4px_4px_0px_#141414]">
                        <h3 className="text-[11px] font-serif italic uppercase text-[#141414] tracking-widest opacity-80 mb-3">Tag Reference Registry</h3>
                        
                        {tags.length === 0 ? (
                          <div className="text-center py-12 text-zinc-600 border border-dashed border-zinc-400 bg-[#F0EFED]/40 font-mono text-xs">
                            <Tag className="w-8 h-8 mx-auto mb-2 text-zinc-400 stroke-[1.5]" />
                            No lightweight tags have been created yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {tags.map(t => {
                              const isCheckedOut = status?.currentCommitId === t.commitId && status.isDetached;
                              return (
                                <div
                                  key={t.name}
                                  className={`flex items-center justify-between px-4 py-3.5 border transition ${
                                    isCheckedOut
                                      ? 'border-[#141414] bg-[#F0EFED] shadow-[2px_2px_0px_#141414]'
                                      : 'border-zinc-400 bg-[#F0EFED]/40 hover:bg-[#D9D8D5]/30'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <Tag className={`w-5 h-5 shrink-0 ${isCheckedOut ? 'text-[#141414]' : 'text-zinc-500'}`} />
                                    <div className="min-w-0 font-mono">
                                      <div className="flex items-center gap-2">
                                        <span className={`text-sm font-bold truncate ${isCheckedOut ? 'text-[#141414]' : 'text-zinc-700'}`}>
                                          {t.name}
                                        </span>
                                        {isCheckedOut && (
                                          <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-[#FFF3E0] text-amber-950 border border-amber-900 font-mono">
                                            Checked Out
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[10px] text-zinc-600 mt-0.5 truncate">
                                        Commit: <span className="font-bold">{t.commitId}</span>
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      onClick={() => handleCheckoutTag(t.name)}
                                      className="px-2.5 py-1.5 bg-[#141414] text-[#E4E3E0] hover:opacity-90 font-mono text-[10px] uppercase font-bold border border-[#141414] shadow-[2px_2px_0px_#888888] cursor-pointer"
                                    >
                                      Checkout
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTag(t.name)}
                                      className="p-2 border border-[#141414] text-[#141414] hover:bg-rose-100 hover:text-rose-700 hover:border-rose-900 transition cursor-pointer"
                                      title="Delete Tag"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* New Tag Form */}
                    <div className="lg:col-span-5 space-y-4">
                      <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-4 shadow-[4px_4px_0px_#141414]">
                        <div className="flex items-center gap-2 text-[#141414]">
                          <Plus className="w-4.5 h-4.5" />
                          <h3 className="text-xs font-mono font-bold uppercase tracking-wider">Create Lightweight Tag</h3>
                        </div>

                        <form onSubmit={handleCreateTag} className="space-y-4 font-mono">
                          <div>
                            <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Tag Name</label>
                            <input
                              type="text"
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              placeholder="e.g. v1.0.0-alpha"
                              className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] focus:outline-none focus:bg-white"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Target Commit</label>
                            {history.length === 0 ? (
                              <input
                                type="text"
                                value={tagCommitId}
                                onChange={(e) => setTagCommitId(e.target.value)}
                                placeholder="Enter commit ID"
                                className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] focus:outline-none focus:bg-white"
                                required
                              />
                            ) : (
                              <div className="space-y-2">
                                <select
                                  value={tagCommitId}
                                  onChange={(e) => setTagCommitId(e.target.value)}
                                  className="w-full p-3 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] focus:outline-none focus:bg-white"
                                  required
                                >
                                  <option value="">-- Select Commit to Tag --</option>
                                  {history.map(c => (
                                    <option key={c.id} value={c.id}>
                                      {c.id.substring(0, 7)} - {c.message} ({new Date(c.timestamp).toLocaleDateString()})
                                    </option>
                                  ))}
                                </select>
                                <div className="text-[10px] text-zinc-600 flex justify-between">
                                  <span>Or paste ID manually:</span>
                                  {status?.currentCommitId && (
                                    <button
                                      type="button"
                                      onClick={() => setTagCommitId(status.currentCommitId || '')}
                                      className="underline hover:text-black"
                                    >
                                      Use current HEAD ({status.currentCommitId.substring(0, 7)})
                                    </button>
                                  )}
                                </div>
                                <input
                                  type="text"
                                  value={tagCommitId}
                                  onChange={(e) => setTagCommitId(e.target.value)}
                                  placeholder="Manual commit ID override"
                                  className="w-full p-2 border border-[#141414] bg-[#E4E3E0]/30 text-xs text-[#141414] focus:outline-none focus:bg-white"
                                />
                              </div>
                            )}
                          </div>

                          <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-2.5 bg-[#141414] text-[#E4E3E0] text-xs uppercase tracking-widest font-bold border border-[#141414] cursor-pointer"
                            id="create-tag-btn"
                          >
                            Create Lightweight Tag
                          </button>
                        </form>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 5: DIFFERENCE VIEWER */}
              {activeTab === 'diff' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">Line-by-Line Difference Viewer</h2>
                      <p className="text-xs font-serif italic text-zinc-700">Analyze modifications, line deletions, and text additions across historical snapshots.</p>
                    </div>
                  </div>

                  <div className="bg-[#D9D8D5]/30 border border-[#141414] p-4 flex flex-wrap gap-4 items-end shadow-[4px_4px_0px_#141414]">
                    
                    {/* File selector */}
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Select Tracked File</label>
                      <select
                        value={diffFile}
                        onChange={(e) => setDiffFile(e.target.value)}
                        className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                      >
                        <option value="">-- Choose a File --</option>
                        {status?.files.map(f => (
                          <option key={f.path} value={f.path}>{f.path}</option>
                        ))}
                      </select>
                    </div>

                    {/* Mode selector */}
                    <div className="w-full sm:w-auto">
                      <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Comparison Mode</label>
                      <div className="flex bg-[#F0EFED] p-1 border border-[#141414]">
                        <button
                          onClick={() => setDiffMode('working_vs_staged')}
                          className={`px-3 py-1.5 text-[10px] font-mono font-bold uppercase transition ${diffMode === 'working_vs_staged' ? 'bg-[#141414] text-[#E4E3E0]' : 'text-zinc-600 hover:text-black'}`}
                        >
                          Working vs Stage
                        </button>
                        <button
                          onClick={() => setDiffMode('staged_vs_committed')}
                          className={`px-3 py-1.5 text-[10px] font-mono font-bold uppercase transition ${diffMode === 'staged_vs_committed' ? 'bg-[#141414] text-[#E4E3E0]' : 'text-zinc-600 hover:text-black'}`}
                        >
                          Stage vs HEAD
                        </button>
                        <button
                          onClick={() => setDiffMode('commit_vs_commit')}
                          className={`px-3 py-1.5 text-[10px] font-mono font-bold uppercase transition ${diffMode === 'commit_vs_commit' ? 'bg-[#141414] text-[#E4E3E0]' : 'text-zinc-600 hover:text-black'}`}
                        >
                          Commit vs Commit
                        </button>
                      </div>
                    </div>

                    {/* Commit select dropdowns */}
                    {diffMode === 'commit_vs_commit' && (
                      <div className="flex gap-2 w-full md:w-auto">
                        <div className="flex-1 sm:w-48">
                          <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Commit A (Old)</label>
                          <select
                            value={diffCommitA}
                            onChange={(e) => setDiffCommitA(e.target.value)}
                            className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                          >
                            <option value="">-- Select Commit --</option>
                            {history.map(c => (
                              <option key={c.id} value={c.id}>{c.message.substring(0, 20)} ({c.id.substring(0, 7)})</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 sm:w-48">
                          <label className="block text-[10px] uppercase font-mono text-zinc-700 font-bold mb-1">Commit B (New)</label>
                          <select
                            value={diffCommitB}
                            onChange={(e) => setDiffCommitB(e.target.value)}
                            className="w-full px-3 py-2 border border-[#141414] bg-[#F0EFED] text-xs focus:outline-none focus:bg-white text-[#141414] font-mono"
                          >
                            <option value="">-- Select Commit --</option>
                            {history.map(c => (
                              <option key={c.id} value={c.id}>{c.message.substring(0, 20)} ({c.id.substring(0, 7)})</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Diff Rendering Screen */}
                  <div className="border border-[#141414] overflow-hidden bg-[#F0EFED] font-mono text-xs shadow-[4px_4px_0px_#141414]">
                    <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
                      <span>Diff for: <span className="font-bold">{diffFile || 'None selected'}</span></span>
                      <span className="text-[10px] uppercase border border-[#E4E3E0] text-[#E4E3E0] px-2 py-1">
                        {diffMode.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {!diffFile ? (
                      <div className="p-12 text-center text-zinc-600 font-serif italic">
                        Select a sandbox file to run difference comparison.
                      </div>
                    ) : diffResult.length === 0 ? (
                      <div className="p-12 text-center text-zinc-600 font-serif italic">
                        No lines differ. The contents match exactly or the file does not exist in these contexts.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#141414]/10 overflow-x-auto max-h-[500px]">
                        {diffResult.map((line, idx) => {
                          let lineStyle = 'text-zinc-800 bg-[#F0EFED]/20';
                          let prefix = ' ';
                          if (line.type === 'add') {
                            lineStyle = 'bg-[#E8F5E9] text-emerald-950 border-l-4 border-emerald-600 pl-3';
                            prefix = '+';
                          } else if (line.type === 'remove') {
                            lineStyle = 'bg-[#FFEBEE] text-rose-950 border-l-4 border-rose-600 pl-3';
                            prefix = '-';
                          }

                          return (
                            <div key={idx} className={`flex py-1.5 px-4 font-mono select-text hover:bg-[#D9D8D5]/30 transition-colors ${lineStyle}`}>
                              {/* Line A Num */}
                              <div className="w-12 text-right text-zinc-500 select-none pr-3 font-bold">
                                {line.lineNumA || ''}
                              </div>
                              {/* Line B Num */}
                              <div className="w-12 text-right text-zinc-500 select-none pr-4 border-r border-[#141414]/15 font-bold">
                                {line.lineNumB || ''}
                              </div>
                              {/* Content Line */}
                              <div className="flex-1 pl-4 whitespace-pre font-mono">
                                <span className="select-none text-zinc-500 pr-2">{prefix}</span>
                                {line.content}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 6: VCS INTERNALS */}
              {activeTab === 'internals' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-[#141414]">VCS Repository Internals</h2>
                      <p className="text-xs font-serif italic text-zinc-700 font-semibold">Direct inspectable look inside the plain files of the <code className="bg-[#D9D8D5] border border-[#141414] px-1 py-0.5 font-mono text-[#141414] font-bold">.gitclone/</code> hidden database.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={handleExportPDF}
                        disabled={isLoading}
                        className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-[#141414] disabled:opacity-50 text-xs font-mono font-bold uppercase border border-[#141414] shadow-[4px_4px_0px_#141414] flex items-center gap-2 transition cursor-pointer"
                        title="Generate a beautiful PDF Report containing working status, logs, database snapshot meta"
                      >
                        <FileText className="w-4 h-4" />
                        Export PDF Report
                      </button>
                      <button
                        onClick={handleExportRepository}
                        disabled={isLoading}
                        className="px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:bg-zinc-800 disabled:opacity-50 text-xs font-mono font-bold uppercase border border-[#141414] shadow-[4px_4px_0px_#888888] flex items-center gap-2 transition cursor-pointer"
                        title="Export the entire .gitclone directory as a downloadable ZIP archive"
                      >
                        <Download className="w-4 h-4" />
                        Export Repository
                      </button>
                    </div>
                  </div>

                  {internals ? (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      
                      {/* Left: Metadata Files */}
                      <div className="lg:col-span-6 space-y-6">
                        {/* HEAD Pointer */}
                        <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-2 shadow-[4px_4px_0px_#141414]">
                          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414]">HEAD Pointer File</h3>
                          <p className="text-xs font-serif italic text-zinc-600">Tells GitClone where the checkout camera is currently resting.</p>
                          <div className="p-3 bg-[#E4E3E0]/40 border border-[#141414] font-mono text-xs">
                            <span className="text-zinc-500 font-bold">File: .gitclone/HEAD</span>
                            <div className="text-[#141414] mt-2 font-bold">
                              {internals.head?.type === 'branch' ? `ref: ${internals.head.value}` : internals.head?.value}
                            </div>
                          </div>
                        </div>

                        {/* Staging Index File */}
                        <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-2 shadow-[4px_4px_0px_#141414]">
                          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414]">index.json (Staging Area)</h3>
                          <p className="text-xs font-serif italic text-zinc-600">Stores path-to-hash keys preparing for the next commit snapshot.</p>
                          <div className="p-3 bg-[#E4E3E0]/40 border border-[#141414] font-mono text-xs">
                            <span className="text-zinc-500 font-bold">File: .gitclone/index.json</span>
                            <pre className="text-zinc-800 mt-2 text-[11px] overflow-auto max-h-48 whitespace-pre-wrap leading-relaxed">
                              {JSON.stringify(internals.index, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </div>

                      {/* Right: Objects Store */}
                      <div className="lg:col-span-6 space-y-6">
                        <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-3 shadow-[4px_4px_0px_#141414]">
                          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414]">Content-Addressable Object Store</h3>
                          <p className="text-xs font-serif italic text-zinc-600">
                            Unique content blobs are stored under a file named exactly by their SHA-1 checksum. De-duplicated.
                          </p>
                          <div className="p-4 bg-[#E4E3E0]/40 border border-[#141414] text-center space-y-2">
                            <BookOpen className="w-8 h-8 text-[#141414] mx-auto" />
                            <div className="text-2xl font-mono font-bold text-[#141414]">{internals.objectCount}</div>
                            <p className="text-[10px] text-zinc-600 font-mono font-bold uppercase">Total unique object files in .gitclone/objects/</p>
                          </div>
                          <p className="text-[11px] text-zinc-700 font-serif italic leading-relaxed">
                            ℹ️ When files have identical text contents, they resolve to the exact same SHA-1 hash. GitClone only stores them once under that hash as an immutable file, achieving full de-duplication like real Git.
                          </p>
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="text-center py-12 text-zinc-600 font-serif italic">
                      Loading internal logs...
                    </div>
                  )}
                </div>
              )}

              {/* TAB 7: CONFLICT RESOLUTION */}
              {activeTab === 'conflicts' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#141414] pb-5">
                    <div>
                      <h2 className="text-xl font-mono font-bold uppercase text-rose-700">Merge Conflict Resolution Suite</h2>
                      <p className="text-xs font-serif italic text-zinc-700">
                        Select resolution strategies or manually edit files with competing content hashes to complete merge commits.
                      </p>
                    </div>
                  </div>

                  {activeConflicts.length > 0 ? (
                    <div className="space-y-6">
                      <div className="bg-rose-50 border border-rose-900 text-rose-950 p-4 font-mono text-xs flex items-center justify-between shadow-[4px_4px_0px_#b91c1c]">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
                          <div>
                            <span className="font-bold">Conflicts Active:</span> Merging branch <span className="font-bold underline">'{conflictTargetBranch}'</span> into <span className="font-bold">'{status?.currentBranch || 'HEAD'}'</span>.
                            <p className="text-[10px] text-zinc-600 mt-1">Please resolve and stage all listed files to proceed.</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="px-2 py-1 bg-rose-700 text-[#E4E3E0] font-bold text-[10px] uppercase">
                            {activeConflicts.length} Unresolved
                          </span>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {activeConflicts.map((conflict) => {
                          const resInfo = resolvedFiles[conflict.path] || { content: conflict.oursContent, mode: 'ours' };
                          const isManual = resInfo.mode === 'manual';

                          return (
                            <div key={conflict.path} className="border border-[#141414] bg-[#F0EFED] overflow-hidden shadow-[4px_4px_0px_#141414]" id={`conflict-card-${conflict.path.replace(/\./g, '-')}`}>
                              {/* Header */}
                              <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3.5 flex items-center justify-between font-mono text-xs">
                                <div className="flex items-center gap-2">
                                  <FileCode className="w-4.5 h-4.5 text-zinc-400" />
                                  <span className="font-bold">{conflict.path}</span>
                                </div>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-rose-800 text-[#E4E3E0]">
                                  Conflicted Hash Match
                                </span>
                              </div>

                              <div className="p-5 space-y-5">
                                {/* Side-by-Side 3-Panel Source Inspector */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  {/* Ours Panel */}
                                  <div className="border border-[#141414] bg-white shadow-[2px_2px_0px_#141414] flex flex-col">
                                    <div className="bg-[#141414] text-[#E4E3E0] px-3 py-2 text-[10px] font-mono uppercase font-bold flex items-center justify-between">
                                      <span>Ours (Current Branch HEAD)</span>
                                      <button
                                        type="button"
                                        onClick={() => handleChooseResolution(conflict.path, 'ours', conflict.oursContent)}
                                        className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] uppercase font-bold border border-[#141414] cursor-pointer"
                                      >
                                        Accept Ours
                                      </button>
                                    </div>
                                    <pre className="p-3 font-mono text-[11px] bg-zinc-50 overflow-auto h-48 leading-relaxed whitespace-pre select-text text-zinc-800">
                                      {conflict.oursContent || <span className="text-zinc-400 font-serif italic">[Empty File Content]</span>}
                                    </pre>
                                  </div>

                                  {/* Common Ancestor Panel */}
                                  <div className="border border-[#141414] bg-white shadow-[2px_2px_0px_#141414] flex flex-col">
                                    <div className="bg-zinc-700 text-zinc-100 px-3 py-2 text-[10px] font-mono uppercase font-bold flex items-center justify-between">
                                      <span>Common Ancestor (Base)</span>
                                      <span className="text-[9px] font-mono opacity-65 font-bold">ReadOnly</span>
                                    </div>
                                    <pre className="p-3 font-mono text-[11px] bg-zinc-100 overflow-auto h-48 leading-relaxed whitespace-pre select-text text-zinc-500">
                                      {conflict.baseContent || <span className="text-zinc-400 font-serif italic">[No Base Content / New File]</span>}
                                    </pre>
                                  </div>

                                  {/* Theirs Panel */}
                                  <div className="border border-[#141414] bg-white shadow-[2px_2px_0px_#141414] flex flex-col">
                                    <div className="bg-[#141414] text-[#E4E3E0] px-3 py-2 text-[10px] font-mono uppercase font-bold flex items-center justify-between">
                                      <span>Theirs (Incoming Commit)</span>
                                      <button
                                        type="button"
                                        onClick={() => handleChooseResolution(conflict.path, 'theirs', conflict.theirsContent)}
                                        className="px-2 py-0.5 bg-sky-600 hover:bg-sky-700 text-white text-[9px] uppercase font-bold border border-[#141414] cursor-pointer"
                                      >
                                        Accept Theirs
                                      </button>
                                    </div>
                                    <pre className="p-3 font-mono text-[11px] bg-zinc-50 overflow-auto h-48 leading-relaxed whitespace-pre select-text text-zinc-800">
                                      {conflict.theirsContent || <span className="text-zinc-400 font-serif italic">[Empty File Content]</span>}
                                    </pre>
                                  </div>
                                </div>

                                {/* Interactive Conflict Resolution Sandbox */}
                                <div className="border border-[#141414] overflow-hidden bg-white shadow-[3px_3px_0px_#141414] flex flex-col">
                                  <div className="bg-zinc-900 text-zinc-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs border-b border-[#141414]">
                                    <div className="flex items-center gap-2">
                                      <Sliders className="w-4 h-4 text-amber-500" />
                                      <span className="font-bold">Live Merged Output Preview Sandbox</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleChooseResolution(conflict.path, 'ours', conflict.oursContent)}
                                        className={`px-2.5 py-1 text-[10px] uppercase font-bold border cursor-pointer ${resInfo.mode === 'ours' ? 'bg-emerald-600 text-white border-emerald-800' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750'}`}
                                      >
                                        Ours
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleChooseResolution(conflict.path, 'theirs', conflict.theirsContent)}
                                        className={`px-2.5 py-1 text-[10px] uppercase font-bold border cursor-pointer ${resInfo.mode === 'theirs' ? 'bg-sky-600 text-white border-sky-800' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750'}`}
                                      >
                                        Theirs
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleChooseResolution(conflict.path, 'manual', resInfo.content)}
                                        className={`px-2.5 py-1 text-[10px] uppercase font-bold border cursor-pointer ${resInfo.mode === 'manual' ? 'bg-amber-600 text-white border-amber-800' : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750'}`}
                                      >
                                        Manual Editor
                                      </button>
                                    </div>
                                  </div>

                                  <div className="relative">
                                    <textarea
                                      value={resInfo.content}
                                      onChange={(e) => handleChooseResolution(conflict.path, 'manual', e.target.value)}
                                      className="w-full h-48 p-4 font-mono text-xs bg-zinc-950 text-emerald-400 focus:outline-none leading-relaxed resize-none font-bold"
                                      placeholder="// Edit merged result manually here. Any key pressed auto-promotes editing mode to Manual..."
                                      spellCheck={false}
                                    />
                                    <div className="absolute bottom-2 right-3 text-[9px] font-mono text-zinc-500 uppercase bg-zinc-900/80 px-1.5 py-0.5 border border-zinc-800 select-none">
                                      Mode: <span className="text-amber-400 font-bold">{resInfo.mode}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Action button to save & track */}
                                <div className="flex justify-end pt-1">
                                  <button
                                    onClick={() => handleResolveConflictFile(conflict.path)}
                                    className="px-5 py-2.5 bg-[#141414] text-[#E4E3E0] hover:opacity-90 font-mono text-xs uppercase font-bold border border-[#141414] shadow-[4px_4px_0px_#888888] flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Save className="w-4.5 h-4.5" />
                                    <span>Resolve & Stage File</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : conflictTargetBranch ? (
                    /* All conflicts are resolved but merge commit is not completed */
                    <div className="max-w-2xl mx-auto space-y-6">
                      <div className="bg-emerald-50 border border-emerald-900 text-emerald-950 p-6 shadow-[4px_4px_0px_#059669] space-y-3">
                        <div className="flex items-center gap-2 font-mono text-sm font-bold">
                          <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
                          <span>All Conflicts Resolved!</span>
                        </div>
                        <p className="text-xs font-serif italic text-zinc-700">
                          Every competing content hash has been reconciled, saved, and staged. You are now ready to commit the dual-parent merge.
                        </p>
                      </div>

                      <div className="bg-[#F0EFED] border border-[#141414] p-6 space-y-4 shadow-[4px_4px_0px_#141414]">
                        <div className="flex items-center gap-2 text-[#141414] border-b border-[#141414]/10 pb-3">
                          <GitCommit className="w-5 h-5 text-[#141414]" />
                          <h3 className="text-sm font-mono font-bold uppercase tracking-wider">Finalize Merge Commit</h3>
                        </div>

                        <form onSubmit={handleCompleteMergeCommit} className="space-y-4 font-mono">
                          <div>
                            <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Commit Message</label>
                            <input
                              type="text"
                              value={commitMessage}
                              onChange={(e) => setCommitMessage(e.target.value)}
                              className="w-full p-3 border border-[#141414] bg-white text-xs text-[#141414] font-mono focus:outline-none"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Author Identity</label>
                            <input
                              type="text"
                              value={authorName}
                              onChange={(e) => setAuthorName(e.target.value)}
                              className="w-full p-3 border border-[#141414] bg-white text-xs text-[#141414] font-mono focus:outline-none"
                              required
                            />
                          </div>

                          <div className="pt-2">
                            <button
                              type="submit"
                              disabled={isLoading}
                              className="w-full px-5 py-3.5 bg-[#141414] text-[#E4E3E0] hover:opacity-95 text-xs font-mono uppercase font-bold tracking-wider border border-[#141414] shadow-[4px_4px_0px_#888888] flex items-center justify-center gap-2 cursor-pointer"
                            >
                              {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitPullRequest className="w-4 h-4" />}
                              Complete Merge Commit (Write dual-parent record)
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  ) : (
                    /* Default Idle state */
                    <div className="max-w-xl mx-auto text-center p-12 bg-[#F0EFED] border border-[#141414] space-y-4 shadow-[4px_4px_0px_#141414]">
                      <div className="p-4 bg-[#D9D8D5] border border-[#141414] w-16 h-16 rounded-full flex items-center justify-center mx-auto text-[#141414]">
                        <CheckCircle className="w-8 h-8" />
                      </div>
                      <h3 className="text-md font-mono font-bold uppercase">No Active Merge Conflicts</h3>
                      <p className="text-xs font-serif italic text-zinc-700 leading-relaxed">
                        Your sandbox is in a tidy state. Whenever you attempt to merge branches with conflicting content revisions (competing file state hashes), GitClone's three-way merge detector will lock and route you here to choose resolution recipes.
                      </p>
                      <div className="pt-4">
                        <button
                          onClick={() => setActiveTab('branches')}
                          className="px-4 py-2 border border-[#141414] bg-[#141414] text-[#E4E3E0] hover:opacity-90 text-[10px] font-mono uppercase font-bold tracking-wider cursor-pointer"
                        >
                          Go to Branches Tab
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 8: GUIDED CHALLENGES PLAYGROUND */}
              {activeTab === 'playground' && (
                <div className="space-y-6">
                  {/* Top Header Card */}
                  <div className="bg-emerald-50 border border-emerald-900 text-emerald-950 p-6 shadow-[4px_4px_0px_#049669] flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Award className="w-6 h-6 text-emerald-700 shrink-0" />
                        <h2 className="text-xl font-mono font-bold uppercase">GitClone Interactive Learn VCS Academy</h2>
                      </div>
                      <p className="text-xs font-serif italic text-zinc-700 leading-relaxed">
                        Learn real-world version control concepts with hands-on practice in a safe, disposable sandbox environment.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 font-mono shrink-0">
                      <div className="px-4 py-2 border border-[#141414] bg-white text-[#141414] text-xs font-bold shadow-[2px_2px_0px_#141414]">
                        Academy Steps: <span className="text-emerald-700 text-sm font-bold">{playgroundStepCount}</span>
                      </div>
                      <button
                        onClick={handleResetPlayground}
                        className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white text-xs uppercase font-mono font-bold border border-rose-900 shadow-[2px_2px_0px_#141414] active:translate-y-[1.5px] active:shadow-[0.5px_0.5px_0px_#141414] transition-all cursor-pointer"
                        title="Reset the practice sandbox workspace"
                      >
                        Reset Sandbox
                      </button>
                    </div>
                  </div>

                  {/* Sub-Tabs Navigation */}
                  <div className="flex border-b border-[#141414] font-mono text-xs">
                    <button
                      onClick={() => setActiveSubTab('lessons')}
                      className={`px-5 py-3 border-t border-l border-r border-[#141414] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                        activeSubTab === 'lessons'
                          ? 'bg-[#E4E3E0] text-[#141414] -mb-[1px] border-b-transparent'
                          : 'bg-zinc-200 text-zinc-600 hover:text-zinc-900 border-transparent hover:bg-zinc-100'
                      }`}
                    >
                      <BookOpen className="w-4 h-4 text-emerald-700" />
                      <span>🎓 Interactive Lessons</span>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-1.5 py-0.5 border border-emerald-300">
                        {completedLessons.length}/8
                      </span>
                    </button>
                    <button
                      onClick={() => setActiveSubTab('golf')}
                      className={`px-5 py-3 border-t border-l border-r border-[#141414] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                        activeSubTab === 'golf'
                          ? 'bg-[#E4E3E0] text-[#141414] -mb-[1px] border-b-transparent'
                          : 'bg-zinc-200 text-zinc-600 hover:text-zinc-900 border-transparent hover:bg-zinc-100'
                      }`}
                    >
                      <Award className="w-4 h-4 text-amber-700" />
                      <span>🏌️ Git Golf Challenges</span>
                    </button>
                    <button
                      onClick={() => setActiveSubTab('internals')}
                      className={`px-5 py-3 border-t border-l border-r border-[#141414] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                        activeSubTab === 'internals'
                          ? 'bg-[#E4E3E0] text-[#141414] -mb-[1px] border-b-transparent'
                          : 'bg-zinc-200 text-zinc-600 hover:text-zinc-900 border-transparent hover:bg-zinc-100'
                      }`}
                    >
                      <Sliders className="w-4 h-4 text-zinc-700" />
                      <span>📖 Internals & Glossary</span>
                    </button>
                  </div>

                  {/* 1. INTERACTIVE LESSONS SUB-TAB */}
                  {activeSubTab === 'lessons' && (
                    <div className="space-y-6">
                      {currentLessonIndex === -1 ? (
                        /* LESSONS INDEX VIEW */
                        <div className="space-y-6">
                          <div className="bg-[#F0EFED] border border-[#141414] p-6 shadow-[4px_4px_0px_#141414]">
                            <h3 className="text-sm font-mono font-bold uppercase text-[#141414] border-b border-zinc-300 pb-2 mb-4">
                              Interactive Lessons Curriculum
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                              {LEARN_LESSONS.map((lesson, idx) => {
                                const isCompleted = completedLessons.includes(lesson.id);
                                return (
                                  <div
                                    key={lesson.id}
                                    className={`bg-white border border-[#141414] p-5 shadow-[3px_3px_0px_#141414] flex flex-col justify-between h-56 transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#141414]`}
                                  >
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between text-[10px] font-mono">
                                        <span className={`px-2 py-0.5 font-bold uppercase border ${
                                          lesson.difficulty === 'Beginner'
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                            : lesson.difficulty === 'Intermediate'
                                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                                            : 'bg-rose-50 text-rose-800 border-rose-300'
                                        }`}>
                                          {lesson.difficulty}
                                        </span>
                                        <span className="text-zinc-500 font-bold">{lesson.estTime}</span>
                                      </div>

                                      <h4 className="font-mono font-bold text-xs text-[#141414] line-clamp-2 pt-1 leading-tight">
                                        {lesson.title}
                                      </h4>
                                      <p className="font-serif italic text-[11px] text-zinc-600 line-clamp-3 leading-normal">
                                        {lesson.description}
                                      </p>
                                    </div>

                                    <div className="pt-3 border-t border-zinc-100 flex items-center justify-between mt-auto">
                                      {isCompleted ? (
                                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-600">
                                          <CheckCircle className="w-3.5 h-3.5" /> Completed
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase">Not Solved</span>
                                      )}
                                      <button
                                        onClick={() => {
                                          setCurrentLessonIndex(idx);
                                          handleResetPlayground();
                                        }}
                                        className="px-3 py-1 bg-[#141414] text-white hover:bg-zinc-800 text-[10px] font-mono uppercase font-bold border border-[#141414] cursor-pointer"
                                      >
                                        Start
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* ACTIVE LESSON WORKSPACE VIEW */
                        <div className="space-y-6">
                          <div className="flex items-center justify-between font-mono text-xs">
                            <button
                              onClick={() => setCurrentLessonIndex(-1)}
                              className="px-4 py-2 border border-[#141414] bg-[#F0EFED] text-[#141414] hover:bg-[#D9D8D5] uppercase font-bold shadow-[2px_2px_0px_#141414] cursor-pointer"
                            >
                              ← Curriculum Index
                            </button>
                            <div className="flex items-center gap-4">
                              <span className="text-zinc-500 font-bold">
                                Lesson {currentLessonIndex + 1} of 8
                              </span>
                              <div className="w-32 bg-zinc-300 h-2 border border-zinc-400">
                                <div
                                  className="bg-emerald-600 h-full transition-all"
                                  style={{ width: `${(completedLessons.length / 8) * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                            {/* Left Panel: Concept Explanations */}
                            <div className="xl:col-span-7 space-y-6">
                              <div className="bg-[#F0EFED] border border-[#141414] p-6 space-y-5 shadow-[4px_4px_0px_#141414]">
                                <div className="border-b border-[#141414]/10 pb-3 flex items-center justify-between">
                                  <h3 className="text-md font-mono font-bold text-[#141414] flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-emerald-600" />
                                    {LEARN_LESSONS[currentLessonIndex].title}
                                  </h3>
                                  <span className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase border ${
                                    completedLessons.includes(LEARN_LESSONS[currentLessonIndex].id)
                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-400'
                                      : 'bg-amber-100 text-amber-800 border-amber-400'
                                  }`}>
                                    {completedLessons.includes(LEARN_LESSONS[currentLessonIndex].id) ? 'Completed' : 'In Progress'}
                                  </span>
                                </div>

                                {/* Concept Text */}
                                <div className="prose max-w-none text-xs font-serif leading-relaxed text-zinc-800 space-y-4">
                                  {LEARN_LESSONS[currentLessonIndex].conceptText.split('\n\n').map((para, pIdx) => (
                                    <p key={pIdx} className="italic">
                                      {para}
                                    </p>
                                  ))}
                                </div>

                                {/* Real World Callout */}
                                <div className="p-4 bg-white border-l-4 border-amber-500 border border-zinc-300 space-y-1.5 rounded-r-xs">
                                  <span className="block font-mono text-[10px] font-bold text-amber-700 uppercase tracking-widest">Real-World Software Engineering</span>
                                  <p className="text-xs text-zinc-700 leading-normal font-sans">
                                    {LEARN_LESSONS[currentLessonIndex].realWorldImpact}
                                  </p>
                                </div>

                                {/* Graph Visualization Preview */}
                                <div className="p-4 bg-[#D9D8D5] border border-zinc-400 space-y-1 rounded-sm font-mono text-[11px] text-zinc-800">
                                  <span className="block font-bold text-[10px] uppercase text-zinc-600 mb-1">Visual Log Preview:</span>
                                  <p className="leading-normal italic">
                                    {LEARN_LESSONS[currentLessonIndex].graphPreviewDesc}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Right Panel: Practice Workspace Objective & Console */}
                            <div className="xl:col-span-5 space-y-6">
                              <div className="bg-[#141414] text-[#E4E3E0] border border-[#141414] p-6 space-y-5 shadow-[4px_4px_0px_#049669]">
                                <div className="space-y-1">
                                  <span className="text-[10px] uppercase font-mono text-zinc-400 font-bold tracking-widest block">Hands-On Practice Workspace</span>
                                  <h4 className="text-sm font-mono font-bold text-yellow-400">YOUR OBJECTIVE:</h4>
                                </div>

                                <div className="p-4 bg-zinc-900 border border-zinc-800 font-mono text-xs leading-relaxed text-[#E4E3E0] border-l-4 border-yellow-400">
                                  {LEARN_LESSONS[currentLessonIndex].instructions}
                                </div>

                                {/* EMBEDDED QUICK CONSOLE CONTROLS */}
                                <div className="pt-2 border-t border-zinc-800 space-y-4 font-mono text-xs">
                                  <span className="block text-[10px] uppercase text-zinc-400 font-bold tracking-wider mb-2">Interactive Command Console:</span>

                                  {/* Lesson 1 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_repo' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <p className="text-[11px] text-zinc-400">Pressing this button resets and prepares the database inside your dedicated sandbox repository folder.</p>
                                      <button
                                        onClick={async () => {
                                          setIsLoading(true);
                                          try {
                                            const res = await fetch('/api/playground/reset', { method: 'POST' });
                                            const data = await res.json();
                                            if (data.success) {
                                              const initRes = await fetch('/api/init', { method: 'POST' });
                                              const initData = await initRes.json();
                                              if (initData.success) {
                                                showAlert('Playground repo initialized successfully!', 'success');
                                              }
                                              refreshAll();
                                            }
                                          } catch (e: any) {
                                            showAlert(`Init failed: ${e.message}`, 'error');
                                          } finally {
                                            setIsLoading(false);
                                          }
                                        }}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        {isLoading ? 'Processing...' : 'Initialize / Reset Database'}
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 2 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_stage' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">File Name Path</label>
                                        <input
                                          type="text"
                                          value={lesson2Path}
                                          onChange={(e) => setLesson2Path(e.target.value)}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">Content to write</label>
                                        <textarea
                                          value={lesson2Content}
                                          onChange={(e) => setLesson2Content(e.target.value)}
                                          rows={2}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none focus:border-zinc-500 font-mono text-xs resize-none"
                                        />
                                      </div>
                                      <button
                                        onClick={() => handleQuickCreateFile(lesson2Path, lesson2Content)}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Create & Stage File
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 3 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_commit' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">Commit Message</label>
                                        <input
                                          type="text"
                                          value={lesson3Message}
                                          onChange={(e) => setLesson3Message(e.target.value)}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                                        />
                                      </div>
                                      <button
                                        onClick={() => handleQuickCommit(lesson3Message)}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Record Commit Snapshot
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 4 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_branch' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">New Branch Name</label>
                                        <input
                                          type="text"
                                          value={lesson4Branch}
                                          onChange={(e) => setLesson4Branch(e.target.value)}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none focus:border-zinc-500 font-mono text-xs"
                                        />
                                      </div>
                                      <button
                                        onClick={() => handleQuickCreateBranch(lesson4Branch)}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Create Branch Pointer
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 5 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_checkout' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">Target Branch Pointer</label>
                                        <select
                                          value={lesson5TargetBranch}
                                          onChange={(e) => setLesson5TargetBranch(e.target.value)}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none font-mono text-xs"
                                        >
                                          <option value="">-- Choose Branch --</option>
                                          {branches.map(b => (
                                            <option key={b.name} value={b.name}>{b.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <button
                                        onClick={() => handleQuickCheckout(lesson5TargetBranch)}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Checkout Branch Pointer
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 6 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_conflict' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <p className="text-[11px] text-zinc-400">Clicking below automatically initializes main, commits edits, branches out, modifies identical lines in parallel, and attempts to merge—deliberately resulting in a real merge conflict!</p>
                                      <button
                                        onClick={handleQuickTriggerConflict}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Trigger Safe Merge Conflict
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 7 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_detached' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <div>
                                        <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">Target Commit SHA</label>
                                        <select
                                          value={lesson7TargetCommit}
                                          onChange={(e) => setLesson7TargetCommit(e.target.value)}
                                          className="w-full p-2 bg-zinc-950 text-white border border-zinc-800 focus:outline-none font-mono text-xs"
                                        >
                                          <option value="">-- Choose a Commit Hash --</option>
                                          {history.map(c => (
                                            <option key={c.id} value={c.id}>
                                              {c.id.substring(0, 8)} - {c.message}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <button
                                        onClick={() => handleQuickCheckout(lesson7TargetCommit)}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Checkout Commit SHA Directly
                                      </button>
                                    </div>
                                  )}

                                  {/* Lesson 8 Controls */}
                                  {LEARN_LESSONS[currentLessonIndex].id === 'lesson_reflog' && (
                                    <div className="space-y-3 bg-zinc-900/60 p-4 border border-zinc-800">
                                      <p className="text-[11px] text-zinc-400">Checkout main branch below to restore your HEAD pointer and finish your curriculum verification.</p>
                                      <button
                                        onClick={() => handleQuickCheckout('main')}
                                        disabled={isLoading}
                                        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-800 uppercase font-bold font-mono text-xs cursor-pointer shadow-[2px_2px_0px_#141414]"
                                      >
                                        Switch back to main
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* LIVE VERIFICATION STATUS BAR */}
                                <div className="pt-2">
                                  {completedLessons.includes(LEARN_LESSONS[currentLessonIndex].id) ? (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.98 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      className="p-4 bg-gradient-to-r from-emerald-600 to-teal-700 border border-emerald-950 text-white rounded-xs space-y-3 shadow-[2px_2px_0px_#065f46]"
                                    >
                                      <div className="flex items-center gap-2">
                                        <CheckCircle className="w-5 h-5 text-yellow-300 shrink-0" />
                                        <div className="text-xs font-bold uppercase tracking-wider text-yellow-200">
                                          Lesson Completed!
                                        </div>
                                      </div>
                                      <p className="text-[11px] opacity-90 font-serif leading-relaxed">
                                        VCS database verification successful. You have achieved deep operational mastery.
                                      </p>
                                      <div className="flex justify-end pt-1">
                                        {currentLessonIndex < LEARN_LESSONS.length - 1 ? (
                                          <button
                                            onClick={() => {
                                              setCurrentLessonIndex(prev => prev + 1);
                                              handleResetPlayground();
                                            }}
                                            className="px-3 py-1.5 bg-yellow-400 hover:bg-yellow-300 text-zinc-950 font-mono text-[10px] font-bold uppercase border border-yellow-600 shadow-[1px_1px_0px_#141414] active:translate-y-px cursor-pointer"
                                          >
                                            Next Lesson →
                                          </button>
                                        ) : (
                                          <div className="text-center w-full py-1 text-[11px] font-bold text-yellow-200 border-t border-emerald-800 pt-2">
                                            🎉 Magnificent! You are now a certified Version Control Master!
                                          </div>
                                        )}
                                      </div>
                                    </motion.div>
                                  ) : (
                                    <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xs flex items-center gap-3 font-mono text-[11px] text-zinc-400">
                                      <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping shrink-0"></span>
                                      <div className="leading-relaxed">
                                        <span className="font-bold text-amber-400">Awaiting database action:</span> Use the interactive console or click dashboard tabs to perform the required version-control commands.
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. INTERNALS & GLOSSARY SUB-TAB */}
                  {activeSubTab === 'internals' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 font-mono text-xs text-[#141414]">
                      {/* Left Column: Internals Overview */}
                      <div className="lg:col-span-6 bg-[#F0EFED] border border-[#141414] p-6 space-y-6 shadow-[4px_4px_0px_#141414]">
                        <div className="border-b border-[#141414]/10 pb-3 flex items-center gap-2">
                          <Sliders className="w-5 h-5 text-zinc-700" />
                          <h3 className="font-bold uppercase tracking-wider">GitClone System Internals</h3>
                        </div>

                        <div className="space-y-4 leading-relaxed text-zinc-800">
                          <div className="space-y-2">
                            <h4 className="font-bold text-zinc-900 border-l-2 border-emerald-600 pl-2">1. The Content-Addressable Object Store</h4>
                            <p className="font-serif italic pl-2 text-zinc-600">
                              Every file content, subdirectory structure, and commit message is stored in GitClone as an immutable "object". Each object is saved inside the hidden `.gitclone/objects` folder.
                              The object’s file name is determined entirely by computing a cryptographic hash of its contents. If the contents are identical, they occupy the exact same file name, completely eliminating redundancy.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h4 className="font-bold text-zinc-900 border-l-2 border-emerald-600 pl-2">2. Hashing and Pointers</h4>
                            <p className="font-serif italic pl-2 text-zinc-600">
                              Instead of tracking files by names on a timeline, GitClone operates by mapping names to hash values.
                              A **Blob** represents raw file text content.
                              A **Tree** represents a directory listing, mapping file names to Blob hashes.
                              A **Commit** is simply a text file containing the root Tree hash, author data, timestamps, and previous commit hashes (parents).
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h4 className="font-bold text-zinc-900 border-l-2 border-emerald-600 pl-2">3. Branches and HEAD</h4>
                            <p className="font-serif italic pl-2 text-zinc-600">
                              A branch is simply a tiny text file under `.gitclone/refs/heads/` that contains a single 40-character commit SHA-1 string.
                              The `HEAD` file under `.gitclone/HEAD` is another reference pointer that indicates which branch or commit hash is active. Checking out simply overwrites this tiny pointer file and shifts physical files on disk!
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: VCS Glossary Reference */}
                      <div className="lg:col-span-6 bg-[#F0EFED] border border-[#141414] p-6 space-y-6 shadow-[4px_4px_0px_#141414]">
                        <div className="border-b border-[#141414]/10 pb-3 flex items-center gap-2">
                          <BookOpen className="w-5 h-5 text-zinc-700" />
                          <h3 className="font-bold uppercase tracking-wider">VCS Reference Glossary</h3>
                        </div>

                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Commit</span>
                            <p className="font-serif italic text-zinc-600">An immutable, cryptographically-hashed snapshot of your entire directory hierarchy at a precise point in time.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Branch</span>
                            <p className="font-serif italic text-zinc-600">A lightweight, highly mobile text file acting as a pointer to the tip commit of a develop timeline.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Merge</span>
                            <p className="font-serif italic text-zinc-600">The process of integrating changes from one developer timeline branch into another, automatically stitching files together.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Rebase</span>
                            <p className="font-serif italic text-zinc-600">The act of reapplying a series of commits on top of a new base commit to maintain a pristine, clean linear commit log.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Stash</span>
                            <p className="font-serif italic text-zinc-600">A temporary storage shelf where you can safely save uncommitted modifications, leaving your workspace completely clean.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Detached HEAD</span>
                            <p className="font-serif italic text-zinc-600">A temporary state occurring when your HEAD pointer is checked out to a specific commit SHA-1 hash rather than a branch pointer.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Reflog</span>
                            <p className="font-serif italic text-zinc-600">A comprehensive local log keeping tabs on every single shift of the HEAD pointer, making it easy to recover deleted branches.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Fast-Forward</span>
                            <p className="font-serif italic text-zinc-600">A linear merge scenario where the source branch has no competing commits, allowing Git to simply slide the pointer forward instantly.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3.5 space-y-1">
                            <span className="font-bold text-zinc-900 block uppercase text-[11px]">Three-Way Merge</span>
                            <p className="font-serif italic text-zinc-600">A merge strategy using the two branch tips and their common ancestor to compute a combined snapshot, flagging competing edits.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Challenge Selection Board */}
                  {activeSubTab === 'golf' && (
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                    {/* Left Panel: Active Challenge Details & Live Verification */}
                    <div className="xl:col-span-7 space-y-6">
                      <div className="bg-[#F0EFED] border border-[#141414] p-6 space-y-5 shadow-[4px_4px_0px_#141414] relative">
                        {/* Current Challenge Badge */}
                        <div className="absolute top-4 right-4 bg-emerald-600 text-[#E4E3E0] text-[9px] font-mono font-bold px-2.5 py-1 uppercase border border-[#141414] shadow-[1px_1px_0px_#141414]">
                          Challenge {currentChallengeIndex + 1} of {PLAYGROUND_CHALLENGES.length}
                        </div>

                        <div className="space-y-1.5 pr-24">
                          <span className="text-[10px] uppercase font-mono text-zinc-500 font-bold tracking-widest block">Active Challenge</span>
                          <h3 className="text-lg font-mono font-bold text-[#141414] leading-tight">
                            {PLAYGROUND_CHALLENGES[currentChallengeIndex].title}
                          </h3>
                        </div>

                        {/* Description */}
                        <div className="p-4 bg-white border border-[#141414] rounded-xs font-mono text-xs leading-relaxed text-zinc-800 space-y-3">
                          <p className="font-serif italic text-zinc-600">
                            "{PLAYGROUND_CHALLENGES[currentChallengeIndex].description}"
                          </p>
                          <div className="border-t border-[#141414]/10 pt-3">
                            <span className="block font-bold uppercase text-[10px] text-zinc-500 mb-1">Your Objective:</span>
                            <p className="font-bold text-[#141414] bg-emerald-50 border-l-4 border-emerald-600 p-2 text-[11px]">
                              {PLAYGROUND_CHALLENGES[currentChallengeIndex].instructions}
                            </p>
                          </div>
                        </div>

                        {/* LIVE VERIFICATION SECTION */}
                        <div className="pt-2">
                          {PLAYGROUND_CHALLENGES[currentChallengeIndex].check(status, history, branches, tags) ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="p-5 bg-gradient-to-r from-emerald-600 to-teal-700 border border-emerald-950 text-white rounded-xs space-y-4 shadow-[4px_4px_0px_#065f46]"
                            >
                              <div className="flex items-center gap-3">
                                <Award className="w-8 h-8 text-yellow-300 shrink-0 animate-bounce" />
                                <div>
                                  <h4 className="text-sm font-mono font-bold uppercase tracking-wider text-yellow-200">Challenge Completed!</h4>
                                  <p className="text-xs font-serif italic opacity-90">Outstanding execution. Your objective has been verified successfully.</p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/40 p-3.5 border border-emerald-800 text-xs font-mono rounded-sm">
                                <div>
                                  <span>Steps Taken: <span className="font-bold text-yellow-300 text-sm">{playgroundStepCount}</span></span>
                                  <span className="mx-2">•</span>
                                  <span>Personal Best: <span className="font-bold text-[#E4E3E0]">{bestScores[currentChallengeIndex] !== undefined ? `${bestScores[currentChallengeIndex]} steps` : 'None yet'}</span></span>
                                </div>
                                <div className="flex items-center gap-1">
                                  {playgroundStepCount <= 3 ? (
                                    <span className="bg-yellow-500 text-zinc-950 px-2 py-0.5 font-bold uppercase text-[10px]">🌟 Gold Medal</span>
                                  ) : playgroundStepCount <= 5 ? (
                                    <span className="bg-zinc-300 text-zinc-950 px-2 py-0.5 font-bold uppercase text-[10px]">🥈 Silver Medal</span>
                                  ) : (
                                    <span className="bg-amber-700 text-white px-2 py-0.5 font-bold uppercase text-[10px]">🥉 Bronze Medal</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex justify-end pt-1">
                                {currentChallengeIndex < PLAYGROUND_CHALLENGES.length - 1 ? (
                                  <button
                                    onClick={() => {
                                      // Save score
                                      const oldBest = bestScores[currentChallengeIndex];
                                      const newBest = oldBest === undefined ? playgroundStepCount : Math.min(oldBest, playgroundStepCount);
                                      const updatedScores = { ...bestScores, [currentChallengeIndex]: newBest };
                                      setBestScores(updatedScores);
                                      localStorage.setItem('gc_best_scores', JSON.stringify(updatedScores));

                                      // Advance
                                      setCurrentChallengeIndex(prev => prev + 1);
                                      handleResetPlayground();
                                    }}
                                    className="px-4 py-2 bg-yellow-400 text-zinc-950 hover:bg-yellow-300 text-xs font-mono font-bold uppercase border border-yellow-600 shadow-[2px_2px_0px_#141414] active:translate-y-px cursor-pointer"
                                  >
                                    Next Challenge →
                                  </button>
                                ) : (
                                  <div className="text-center w-full py-2 border-t border-emerald-800 mt-2">
                                    <p className="text-xs font-bold text-yellow-200">🎉 Congratulations! You have completed all 5 GitClone challenges!</p>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          ) : (
                            <div className="p-4 bg-amber-50 border border-amber-900 text-amber-950 rounded-xs flex items-center gap-3 font-mono text-xs">
                              <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-ping shrink-0"></span>
                              <div className="leading-relaxed">
                                <span className="font-bold">Awaiting verification:</span> Perform the steps above. GitClone is monitoring the sandbox file system, staging index, commit logs, and branch configurations in real-time.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Playground Commands Quick Guide */}
                      <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-3.5 shadow-[4px_4px_0px_#141414]">
                        <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-600">Quick Sandbox Actions Cheatsheet</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs font-mono">
                          <div className="border border-zinc-300 bg-white p-3 space-y-1.5">
                            <span className="font-bold block text-zinc-800">1. Modify Files</span>
                            <p className="text-[11px] text-zinc-600 leading-relaxed">Navigate to the <span className="underline font-bold cursor-pointer text-emerald-700" onClick={() => setActiveTab('dashboard')}>Files Workspace</span> to add or save sandbox files.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3 space-y-1.5">
                            <span className="font-bold block text-zinc-800">2. Stage & Commit</span>
                            <p className="text-[11px] text-zinc-600 leading-relaxed">Stage files and enter description message in the <span className="underline font-bold cursor-pointer text-emerald-700" onClick={() => setActiveTab('status')}>Status Panel</span>.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3 space-y-1.5">
                            <span className="font-bold block text-zinc-800">3. Manage Branches</span>
                            <p className="text-[11px] text-zinc-600 leading-relaxed">Create and switch pointers inside the <span className="underline font-bold cursor-pointer text-emerald-700" onClick={() => setActiveTab('branches')}>Branches Drawer</span>.</p>
                          </div>
                          <div className="border border-zinc-300 bg-white p-3 space-y-1.5">
                            <span className="font-bold block text-zinc-800">4. Interactive Graph</span>
                            <p className="text-[11px] text-zinc-600 leading-relaxed">View live layout nodes and branch pointers in the commit graphs above.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Panel: Map of Challenges */}
                    <div className="xl:col-span-5 space-y-4">
                      <div className="bg-[#F0EFED] border border-[#141414] p-5 space-y-4 shadow-[4px_4px_0px_#141414]">
                        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414] border-b border-zinc-300 pb-2">
                          Guided Curriculum Progress
                        </h3>

                        <div className="space-y-2.5">
                          {PLAYGROUND_CHALLENGES.map((challenge, idx) => {
                            const isCompleted = challenge.check(status, history, branches, tags);
                            const isActive = idx === currentChallengeIndex;
                            const bestScore = bestScores[idx];

                            return (
                              <div
                                key={idx}
                                onClick={() => {
                                  setCurrentChallengeIndex(idx);
                                  handleResetPlayground();
                                }}
                                className={`p-3 border text-xs font-mono transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                  isActive
                                    ? 'border-[#141414] bg-[#141414] text-[#E4E3E0] shadow-[2px_2px_0px_#888888]'
                                    : 'border-zinc-300 bg-white hover:bg-zinc-100 text-[#141414]'
                                }`}
                              >
                                <div className="space-y-1 min-w-0">
                                  <div className="flex items-center gap-1.5 font-bold">
                                    <span>{challenge.title}</span>
                                    {isCompleted && (
                                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                                    )}
                                  </div>
                                  <div className="text-[10px] opacity-75 truncate">
                                    {challenge.instructions}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  {bestScore !== undefined ? (
                                    <div className="text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
                                      Best: {bestScore}
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-zinc-400 font-bold">Unsolved</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              )}

            </div>
          </main>

        </div>
      )}

      {/* NEW FILE MODAL (DIALOG) */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-[#E4E3E0] border border-[#141414] shadow-[8px_8px_0px_#141414] overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-[#141414] flex items-center justify-between bg-[#141414] text-[#E4E3E0]">
              <div className="flex items-center gap-2">
                <FilePlus className="w-5 h-5 text-[#E4E3E0]" />
                <h3 className="text-sm font-bold uppercase tracking-wider font-mono">Create New Sandbox File</h3>
              </div>
              <button
                onClick={() => setShowNewFileModal(false)}
                className="text-zinc-400 hover:text-white text-xs font-bold font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewFile} className="p-6 space-y-4 font-mono">
              <div>
                <label className="block text-[10px] font-mono text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">Relative File Path (from sandbox/)</label>
                <input
                  type="text"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="e.g. docs/api.md or server.py"
                  className="w-full p-3 border border-[#141414] bg-[#F0EFED] text-xs text-[#141414] font-mono focus:outline-none focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono text-zinc-700 uppercase tracking-wider mb-1.5 font-bold">File Content</label>
                <textarea
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  placeholder="# Enter file text contents here..."
                  className="w-full p-3 border border-[#141414] bg-[#F0EFED] text-xs text-[#141414] font-mono focus:outline-none focus:bg-white leading-relaxed resize-none h-40"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFileModal(false)}
                  className="px-4 py-2 border border-[#141414] text-[#141414] hover:bg-[#D9D8D5] text-xs font-mono uppercase font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#141414] text-[#E4E3E0] border border-[#141414] text-xs font-mono uppercase font-bold transition shadow-[2px_2px_0px_#888888]"
                  id="modal-create-file-btn"
                >
                  Create File
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="mt-auto border-t border-[#141414] bg-[#D9D8D5] py-6 px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#141414] font-mono">
        <div>
          GitClone Engine v1.0.0 • Pure Python VCS File System Integration.
        </div>
        <div className="flex items-center gap-1">
          <span>Created on 2026-07-05</span>
        </div>
      </footer>

      {/* Interactive Mascot Companion */}
      <MascotCompanion
        status={status}
        files={files}
        activeTab={activeTab}
        currentLessonId={activeSubTab === 'lessons' && currentLessonIndex !== -1 ? LEARN_LESSONS[currentLessonIndex]?.id : undefined}
        currentLessonTitle={activeSubTab === 'lessons' && currentLessonIndex !== -1 ? LEARN_LESSONS[currentLessonIndex]?.title : undefined}
      />

    </div>
  );
}
