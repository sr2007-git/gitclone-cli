import React, { useState, useEffect, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  FileCode,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  Check,
  X,
  Search,
  RefreshCw
} from 'lucide-react';
import { SandboxFile, FileStatus } from '../types';

interface FileTreeProps {
  files: SandboxFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onCreateFile: (path: string, content: string) => Promise<void>;
  fileStatuses: FileStatus[];
  onRefresh: () => void;
  isLoading?: boolean;
}

interface FileTreeNode {
  name: string;
  path: string; // complete relative path from sandbox root
  isDirectory: boolean;
  children: FileTreeNode[];
  file?: SandboxFile;
}

export function FileTree({
  files,
  selectedFile,
  onSelectFile,
  onDeleteFile,
  onCreateFile,
  fileStatuses,
  onRefresh,
  isLoading = false
}: FileTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({
    '': true // Root folder is always expanded
  });
  
  // State for creating new file/folder in tree
  // parentPath is empty string for root, or folder path like "src"
  const [activeInput, setActiveInput] = useState<{
    type: 'file' | 'folder';
    parentPath: string;
  } | null>(null);
  const [inputName, setInputName] = useState('');
  
  // Search query
  const [searchQuery, setSearchQuery] = useState('');

  // Expand parent folders of selected file on mount or when selectedFile changes
  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split('/');
      const pathsToExpand: string[] = [];
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        pathsToExpand.push(current);
      }
      if (pathsToExpand.length > 0) {
        setExpandedPaths(prev => {
          const next = { ...prev };
          pathsToExpand.forEach(p => {
            next[p] = true;
          });
          return next;
        });
      }
    }
  }, [selectedFile]);

  // Create a map of file path -> Git status for easy lookup
  const statusMap = useMemo(() => {
    const map: Record<string, FileStatus['status']> = {};
    fileStatuses.forEach(f => {
      map[f.path] = f.status;
    });
    return map;
  }, [fileStatuses]);

  // Construct hierarchical file tree from flat SandboxFile list
  const fileTree = useMemo(() => {
    const root: FileTreeNode = {
      name: 'sandbox',
      path: '',
      isDirectory: true,
      children: []
    };

    files.forEach(file => {
      const parts = file.relativePath.split('/');
      let current = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        let child = current.children.find(c => c.name === part && c.isDirectory === !isLast);
        if (!child) {
          child = {
            name: part,
            path: currentPath,
            isDirectory: !isLast,
            children: []
          };
          if (isLast) {
            child.file = file;
          }
          current.children.push(child);
        }
        current = child;
      }
    });

    // Helper to sort tree: directories first, then files, both alphabetically
    const sortTree = (node: FileTreeNode) => {
      node.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(child => {
        if (child.isDirectory) {
          sortTree(child);
        }
      });
    };
    sortTree(root);

    return root;
  }, [files]);

  // Toggle directory expand state
  const toggleExpand = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedPaths(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  // Initiate inline input for creating a new file or folder
  const initiateCreation = (type: 'file' | 'folder', parentPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Expand the parent folder so the input is visible
    if (parentPath) {
      setExpandedPaths(prev => ({ ...prev, [parentPath]: true }));
    }
    setActiveInput({ type, parentPath });
    setInputName('');
  };

  const cancelCreation = () => {
    setActiveInput(null);
    setInputName('');
  };

  const handleCreateSubmit = async () => {
    if (!inputName.trim()) {
      cancelCreation();
      return;
    }

    const cleanName = inputName.trim();
    // Path resolution
    const fullPath = activeInput?.parentPath
      ? `${activeInput.parentPath}/${cleanName}`
      : cleanName;

    try {
      if (activeInput?.type === 'file') {
        await onCreateFile(fullPath, '// New code file\n');
      } else {
        // Git doesn't track empty folders, so we create a standard placeholder '.gitkeep' file
        await onCreateFile(`${fullPath}/.gitkeep`, '# Keep empty folder structure\n');
        // Auto-expand the newly created folder
        setExpandedPaths(prev => ({ ...prev, [fullPath]: true }));
      }
    } catch (err) {
      console.error('Failed to create item in file tree', err);
    } finally {
      cancelCreation();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateSubmit();
    } else if (e.key === 'Escape') {
      cancelCreation();
    }
  };

  // Delete folder recursive
  const handleDeleteFolder = async (folderPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete folder "${folderPath}" and all of its contents? This action cannot be undone.`)) {
      return;
    }
    
    // Find all files that reside within this folder path
    const prefix = `${folderPath}/`;
    const targets = files.filter(f => f.relativePath === folderPath || f.relativePath.startsWith(prefix));
    
    for (const file of targets) {
      await onDeleteFile(file.relativePath);
    }
  };

  // Determine Git status colors and text badges
  const getGitStatusColor = (path: string) => {
    const status = statusMap[path];
    switch (status) {
      case 'untracked':
        return 'text-zinc-500 hover:text-zinc-600';
      case 'staged_new':
      case 'modified_staged':
        return 'text-emerald-700 font-bold';
      case 'modified_unstaged':
        return 'text-amber-700 font-bold';
      case 'conflict':
        return 'text-rose-700 font-bold animate-pulse';
      case 'deleted_unstaged':
      case 'staged_deleted':
        return 'text-rose-950/60 line-through';
      default:
        return 'text-[#141414]';
    }
  };

  const getGitStatusDot = (path: string) => {
    const status = statusMap[path];
    switch (status) {
      case 'untracked':
        return <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" title="Untracked" />;
      case 'staged_new':
        return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Staged (New)" />;
      case 'modified_staged':
        return <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" title="Staged (Modified)" />;
      case 'modified_unstaged':
        return <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Unstaged Modification" />;
      case 'conflict':
        return <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" title="Merge Conflict!" />;
      default:
        return null;
    }
  };

  // Recursive Tree Node Renderer
  const renderNode = (node: FileTreeNode, depth: number): React.ReactNode => {
    const isRoot = node.path === '';
    const isExpanded = expandedPaths[node.path];
    const isSelected = selectedFile === node.path;
    const hasSearchQuery = searchQuery.trim().length > 0;
    
    // Simple path-matching filter for search
    const matchesSearch = !isRoot && node.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Check if any child matches search query so we know whether to display/expand this node
    const hasMatchingChildren = (currNode: FileTreeNode): boolean => {
      if (currNode.name.toLowerCase().includes(searchQuery.toLowerCase()) && currNode.path !== '') return true;
      return currNode.children.some(child => hasMatchingChildren(child));
    };

    const shouldShow = !hasSearchQuery || isRoot || matchesSearch || hasMatchingChildren(node);

    if (!shouldShow) return null;

    // Expand directories automatically if search query is active
    const isNodeExpanded = hasSearchQuery ? true : isExpanded;

    return (
      <div key={node.path || 'root'} className="w-full">
        {/* Render actual node bar (unless it's the invisible root) */}
        {!isRoot && (
          <div
            onClick={() => node.isDirectory ? toggleExpand(node.path) : onSelectFile(node.path)}
            className={`group flex items-center justify-between text-xs font-mono py-1.5 px-2 cursor-pointer border border-transparent hover:bg-[#D9D8D5]/50 transition ${
              isSelected
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] font-bold hover:bg-[#141414]/90'
                : 'text-[#141414]'
            }`}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
          >
            {/* Left aligned side: Icon + Name */}
            <div className="flex items-center gap-1.5 min-w-0">
              {node.isDirectory ? (
                <>
                  <button
                    onClick={(e) => toggleExpand(node.path, e)}
                    className="p-0.5 hover:bg-zinc-300/50 rounded text-zinc-500 focus:outline-none"
                  >
                    {isNodeExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {isNodeExpanded ? (
                    <FolderOpen className="w-4 h-4 text-amber-700 shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span className="truncate font-semibold">{node.name}</span>
                </>
              ) : (
                <>
                  <span className="w-4.5" /> {/* spacing to align with folder rows */}
                  <FileCode className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#E4E3E0]' : 'text-zinc-600'}`} />
                  <span className={`truncate ${isSelected ? 'text-[#E4E3E0]' : getGitStatusColor(node.path)}`}>
                    {node.name}
                  </span>
                </>
              )}
            </div>

            {/* Right aligned side: Git indicator + Action triggers */}
            <div className="flex items-center gap-2 shrink-0 pl-2">
              {!node.isDirectory && !isSelected && getGitStatusDot(node.path)}
              
              {/* Actions, visible on hover */}
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                {node.isDirectory ? (
                  <>
                    <button
                      onClick={(e) => initiateCreation('file', node.path, e)}
                      className="p-1 rounded text-zinc-600 hover:text-black hover:bg-zinc-300/50"
                      title="New File in Folder"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => initiateCreation('folder', node.path, e)}
                      className="p-1 rounded text-zinc-600 hover:text-black hover:bg-zinc-300/50"
                      title="New Folder in Folder"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteFolder(node.path, e)}
                      className="p-1 rounded text-rose-700 hover:bg-rose-100"
                      title="Delete Folder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFile(node.path);
                    }}
                    className={`p-1 rounded ${
                      isSelected
                        ? 'text-rose-300 hover:bg-zinc-800'
                        : 'text-zinc-500 hover:text-rose-700 hover:bg-zinc-200'
                    }`}
                    title="Delete File"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Render inline creation input field if active for this directory node */}
        {activeInput && activeInput.parentPath === node.path && (
          <div
            className="flex items-center gap-1.5 py-1 px-2 bg-[#D9D8D5]/25 border-y border-[#141414]/10"
            style={{ paddingLeft: `${(depth + (isRoot ? 0 : 1)) * 12 + 24}px` }}
          >
            {activeInput.type === 'file' ? (
              <FileCode className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            )}
            <input
              type="text"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-white border border-[#141414] text-xs font-mono px-1 py-0.5 focus:outline-none"
              placeholder={activeInput.type === 'file' ? 'filename.js' : 'folder_name'}
              autoFocus
            />
            <button
              onClick={handleCreateSubmit}
              className="p-0.5 bg-[#141414] text-white border border-[#141414]"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              onClick={cancelCreation}
              className="p-0.5 bg-white border border-zinc-400 text-zinc-600 hover:text-black"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Render child nodes if directory is expanded (or search is active) */}
        {node.isDirectory && (isRoot || isNodeExpanded) && node.children.length > 0 && (
          <div className="w-full">
            {node.children.map(child => renderNode(child, isRoot ? depth : depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full border border-[#141414] bg-[#D9D8D5]/30 shadow-[4px_4px_0px_#141414]">
      {/* Title & Top Control bar */}
      <div className="flex items-center justify-between p-3 border-b border-[#141414] bg-[#F0EFED]">
        <h3 className="text-[11px] font-serif italic uppercase text-[#141414] tracking-widest font-bold">
          Workspace Files
        </h3>
        
        {/* Creation Buttons at Tree Root */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => initiateCreation('file', '', e)}
            className="p-1 hover:bg-zinc-300 rounded text-zinc-800 transition"
            title="Create File at Sandbox Root"
          >
            <FilePlus className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => initiateCreation('folder', '', e)}
            className="p-1 hover:bg-zinc-300 rounded text-zinc-800 transition"
            title="Create Folder at Sandbox Root"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={`p-1 hover:bg-zinc-300 rounded text-zinc-800 transition ${isLoading ? 'animate-spin' : ''}`}
            title="Refresh Files"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter/Search bar */}
      <div className="p-2 border-b border-[#141414]/15 bg-[#F0EFED]/40 flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter workspace files..."
          className="w-full bg-transparent text-xs font-mono focus:outline-none placeholder-zinc-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-zinc-500 hover:text-black font-mono text-[10px]"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tree Content Area */}
      <div className="flex-1 overflow-y-auto max-h-[420px] p-2 space-y-1 select-none">
        {files.length === 0 && !activeInput ? (
          <div className="text-center py-12 text-zinc-500 font-serif italic text-xs">
            No files in sandbox. Click + icon to add a file.
          </div>
        ) : (
          renderNode(fileTree, 0)
        )}
      </div>

      {/* Footer Hint */}
      <div className="p-2 border-t border-[#141414]/10 bg-[#F0EFED]/30 text-[9px] font-mono text-zinc-500 uppercase tracking-tight flex items-center justify-between">
        <span>Files: {files.length}</span>
        <span>Folder-Aware Tree</span>
      </div>
    </div>
  );
}
