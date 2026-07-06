import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitCommit, Clock, User, HardDrive, ArrowRight, X } from 'lucide-react';

interface Node3D {
  id: string;
  baseX: number;
  baseY: number;
  baseZ: number;
  branch: 'main' | 'feature' | 'hotfix' | 'active';
  isSpecial: boolean;
  size: number;
  label?: string;
  pulsePhase: number;
  pulseSpeed: number;
  activationCharge: number; // Neural signal transfer value (decays over time)
  // Explorable Metadata
  sha: string;
  author: string;
  date: string;
  msg: string;
}

interface Edge3D {
  from: string;
  to: string;
  isActivePath?: boolean;
}

interface CosmicPacket3D {
  fromId: string;
  toId: string;
  progress: number;
  speed: number;
  intensity: number;
}

interface Star3D {
  baseX: number;
  baseY: number;
  baseZ: number;
  size: number;
  brightness: number;
  phase: number;
}

export const VCSBackdrop: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Selected Inspect States
  const [selectedNode, setSelectedNode] = useState<Node3D | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Discoverability hint state
  const [showHint, setShowHint] = useState(true);

  // Interaction vectors
  const mouseRef = useRef({ x: 0, y: 0 });
  const dragAngleYRef = useRef(0);
  const dragAngleXRef = useRef(0);
  const currentAngleYRef = useRef(-0.2);
  const currentAngleXRef = useRef(0.04);

  // Camera depth offset (explorable via scroll)
  const depthZoomRef = useRef(1.0);
  const targetDepthZoomRef = useRef(1.0);

  // Physics rotation velocities (Momentum & Inertia)
  const velocityYRef = useRef(0);
  const velocityXRef = useRef(0);

  // Dynamic Camera tracking center (focus selected node)
  const cameraCenterXRef = useRef(0);
  const cameraCenterYRef = useRef(0);
  const targetCameraCenterXRef = useRef(0);
  const targetCameraCenterYRef = useRef(0);

  // Time and interactive long-press refs
  const timeRef = useRef(0);
  const lastHeroActionTime = useRef(Date.now());
  const pointerDownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerDownNodeRef = useRef<Node3D | null>(null);

  // Custom hero commit events
  const heroCommitRef = useRef<{
    active: boolean;
    sourceNodeId: string;
    targetNodeId: string;
    progress: number; // 0 to 1
    phase: 'propagating' | 'landing' | 'merging' | 'done';
    tempNodes: Node3D[];
    tempEdges: Edge3D[];
    rippleRadius: number;
  }>({
    active: false,
    sourceNodeId: '',
    targetNodeId: '',
    progress: 0,
    phase: 'done',
    tempNodes: [],
    tempEdges: [],
    rippleRadius: 0
  });

  useEffect(() => {
    // Detect reduced motion preferences
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleMotionChange);
    return () => {
      mediaQuery.removeEventListener('change', handleMotionChange);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    canvas.width = width;
    canvas.height = height;

    // Fluid resize handling
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = Math.floor(entry.contentRect.width);
        height = Math.floor(entry.contentRect.height);
        canvas.width = width;
        canvas.height = height;
      }
    });
    resizeObserver.observe(container);

    // Responsive Performance Tuning: Determine Quality Tier
    const isMobile = width < 640;
    const isTablet = width >= 640 && width < 1024;
    
    // Core parameters based on detected capabilities
    const starCount = isMobile ? 30 : isTablet ? 65 : 120;
    const mainCount = isMobile ? 6 : isTablet ? 8 : 10;
    const featureCount = isMobile ? 1 : isTablet ? 2 : 3;
    const hotfixCount = isMobile ? 0 : isTablet ? 1 : 2;
    const maxActivePackets = isMobile ? 3 : isTablet ? 5 : 8;

    // Node layout spacing & positioning math
    const spacing = isMobile ? 42 : isTablet ? 58 : 72;
    const startX = -((mainCount - 1) * spacing) / 2;

    // 1. Seed Procedural Base 3D Commit Graph
    const nodes: Node3D[] = [];
    const edges: Edge3D[] = [];

    // Main Branch Lineage
    const mainMessages = [
      'Initial commit - set up repository framework',
      'Implement content-addressable storage engine',
      'Add custom index staging files system',
      'Refactor tree serialization with hashing algorithms',
      'Configure three-way diff merge engine',
      'Optimize node traversal graph structures',
      'Patch memory leaks on index re-renders',
      'Prepare repository release for stable HEAD build',
      'Incorporate virtual tag system pointer state',
      'Perform security verification on database objects'
    ];

    const mainAuthors = ['Sanket Jadhav', 'Developer Admin', 'Sanket Jadhav', 'Developer Admin', 'Sanket Jadhav', 'Sanket Jadhav', 'Developer Admin', 'Sanket Jadhav', 'Developer Admin', 'Sanket Jadhav'];
    const mainDates = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-05', '2026-07-05', '2026-07-05', '2026-07-05', '2026-07-05'];
    const mainSHAs = ['3f8a9c2', '8d2f11a', 'fc3b991', '2a5e8c1', 'ef91136', '4b2a8d3', 'e7f12a4', 'a9d2c11', 'b5c4f2e', 'd7a8e9f'];

    for (let i = 0; i < mainCount; i++) {
      const isTip = i === mainCount - 1;
      const isMerge = i === 5 || i === 7;
      nodes.push({
        id: `main-${i}`,
        baseX: startX + i * spacing,
        baseY: Math.sin(i * 1.5) * 10,
        baseZ: Math.cos(i * 1.2) * 15,
        branch: 'main',
        isSpecial: i === 0 || isTip || isMerge,
        size: i === 0 || isTip || isMerge ? 6.5 : 4.5,
        pulsePhase: Math.random() * Math.PI,
        pulseSpeed: 0.02 + Math.random() * 0.02,
        activationCharge: 0,
        label: i === 0 ? 'INIT' : isTip ? 'HEAD' : undefined,
        sha: mainSHAs[i] || `sha-${i}`,
        author: mainAuthors[i] || 'Developer Admin',
        date: mainDates[i] || '2026-07-05',
        msg: mainMessages[i] || `Main branch revision update`
      });

      if (i > 0) {
        edges.push({ from: `main-${i - 1}`, to: `main-${i}` });
      }
    }

    // Feature Branch (spawns from main-2)
    if (mainCount > 2) {
      const parentX = startX + 2 * spacing;
      const featMessages = [
        'feat: introduce PDF export pipeline with custom stylesheets',
        'feat: add visual commit lineage timeline view',
        'feat: integrate conflict resolution manual merge modal'
      ];
      const featSHAs = ['4c11b89', '9d8a112', 'bd7e12c'];

      for (let i = 0; i < featureCount; i++) {
        nodes.push({
          id: `feat-${i}`,
          baseX: parentX + (i + 1) * (spacing * 0.8),
          baseY: -60 + Math.sin(i * 0.9) * 8,
          baseZ: 25 + i * 10,
          branch: 'feature',
          isSpecial: i === featureCount - 1,
          size: 4.0,
          pulsePhase: Math.random() * Math.PI,
          pulseSpeed: 0.03,
          activationCharge: 0,
          sha: featSHAs[i] || `sha-feat-${i}`,
          author: 'Collaborator Node',
          date: '2026-07-04',
          msg: featMessages[i] || `Feature branch task release`
        });

        if (i === 0) {
          edges.push({ from: 'main-2', to: 'feat-0' });
        } else {
          edges.push({ from: `feat-${i - 1}`, to: `feat-${i}` });
        }
      }
      const mergeTargetId = isMobile ? 'main-4' : 'main-5';
      edges.push({ from: `feat-${featureCount - 1}`, to: mergeTargetId });
    }

    // Hotfix Branch (spawns from main-4)
    if (!isMobile && mainCount > 4 && hotfixCount > 0) {
      const parentX = startX + 4 * spacing;
      const hotfixMessages = [
        'fix: resolve detached HEAD checkouts pointer state',
        'fix: patch memory leak on rapid repository index loads'
      ];
      const hotfixSHAs = ['dd33fa9', '12ccf89'];

      for (let i = 0; i < hotfixCount; i++) {
        nodes.push({
          id: `hotfix-${i}`,
          baseX: parentX + (i + 1) * (spacing * 0.75),
          baseY: 48 + Math.cos(i * 1.2) * 8,
          baseZ: -25 - i * 10,
          branch: 'hotfix',
          isSpecial: false,
          size: 4.0,
          pulsePhase: Math.random() * Math.PI,
          pulseSpeed: 0.04,
          activationCharge: 0,
          sha: hotfixSHAs[i] || `sha-fix-${i}`,
          author: 'Sanket Jadhav',
          date: '2026-07-05',
          msg: hotfixMessages[i] || `Hotfix patch implementation`
        });

        if (i === 0) {
          edges.push({ from: 'main-4', to: 'hotfix-0' });
        } else {
          edges.push({ from: `hotfix-${i - 1}`, to: `hotfix-${i}` });
        }
      }
      const mergeTargetId = isTablet ? 'main-6' : 'main-7';
      edges.push({ from: `hotfix-${hotfixCount - 1}`, to: mergeTargetId });
    }

    // 2. Seed background cosmic starfield
    const stars: Star3D[] = [];
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const dist = 320 + Math.random() * 180;

      stars.push({
        baseX: dist * Math.sin(phi) * Math.cos(theta),
        baseY: dist * Math.sin(phi) * Math.sin(theta),
        baseZ: -120 - Math.random() * 150,
        size: 0.6 + Math.random() * 1.2,
        brightness: 0.2 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2
      });
    }

    // 3. Active flowing neural signal packets
    const packets: CosmicPacket3D[] = [];
    const spawnPacketOnRandomEdge = () => {
      if (edges.length === 0 || packets.length >= maxActivePackets) return;
      const edge = edges[Math.floor(Math.random() * edges.length)];
      packets.push({
        fromId: edge.from,
        toId: edge.to,
        progress: 0,
        speed: 0.003 + Math.random() * 0.006,
        intensity: 0.4 + Math.random() * 0.6
      });
    };

    // Pre-populate packets
    for (let i = 0; i < maxActivePackets; i++) {
      spawnPacketOnRandomEdge();
      if (packets[i]) {
        packets[i].progress = Math.random();
      }
    }

    // Click/Hover Detection Math
    const getPointerCoordsOnCanvas = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return { x, y };
    };

    const findNodeAtPointer = (clientX: number, clientY: number) => {
      const { x, y } = getPointerCoordsOnCanvas(clientX, clientY);
      
      // We look for projected nodes within a responsive radial threshold
      let found: Node3D | null = null;
      let closestDist = 20; // 20px radius threshold

      const allNodes = [...nodes, ...heroCommitRef.current.tempNodes];
      allNodes.forEach((node) => {
        // Retrieve current projected coordinates
        const proj = latestProjections.current[node.id];
        if (proj) {
          const dx = x - proj.x;
          const dy = y - proj.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < closestDist) {
            closestDist = d;
            found = node;
          }
        }
      });
      return found;
    };

    // Keep dynamic projections in ref for mouse interaction checks
    const latestProjections = { current: {} as { [id: string]: { x: number; y: number; scale: number } } };

    // Scroll Depth explore handler
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (reducedMotion) return;
      
      // Calculate micro incremental adjustments to depth zoom
      const delta = -e.deltaY * 0.0012;
      targetDepthZoomRef.current = Math.max(0.65, Math.min(1.85, targetDepthZoomRef.current + delta));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });

    // Pointer event logic (drag rotate system, Click and Hold)
    let isPointerDown = false;
    let startXPointer = 0;
    let startYPointer = 0;
    let startAngleY = 0;
    let startAngleX = 0;
    let dragDistanceMoved = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (reducedMotion) return;
      isPointerDown = true;
      startXPointer = e.clientX;
      startYPointer = e.clientY;
      startAngleY = dragAngleYRef.current;
      startAngleX = dragAngleXRef.current;
      dragDistanceMoved = 0;

      // Stop current spin momentum
      velocityYRef.current = 0;
      velocityXRef.current = 0;

      const tappedNode = findNodeAtPointer(e.clientX, e.clientY);
      if (tappedNode) {
        pointerDownNodeRef.current = tappedNode;
        // Start long-press timers
        pointerDownTimerRef.current = setTimeout(() => {
          // Trigger the 0.5s hold ripple explosion
          triggerLongPressRipple(tappedNode);
        }, 500);
      }
      
      if (container.parentElement) {
        try {
          container.parentElement.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
    };

    const triggerLongPressRipple = (node: Node3D) => {
      // Light up the held node fully
      node.activationCharge = 1.0;
      
      // Trigger multiple fast signal packets running out
      const neighboringEdges = edges.filter(e => e.from === node.id || e.to === node.id);
      neighboringEdges.forEach((edge) => {
        packets.push({
          fromId: node.id,
          toId: edge.to === node.id ? edge.from : edge.to,
          progress: 0,
          speed: 0.025, // very fast pulse
          intensity: 1.0
        });
      });

      // Show interactive haptic ripple on the clicked coordinate
      const proj = latestProjections.current[node.id];
      if (proj) {
        // Trigger a temporary structural wave effect in background
        lastHeroActionTime.current = Date.now() - 10000; // speed up subsequent hero action
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (reducedMotion) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      mouseRef.current = { x: mouseX, y: mouseY };

      // Manage Hover highlights
      const currentlyHovered = findNodeAtPointer(e.clientX, e.clientY);
      if (currentlyHovered) {
        setHoveredNodeId(currentlyHovered.id);
        setShowHint(false); // Hide the discoverability hint on interaction
      } else {
        setHoveredNodeId(null);
      }

      if (isPointerDown) {
        const deltaX = e.clientX - startXPointer;
        const deltaY = e.clientY - startYPointer;
        dragDistanceMoved += Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (dragDistanceMoved > 5) {
          // Cancel active long-press timer if pointer moves too much
          if (pointerDownTimerRef.current) {
            clearTimeout(pointerDownTimerRef.current);
            pointerDownTimerRef.current = null;
          }
        }

        // Apply interactive physical rotation coordinates
        dragAngleYRef.current = startAngleY + deltaX * 0.007;
        dragAngleXRef.current = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, startAngleX + deltaY * 0.007));

        // Record immediate velocities for spin momentum and friction inertia
        velocityYRef.current = deltaX * 0.0007;
        velocityXRef.current = deltaY * 0.0007;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      isPointerDown = false;
      
      // Cancel active long press timers
      if (pointerDownTimerRef.current) {
        clearTimeout(pointerDownTimerRef.current);
        pointerDownTimerRef.current = null;
      }

      // If drag threshold was low, interpret this pointer action as a solid "Click / Tap" to Inspect
      if (dragDistanceMoved < 8 && pointerDownNodeRef.current) {
        const selected = pointerDownNodeRef.current;
        setSelectedNode(selected);
        setShowHint(false);

        // Position camera focus coordinates smoothly on the inspected node
        const currentSizeScale = isMobile ? 0.6 : isTablet ? 0.8 : 1.0;
        targetCameraCenterXRef.current = -selected.baseX * currentSizeScale;
        targetCameraCenterYRef.current = -selected.baseY * currentSizeScale;
        targetDepthZoomRef.current = 1.35; // zoom in on clicked item
      } else if (dragDistanceMoved < 8) {
        // Tapped empty black space: return camera view safely back to resting center coordinates
        setSelectedNode(null);
        targetCameraCenterXRef.current = 0;
        targetCameraCenterYRef.current = 0;
        targetDepthZoomRef.current = 1.0;
      }

      pointerDownNodeRef.current = null;

      if (container.parentElement) {
        try {
          container.parentElement.releasePointerCapture(e.pointerId);
        } catch (err) {}
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerUp);

    let animationId = 0;
    let autoY = 0;
    let autoX = 0;

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);
      timeRef.current += 0.01;

      // Inertial physical friction calculations for rotation drag momentum
      if (!isPointerDown && !reducedMotion) {
        dragAngleYRef.current += velocityYRef.current;
        dragAngleXRef.current += velocityXRef.current;

        // Apply continuous decay friction bounds
        velocityYRef.current *= 0.94;
        velocityXRef.current *= 0.94;
      }

      // Handle Camera Rotation & Drifts
      if (!reducedMotion) {
        // Infinite ambient drift
        autoY += 0.0004;
        autoX = Math.sin(autoY * 0.7) * 0.03;

        const targetAngleY = autoY + mouseRef.current.x * 0.00025 + dragAngleYRef.current;
        const targetAngleX = autoX + mouseRef.current.y * 0.00025 + dragAngleXRef.current;

        currentAngleYRef.current += (targetAngleY - currentAngleYRef.current) * 0.05;
        currentAngleXRef.current += (targetAngleX - currentAngleXRef.current) * 0.05;

        // Interpolate Depth exploration zooms smoothly
        depthZoomRef.current += (targetDepthZoomRef.current - depthZoomRef.current) * 0.08;

        // Interpolate Camera centers
        cameraCenterXRef.current += (targetCameraCenterXRef.current - cameraCenterXRef.current) * 0.08;
        cameraCenterYRef.current += (targetCameraCenterYRef.current - cameraCenterYRef.current) * 0.08;
      } else {
        currentAngleYRef.current = -0.15;
        currentAngleXRef.current = 0.03;
        depthZoomRef.current = 1.0;
        cameraCenterXRef.current = 0;
        cameraCenterYRef.current = 0;
      }

      const cosY = Math.cos(currentAngleYRef.current);
      const sinY = Math.sin(currentAngleYRef.current);
      const cosX = Math.cos(currentAngleXRef.current);
      const sinX = Math.sin(currentAngleXRef.current);

      const fov = 450; 
      const sizeScale = (isMobile ? 0.6 : isTablet ? 0.8 : 1.0) * depthZoomRef.current;

      // 3D Projection coordinate mapping
      const projMap: {
        [id: string]: {
          x: number;
          y: number;
          z: number;
          scale: number;
          node: Node3D;
        };
      } = {};

      const allNodes = [...nodes, ...heroCommitRef.current.tempNodes];
      const allEdges = [...edges, ...heroCommitRef.current.tempEdges];

      // Project nodes in 3D Space
      allNodes.forEach((node) => {
        node.activationCharge = Math.max(0, node.activationCharge - 0.015);

        // Center offsets based on active camera tracking
        const bx = (node.baseX + cameraCenterXRef.current) * sizeScale;
        const by = (node.baseY + cameraCenterYRef.current) * sizeScale;
        const bz = node.baseZ * sizeScale;

        // 3D rotation steps
        const x1 = bx * cosY - bz * sinY;
        const z1 = bx * sinY + bz * cosY;

        const y1 = by * cosX - z1 * sinX;
        const z2 = by * sinX + z1 * cosX;

        const scale = Math.max(0.001, fov / Math.max(10, fov + z2));
        const sx = x1 * scale + width / 2;
        const sy = y1 * scale + height * (isMobile ? 0.44 : 0.48);

        projMap[node.id] = {
          x: sx,
          y: sy,
          z: z2,
          scale,
          node
        };

        // Update latest position maps for clicking checks
        latestProjections.current[node.id] = { x: sx, y: sy, scale };
      });

      // Periodic "Hero Beat" Commit sequence
      const now = Date.now();
      if (!reducedMotion && now - lastHeroActionTime.current > 18000 && mainCount > 4) {
        lastHeroActionTime.current = now;
        
        const startNodeIndex = Math.min(mainCount - 2, 6);
        const startNodeId = `main-${startNodeIndex}`;
        const targetNodeId = `main-${startNodeIndex + 1}`;
        const tempNodeId = 'hero-active-commit';
        
        heroCommitRef.current = {
          active: true,
          sourceNodeId: startNodeId,
          targetNodeId,
          progress: 0,
          phase: 'propagating',
          rippleRadius: 0,
          tempNodes: [{
            id: tempNodeId,
            baseX: startX + startNodeIndex * spacing + spacing * 0.65,
            baseY: -35,
            baseZ: 20,
            branch: 'active',
            isSpecial: true,
            size: 6.0,
            label: 'RELEASE',
            pulsePhase: 0,
            pulseSpeed: 0.05,
            activationCharge: 0,
            sha: 'a5f8cc3',
            author: 'System Auto-Build',
            date: '2026-07-05',
            msg: 'chore: autogenerate local storage snapshot dump tags'
          }],
          tempEdges: [
            { from: startNodeId, to: tempNodeId, isActivePath: true }
          ]
        };
      }

      // Progressing the Hero Commit sequence
      if (heroCommitRef.current.active && !reducedMotion) {
        const hc = heroCommitRef.current;
        if (hc.phase === 'propagating') {
          hc.progress += 0.015;
          if (hc.progress >= 1.0) {
            hc.progress = 1.0;
            hc.phase = 'landing';
          }
        } else if (hc.phase === 'landing') {
          hc.rippleRadius += 1.8;
          if (hc.rippleRadius > 50) {
            hc.phase = 'merging';
            hc.progress = 0;
            hc.tempEdges.push({ from: 'hero-active-commit', to: hc.targetNodeId, isActivePath: true });
            
            const targetNode = nodes.find(n => n.id === hc.targetNodeId);
            if (targetNode) {
              targetNode.activationCharge = 1.0;
            }

            // Burst signals
            for (let i = 0; i < 4; i++) {
              const matchedEdges = edges.filter(e => e.from === hc.targetNodeId || e.to === hc.targetNodeId);
              if (matchedEdges.length > 0) {
                const edge = matchedEdges[i % matchedEdges.length];
                packets.push({
                  fromId: hc.targetNodeId,
                  toId: edge.to === hc.targetNodeId ? edge.from : edge.to,
                  progress: 0,
                  speed: 0.012 + Math.random() * 0.008,
                  intensity: 1.0
                });
              }
            }
          }
        } else if (hc.phase === 'merging') {
          hc.progress += 0.015;
          if (hc.progress >= 1.0) {
            hc.progress = 1.0;
            hc.phase = 'done';
          }
        } else if (hc.phase === 'done') {
          if (now - lastHeroActionTime.current > 9000) {
            hc.active = false;
            hc.tempNodes = [];
            hc.tempEdges = [];
          }
        }
      }

      // Draw background stars
      stars.forEach((star) => {
        const sx1 = (star.baseX + cameraCenterXRef.current * 0.3) * sizeScale;
        const sz1 = star.baseX * sinY + star.baseZ * cosY;

        const sy1 = (star.baseY + cameraCenterYRef.current * 0.3) * sizeScale;
        const sz2 = star.baseY * sinX + sz1 * cosX;

        const scale = Math.max(0.001, fov / Math.max(10, fov + sz2));
        const px = sx1 * scale + width / 2;
        const py = sy1 * scale + height / 2;

        if (px >= 0 && px <= width && py >= 0 && py <= height) {
          let pulse = 1.0;
          if (!reducedMotion) {
            star.phase += 0.01;
            pulse = 0.4 + Math.sin(star.phase) * 0.4;
          }

          const brightnessOpacity = star.brightness * pulse * Math.max(0.01, Math.min(1.0, 1 - sz2 / 350));
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0, star.size * scale), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(20, 20, 20, ${brightnessOpacity * 0.12})`;
          ctx.fill();
        }
      });

      // Draw connector line edges
      allEdges.forEach((edge) => {
        const fromProj = projMap[edge.from];
        const toProj = projMap[edge.to];
        if (!fromProj || !toProj) return;

        const avgZ = (fromProj.z + toProj.z) / 2;
        const maxDepthBound = 220;
        const fade = Math.max(0.01, Math.min(1.0, 1 - avgZ / maxDepthBound));

        ctx.beginPath();
        ctx.moveTo(fromProj.x, fromProj.y);

        // Highlight active pathways
        if (edge.isActivePath) {
          const hc = heroCommitRef.current;
          let drawLineProgress = 1.0;

          if (hc.phase === 'propagating' && edge.to === 'hero-active-commit') {
            drawLineProgress = hc.progress;
          } else if (hc.phase === 'merging' && edge.to === hc.targetNodeId) {
            drawLineProgress = hc.progress;
          }

          const targetX = fromProj.x + (toProj.x - fromProj.x) * drawLineProgress;
          const targetY = fromProj.y + (toProj.y - fromProj.y) * drawLineProgress;

          ctx.lineTo(targetX, targetY);
          ctx.strokeStyle = `rgba(211, 84, 0, ${fade * 0.85})`;
          ctx.lineWidth = 2.0 * ((fromProj.scale + toProj.scale) / 2);
          ctx.stroke();

          ctx.strokeStyle = `rgba(211, 84, 0, ${fade * 0.18})`;
          ctx.lineWidth = 6.0 * ((fromProj.scale + toProj.scale) / 2);
          ctx.stroke();
        } else {
          ctx.lineTo(toProj.x, toProj.y);
          ctx.strokeStyle = `rgba(20, 20, 20, ${fade * 0.08})`;
          ctx.lineWidth = 1.0 * Math.max(0.4, (fromProj.scale + toProj.scale) / 2);
          ctx.stroke();
        }
      });

      // Progress & Render Active Signal Packets
      if (!reducedMotion) {
        for (let i = packets.length - 1; i >= 0; i--) {
          const packet = packets[i];
          packet.progress += packet.speed;

          if (packet.progress >= 1.0) {
            const targetNode = allNodes.find(n => n.id === packet.toId);
            if (targetNode) {
              targetNode.activationCharge = Math.min(1.0, targetNode.activationCharge + 0.45);
            }

            packets.splice(i, 1);
            spawnPacketOnRandomEdge();
            continue;
          }

          const fromProj = projMap[packet.fromId];
          const toProj = projMap[packet.toId];
          if (!fromProj || !toProj) continue;

          const px = fromProj.x + (toProj.x - fromProj.x) * packet.progress;
          const py = fromProj.y + (toProj.y - fromProj.y) * packet.progress;
          const pz = fromProj.z + (toProj.z - fromProj.z) * packet.progress;
          const scale = Math.max(0.001, fromProj.scale + (toProj.scale - fromProj.scale) * packet.progress);

          const maxDepthBound = 220;
          const fade = Math.max(0.01, Math.min(1.0, 1 - pz / maxDepthBound));

          ctx.beginPath();
          ctx.arc(px, py, Math.max(0, 3.2 * scale), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(211, 84, 0, ${fade * packet.intensity})`;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(px, py, Math.max(0, 7.5 * scale), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(211, 84, 0, ${fade * packet.intensity * 0.25})`;
          ctx.fill();
        }
      }

      // Draw Hero Landing Ripple (if active)
      if (heroCommitRef.current.active && heroCommitRef.current.phase === 'landing' && !reducedMotion) {
        const hc = heroCommitRef.current;
        const landingProj = projMap['hero-active-commit'];
        if (landingProj) {
          const rOpacity = Math.max(0, 1 - hc.rippleRadius / 50) * 0.55;
          ctx.beginPath();
          ctx.arc(landingProj.x, landingProj.y, Math.max(0, hc.rippleRadius * landingProj.scale), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(211, 84, 0, ${rOpacity})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Draw Commit Nodes (depth-sorted)
      const sortedProjected = Object.values(projMap).sort((a, b) => b.z - a.z);

      sortedProjected.forEach(({ x, y, z, scale, node }) => {
        const maxDepthBound = 220;
        const fade = Math.max(0.01, Math.min(1.0, 1 - z / maxDepthBound));

        // Highlight selected state nodes
        const isHovered = hoveredNodeId === node.id;
        const isSelected = selectedNode?.id === node.id;

        let r = node.size * scale;
        
        // Hover expansion mechanics
        if (isHovered) {
          r *= 1.35;
        }

        // Apply breathing pulse
        if (!reducedMotion) {
          node.pulsePhase += node.pulseSpeed;
          r += Math.sin(node.pulsePhase) * 0.8 * scale;
        }

        // Apply activation boost
        r += (node.activationCharge * 3.5 * scale);

        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);

        if (node.isSpecial || node.branch === 'active' || isSelected || node.activationCharge > 0.1) {
          const mergedOpacity = Math.max(fade * 0.85, node.activationCharge * 0.9);
          ctx.fillStyle = isSelected 
            ? `rgba(211, 84, 0, 1.0)` 
            : `rgba(211, 84, 0, ${mergedOpacity})`;
          ctx.fill();

          // Bloom Aura Glow
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0, r * (2.4 + node.activationCharge * 1.5)), 0, Math.PI * 2);
          ctx.fillStyle = isSelected 
            ? `rgba(211, 84, 0, 0.25)`
            : `rgba(211, 84, 0, ${(fade * 0.15 + node.activationCharge * 0.25)})`;
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(20, 20, 20, ${fade * 0.18})`;
          ctx.fill();
        }

        // Selected indicator focus ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0, r * 1.8), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(211, 84, 0, 0.8)`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Draw milestone labels
        if (node.label && fade > 0.35) {
          ctx.font = `bold ${Math.round(8 * scale)}px "JetBrains Mono", monospace`;
          ctx.fillStyle = node.isSpecial || node.branch === 'active'
            ? `rgba(211, 84, 0, ${fade * 0.9})` 
            : `rgba(20, 20, 20, ${fade * 0.5})`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label, x, y - r - 6);
        }

        // Render direct interactive pointer Tooltip labels on hover
        if (isHovered && fade > 0.2) {
          ctx.font = `bold 10px "JetBrains Mono", monospace`;
          const text = node.sha.toUpperCase();
          const textWidth = ctx.measureText(text).width;
          
          // Tiny Glass tooltip backing box
          ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
          ctx.fillRect(x - textWidth / 2 - 6, y - r - 22, textWidth + 12, 16);
          
          ctx.fillStyle = '#E4E3E0';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, x, y - r - 14);
        }
      });

      if (!reducedMotion) {
        animationId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [reducedMotion, selectedNode, hoveredNodeId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 overflow-hidden pointer-events-auto touch-action-none cursor-grab active:cursor-grabbing select-none"
      id="vcs-backdrop-container"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ opacity: 0.95 }}
        id="vcs-backdrop-canvas"
      />

      {/* Floating Interactive Inspect Cards Panel */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1.0 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 150, damping: 18 }}
            className="absolute bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-96 bg-[#F0EFED]/95 backdrop-blur-md border border-[#141414] p-5 shadow-[6px_6px_0px_#141414] space-y-4 pointer-events-auto z-20"
            id="vcs-commit-inspect-panel"
          >
            <div className="flex justify-between items-start border-b border-[#141414]/15 pb-2.5">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#D35400] text-[#E4E3E0] text-[9px] font-mono uppercase tracking-widest font-bold">
                  <GitCommit className="w-3 h-3" />
                  <span>COMMIT SPEC</span>
                </div>
                <div className="text-[13px] font-mono font-bold text-[#141414]">
                  SHA: {selectedNode.sha.toUpperCase()}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedNode(null);
                  targetCameraCenterXRef.current = 0;
                  targetCameraCenterYRef.current = 0;
                  targetDepthZoomRef.current = 1.0;
                }}
                className="p-1 hover:bg-[#141414]/10 transition-colors text-zinc-600 focus:outline-none"
                aria-label="Close Inspection Details"
                id="close-commit-inspect-button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-mono font-bold uppercase text-[#141414] leading-snug">
                "{selectedNode.msg}"
              </h4>
              
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-700 bg-[#E4E3E0]/45 p-2 border border-[#141414]/10">
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="truncate">{selectedNode.author}</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                  <span>{selectedNode.date}</span>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-mono text-zinc-400 uppercase font-bold tracking-wider">
                  SYSTEM BRANCH DIRECTIVE
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <HardDrive className="w-3.5 h-3.5 text-[#D35400]" />
                  <span className="text-[#141414] font-bold uppercase">
                    {selectedNode.branch}
                  </span>
                  <ArrowRight className="w-3 h-3 text-zinc-400" />
                  <span className="text-zinc-500 font-serif italic">
                    {selectedNode.isSpecial ? 'Milestone Node' : 'Linear Revision'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                // Return camera to resting center
                setSelectedNode(null);
                targetCameraCenterXRef.current = 0;
                targetCameraCenterYRef.current = 0;
                targetDepthZoomRef.current = 1.0;
              }}
              className="w-full py-2 bg-[#141414] hover:bg-zinc-800 text-center text-[#E4E3E0] font-mono uppercase tracking-wider text-[10px] font-bold border border-[#141414] transition-colors"
              id="close-inspect-cta"
            >
              Resume Drift Mode
            </button>
          </motion.div>
        )}
      </AnimatePresence>


    </div>
  );
};
