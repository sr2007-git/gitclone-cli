import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Commit, BranchInfo, TagInfo } from '../types';
import * as d3 from 'd3';
import { 
  GitCommit, 
  Clock, 
  User, 
  Calendar, 
  Layers, 
  ChevronRight, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  HelpCircle,
  GitBranch
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CommitGraphProps {
  commits: Commit[];
  branches: BranchInfo[];
  tags?: TagInfo[];
  currentCommitId: string | null;
  onCheckout: (target: string) => void;
  isLoading?: boolean;
}

export const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  branches,
  tags = [],
  currentCommitId,
  onCheckout,
  isLoading = false
}) => {
  const [selectedNode, setSelectedNode] = useState<Commit | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Commit | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Zoom and Pan state
  const [zoom, setZoom] = useState({ x: 0, y: 0, k: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Beautiful modern colors for branch lines/dots
  const branchColors = useMemo(() => [
    '#141414', // main/dark charcoal
    '#D32F2F', // retro red
    '#1976D2', // dark blue
    '#388E3C', // green
    '#F57C00', // orange
    '#7B1FA2', // purple
    '#00796B', // teal
    '#C2185B'  // hot pink
  ], []);

  // Sort commits oldest to newest so they flow downwards chronologically
  const sortedCommits = useMemo(() => {
    return [...commits].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [commits]);

  // Extract unique branches
  const branchList = useMemo(() => {
    const list = Array.from(new Set(
      commits
        .map(c => c.branch)
        .filter((b): b is string => b !== null)
    ));
    branches.forEach(b => {
      if (!list.includes(b.name)) {
        list.push(b.name);
      }
    });
    // Ensure 'main' is always first if it exists
    const mainIdx = list.indexOf('main');
    if (mainIdx > -1) {
      list.splice(mainIdx, 1);
      list.unshift('main');
    }
    return list;
  }, [commits, branches]);

  // Track map for branch indices
  const branchTrackMap = useMemo(() => {
    const map: { [branchName: string]: number } = {};
    branchList.forEach((name, idx) => {
      map[name] = idx;
    });
    return map;
  }, [branchList]);

  // Assign track columns and compute coordinates
  const { nodes, links, trackCount } = useMemo(() => {
    if (sortedCommits.length === 0) {
      return { nodes: [], links: [], trackCount: 1 };
    }

    const calculatedNodes: Array<Commit & { x: number; y: number; track: number; color: string }> = [];
    const idToNodeMap = new Map<string, typeof calculatedNodes[0]>();
    const commitTracks: { [commitId: string]: number } = {};

    // Determine the track index for each commit
    sortedCommits.forEach((commit) => {
      let track = 0;
      if (commit.branch && branchTrackMap[commit.branch] !== undefined) {
        track = branchTrackMap[commit.branch];
      } else if (commit.parent && commitTracks[commit.parent] !== undefined) {
        // Inherit parent's track
        track = commitTracks[commit.parent];
      } else {
        // Default to main track (0)
        track = 0;
      }
      commitTracks[commit.id] = track;

      // Calculate geometry
      const colWidth = 70;
      const rowHeight = 65;
      const x = 50 + track * colWidth;
      const y = 45 + calculatedNodes.length * rowHeight;
      const color = branchColors[track % branchColors.length];

      const node = {
        ...commit,
        x,
        y,
        track,
        color
      };

      calculatedNodes.push(node);
      idToNodeMap.set(commit.id, node);
    });

    // Create lineage links (parent-child connections)
    const calculatedLinks: Array<{
      id: string;
      source: { x: number; y: number };
      target: { x: number; y: number };
      color: string;
    }> = [];

    calculatedNodes.forEach((node) => {
      if (node.parent) {
        const parentNode = idToNodeMap.get(node.parent);
        if (parentNode) {
          calculatedLinks.push({
            id: `${parentNode.id}-${node.id}`,
            source: { x: parentNode.x, y: parentNode.y },
            target: { x: node.x, y: node.y },
            color: node.color // line gets color of child's track
          });
        }
      }
      if ((node as any).parent2) {
        const parent2Node = idToNodeMap.get((node as any).parent2);
        if (parent2Node) {
          calculatedLinks.push({
            id: `${parent2Node.id}-${node.id}-merge`,
            source: { x: parent2Node.x, y: parent2Node.y },
            target: { x: node.x, y: node.y },
            color: '#b91c1c' // distinctive red color for merge links
          });
        }
      }
    });

    return {
      nodes: calculatedNodes,
      links: calculatedLinks,
      trackCount: Math.max(1, branchList.length)
    };
  }, [sortedCommits, branchTrackMap, branchColors, branchList.length]);

  // Zoom Handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    let nextScale = zoom.k;
    if (e.deltaY < 0) {
      nextScale = Math.min(zoom.k * zoomFactor, 3);
    } else {
      nextScale = Math.max(zoom.k / zoomFactor, 0.4);
    }
    setZoom(prev => ({ ...prev, k: nextScale }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.interactive-node')) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - zoom.x, y: e.clientY - zoom.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setZoom(prev => ({
      ...prev,
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    }));
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  const handleZoomIn = () => {
    setZoom(prev => ({ ...prev, k: Math.min(prev.k * 1.2, 3) }));
  };

  const handleZoomOut = () => {
    setZoom(prev => ({ ...prev, k: Math.max(prev.k / 1.2, 0.4) }));
  };

  const handleReset = () => {
    setZoom({ x: 0, y: 0, k: 1 });
  };

  // Auto-center or fit graph in view when commits size changes
  useEffect(() => {
    handleReset();
  }, [commits.length]);

  // Generate cubic bezier curves for lineage connectors
  const getCurvePath = (source: { x: number; y: number }, target: { x: number; y: number }) => {
    const dy = target.y - source.y;
    return `M ${source.x} ${source.y} C ${source.x} ${source.y + dy * 0.45}, ${target.x} ${target.y - dy * 0.45}, ${target.x} ${target.y}`;
  };

  // Find branches pointing to a specific commit
  const getBranchesForCommit = (commitId: string) => {
    return branches.filter(b => b.latestCommitId === commitId);
  };

  // Find tags pointing to a specific commit
  const getTagsForCommit = (commitId: string) => {
    return tags.filter(t => t.commitId === commitId);
  };

  const svgWidth = Math.max(500, 100 + trackCount * 70);
  const svgHeight = Math.max(300, 80 + nodes.length * 65);

  return (
    <div className="bg-[#D9D8D5]/30 border border-[#141414] shadow-[4px_4px_0px_#141414] overflow-hidden flex flex-col md:flex-row gap-4 p-5 min-h-[420px]">
      
      {/* LEFT: Interactive SVG Stage */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3 border-b border-[#141414]/10 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-zinc-800 rounded-none inline-block"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#141414]">DAG Graph Topology</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleZoomIn}
              className="p-1.5 bg-[#F0EFED] hover:bg-[#D9D8D5] text-[#141414] border border-[#141414] text-[10px] uppercase font-mono font-bold flex items-center justify-center transition"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-1.5 bg-[#F0EFED] hover:bg-[#D9D8D5] text-[#141414] border border-[#141414] text-[10px] uppercase font-mono font-bold flex items-center justify-center transition"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleReset}
              className="p-1.5 bg-[#F0EFED] hover:bg-[#D9D8D5] text-[#141414] border border-[#141414] text-[10px] uppercase font-mono font-bold flex items-center justify-center transition"
              title="Reset Zoom & Pan"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="p-1.5 bg-[#F0EFED] hover:bg-[#D9D8D5] text-[#141414] border border-[#141414] text-[10px] uppercase font-mono font-bold flex items-center justify-center transition"
              title="Help"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {showHelp && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 p-3 bg-[#141414] text-[#E4E3E0] font-mono text-[10px] uppercase leading-relaxed border border-[#141414] shadow-[2px_2px_0px_#888888]"
          >
            🕹️ <span className="font-bold">Interactions:</span> Drag the canvas to pan. Use mouse wheel to zoom. 
            Click any commit node to view file snapshots, metadata, and checkout (time travel) instantly.
          </motion.div>
        )}

        {/* Canvas Area */}
        <div 
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="relative flex-1 min-h-[320px] bg-[#F0EFED] border border-[#141414] overflow-hidden cursor-grab active:cursor-grabbing select-none"
        >
          {commits.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 text-zinc-500 font-serif italic">
              <GitCommit className="w-10 h-10 mb-2 stroke-[1.5] text-zinc-400" />
              <p className="text-xs">No commits exist yet. Create a commit to populate the lineage graph.</p>
            </div>
          ) : (
            <svg
              width="100%"
              height="100%"
              className="absolute inset-0 pointer-events-none"
            >
              {/* Main transformed grouping for zoom & pan */}
              <g transform={`translate(${zoom.x}, ${zoom.y}) scale(${zoom.k})`} className="pointer-events-auto">
                
                {/* 1. Track Guidelines */}
                {branchList.map((branch, idx) => {
                  const xCoord = 50 + idx * 70;
                  return (
                    <motion.g 
                      key={branch} 
                      className="opacity-15"
                      animate={{ x: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                    >
                      <motion.line
                        animate={{ x1: xCoord, x2: xCoord }}
                        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                        y1={0}
                        y2={svgHeight}
                        stroke="#141414"
                        strokeWidth={1.5}
                        strokeDasharray="4,4"
                      />
                      <motion.text
                        animate={{ x: xCoord }}
                        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                        y={20}
                        textAnchor="middle"
                        className="font-mono text-[9px] fill-[#141414] font-bold"
                      >
                        T-{idx}
                      </motion.text>
                    </motion.g>
                  );
                })}

                {/* 2. Lineage Connector Lines */}
                <AnimatePresence>
                  {links.map((link) => (
                    <motion.path
                      key={link.id}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ 
                        pathLength: 1, 
                        opacity: 0.75,
                        d: getCurvePath(link.source, link.target)
                      }}
                      exit={{ opacity: 0, pathLength: 0 }}
                      transition={{ 
                        d: { type: 'spring', stiffness: 180, damping: 22 },
                        pathLength: { duration: 0.6, ease: "easeOut" },
                        opacity: { duration: 0.3 }
                      }}
                      fill="none"
                      stroke={link.color}
                      strokeWidth={2.5}
                    />
                  ))}
                </AnimatePresence>

                {/* 3. Interactive Commit Nodes */}
                <AnimatePresence>
                  {nodes.map((node) => {
                    const isCurrent = currentCommitId === node.id;
                    const isSelected = selectedNode?.id === node.id;
                    const isHovered = hoveredNode?.id === node.id;
                    const commitBranches = getBranchesForCommit(node.id);
                    const commitTags = getTagsForCommit(node.id);
                    const maxBranchLen = commitBranches.reduce((max, br) => Math.max(max, br.name.length), 0);
                    const tagsOffset = commitBranches.length > 0 ? 55 + maxBranchLen * 6 + 20 : 55;

                    return (
                      <motion.g
                        key={node.id}
                        initial={{ opacity: 0, scale: 0.5, x: node.x, y: node.y - 20 }}
                        animate={{ 
                          opacity: 1, 
                          scale: 1,
                          x: node.x,
                          y: node.y
                        }}
                        exit={{ opacity: 0, scale: 0.5, y: node.y + 20 }}
                        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
                        className="interactive-node cursor-pointer group"
                        onClick={() => setSelectedNode(node)}
                        onMouseEnter={() => setHoveredNode(node)}
                        onMouseLeave={() => setHoveredNode(null)}
                      >
                        {/* Hover / Select Aura */}
                        <motion.circle
                          r={isSelected ? 18 : isHovered ? 14 : 0}
                          animate={{ r: isSelected ? 18 : isHovered ? 14 : 0 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          className="fill-none stroke-[#141414] stroke-2 opacity-50 stroke-dasharray-[2,2]"
                        />

                        {/* Main Node Point */}
                        <motion.circle
                          r={isCurrent ? 9 : 6}
                          animate={{ 
                            r: isCurrent ? 9 : 6,
                            strokeWidth: isCurrent ? 2.5 : 1.5 
                          }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          fill={node.color}
                          stroke="#141414"
                          className="transition-all duration-150 group-hover:scale-125"
                        />

                        {/* Double Ring for current Head state */}
                        {isCurrent && (
                          <motion.circle
                            r={4}
                            initial={{ scale: 0 }}
                            animate={{ scale: [1, 1.25, 1] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                            fill="#E4E3E0"
                            stroke="#141414"
                            strokeWidth={1}
                          />
                        )}

                        {/* Commit ID Label next to Node */}
                        <text
                          x={16}
                          y={4}
                          className="font-mono text-[10px] font-bold fill-[#141414] bg-[#F0EFED] select-none"
                        >
                          {node.id.substring(0, 7)}
                        </text>

                        {/* Branch labels pointing directly to node */}
                        {commitBranches.length > 0 && (
                          <g transform={`translate(${55}, -2)`}>
                            {commitBranches.map((br, bIdx) => (
                              <g key={br.name} transform={`translate(0, ${bIdx * 15})`}>
                                {/* tag box */}
                                <rect
                                  x={0}
                                  y={-8}
                                  width={br.name.length * 6 + 12}
                                  height={13}
                                  fill="#141414"
                                  stroke="#141414"
                                  strokeWidth={1}
                                />
                                <text
                                  x={6}
                                  y={2}
                                  className="font-mono text-[8px] font-bold fill-[#E4E3E0]"
                                >
                                  {br.name}
                                </text>
                              </g>
                            ))}
                          </g>
                        )}

                        {/* Tag labels pointing directly to node */}
                        {commitTags.length > 0 && (
                          <g transform={`translate(${tagsOffset}, -2)`}>
                            {commitTags.map((tg, tIdx) => (
                              <g key={tg.name} transform={`translate(0, ${tIdx * 15})`}>
                                {/* tag box */}
                                <rect
                                  x={0}
                                  y={-8}
                                  width={tg.name.length * 6 + 18}
                                  height={13}
                                  fill="#D35400"
                                  stroke="#141414"
                                  strokeWidth={1}
                                />
                                <text
                                  x={4}
                                  y={2}
                                  className="font-mono text-[8px] font-bold fill-[#E4E3E0]"
                                >
                                  🏷️ {tg.name}
                                </text>
                              </g>
                            ))}
                          </g>
                        )}
                      </motion.g>
                    );
                  })}
                </AnimatePresence>
              </g>
            </svg>
          )}

          {/* Quick Hover Tooltip */}
          <AnimatePresence>
            {hoveredNode && !selectedNode && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-3 left-3 right-3 bg-[#141414] text-[#E4E3E0] border border-[#141414] p-3 shadow-[4px_4px_0px_#888888] font-mono text-[10px] uppercase pointer-events-none z-10 space-y-1"
              >
                <div className="flex items-center justify-between border-b border-[#E4E3E0]/20 pb-1">
                  <span className="font-bold">commit {hoveredNode.id.substring(0, 7)}</span>
                  <span>{hoveredNode.branch || 'detached HEAD'}</span>
                </div>
                <div className="text-[11px] font-bold text-amber-200 line-clamp-1">{hoveredNode.message}</div>
                <div className="flex justify-between text-[9px] opacity-80 pt-0.5">
                  <span>By: {hoveredNode.author.split(' <')[0]}</span>
                  <span>{new Date(hoveredNode.timestamp).toLocaleTimeString()}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* RIGHT: Selected Commit Detail Pane */}
      <div className="w-full md:w-80 flex flex-col justify-between border-t md:border-t-0 md:border-l border-[#141414] pt-4 md:pt-0 md:pl-5 space-y-4 font-mono">
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 border-b border-[#141414] pb-2">
            <Layers className="w-4 h-4 text-[#141414]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#141414]">Commit Inspector</h3>
          </div>

          {selectedNode ? (
            <div className="space-y-4">
              <div className="space-y-2 bg-[#F0EFED] border border-[#141414] p-3 shadow-[2px_2px_0px_#141414]">
                <div className="flex items-center justify-between text-[10px] text-zinc-600 font-bold border-b border-[#141414]/10 pb-1 mb-1">
                  <span>SHA-1 HASH</span>
                  <span className="bg-[#141414] text-[#E4E3E0] px-1 py-0.5 font-bold">{selectedNode.id.substring(0, 10)}...</span>
                </div>
                
                <div className="text-xs font-bold text-[#141414] leading-relaxed break-words">
                  "{selectedNode.message}"
                </div>

                {selectedNode.branch && (
                  <div className="flex items-center gap-1 mt-2 text-[10px] font-bold text-blue-900 bg-[#E3F2FD] border border-blue-900 px-1.5 py-0.5 w-max">
                    <GitBranch className="w-3 h-3" />
                    BRANCH: {selectedNode.branch}
                  </div>
                )}
              </div>

              {/* Attributes block */}
              <div className="space-y-2 text-[10px] text-zinc-800">
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="font-bold">Author:</span>
                  <span className="truncate max-w-[200px]" title={selectedNode.author}>{selectedNode.author}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="font-bold">Timestamp:</span>
                  <span>{new Date(selectedNode.timestamp).toLocaleString()}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-600 mt-0.5" />
                  <div>
                    <span className="font-bold">Parent Node:</span>
                    <div className="font-mono font-bold text-[#141414]">
                      {selectedNode.parent ? (
                        <span className="bg-[#D9D8D5] px-1 border border-[#141414]/20">{selectedNode.parent.substring(0, 7)}</span>
                      ) : (
                        <span className="italic text-zinc-500">None (Initial Root)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Snapshot Files count */}
              <div className="border border-dashed border-zinc-400 p-2.5 bg-zinc-50 space-y-1">
                <div className="text-[10px] font-bold text-zinc-700 uppercase">Tree Snapshot Files:</div>
                <div className="text-[11px] font-bold text-zinc-900 flex items-center gap-1.5">
                  <ChevronRight className="w-4 h-4 shrink-0" />
                  <span>{Object.keys(selectedNode.snapshot).length} tracked objects in index</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-zinc-500 text-xs font-serif italic border border-dashed border-[#141414] bg-[#D9D8D5]/20 flex flex-col items-center justify-center p-4">
              <GitCommit className="w-8 h-8 mb-2 text-zinc-400" />
              <p>Select any node on the line tree map to inspect its database snapshots & checkout.</p>
            </div>
          )}
        </div>

        {/* Checkout Button action */}
        {selectedNode && (
          <div className="pt-4 border-t border-[#141414]">
            <button
              onClick={() => {
                if (confirm(`Do you want to checkout and check out commit ${selectedNode.id.substring(0, 7)}? This will override unstaged changes if Force Checkout is toggled.`)) {
                  onCheckout(selectedNode.id);
                }
              }}
              disabled={isLoading}
              className="w-full py-2.5 bg-[#141414] hover:bg-zinc-800 text-[#E4E3E0] disabled:opacity-50 text-xs font-bold uppercase border border-[#141414] shadow-[4px_4px_0px_#888888] flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {isLoading ? (
                <span className="w-3.5 h-3.5 border-2 border-t-transparent border-[#E4E3E0] rounded-full animate-spin"></span>
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Time Travel to Commit
            </button>
            <div className="mt-2 text-[9px] text-zinc-500 text-center leading-normal">
              Warning: Checking out a specific commit puts you in a "Detached HEAD" state.
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
