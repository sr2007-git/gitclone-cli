import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Send,
  MessageSquare,
  Sparkles,
  ChevronDown,
  X,
  RotateCcw,
  BookOpen,
  CornerDownLeft,
  Info
} from 'lucide-react';
import { SandboxFile, FileStatus, RepoStatusResult } from '../types';

interface MascotCompanionProps {
  status: RepoStatusResult | null;
  files: SandboxFile[];
  activeTab: string;
  currentLessonId?: string;
  currentLessonTitle?: string;
}

interface ChatHistoryMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export function MascotCompanion({
  status,
  files,
  activeTab,
  currentLessonId,
  currentLessonTitle
}: MascotCompanionProps) {
  // UI and Chat states
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>([
    {
      role: 'model',
      text: "Hi there, friend! I'm Branchy, your clever VCS companion fox! Click me anytime for interactive guidance, quick command tips, or a fun Git joke! Let's build something wonderful together.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean | null>(null);
  const [showMicPermissionModal, setShowMicPermissionModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  // Fox Animation / Interactive States
  const [pose, setPose] = useState<'idle' | 'attentive' | 'listening' | 'speaking' | 'happy' | 'sleeping' | 'thinking'>('idle');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const [micVolume, setMicVolume] = useState(0); // Real-time volume for animation
  const [speechBubbleText, setSpeechBubbleText] = useState<string | null>(null);
  const [bubbleTimer, setBubbleTimer] = useState<NodeJS.Timeout | null>(null);

  // Inactivity tracking for Sleeping State
  const lastActivityRef = useRef<number>(Date.now());

  // Proactive guidance memory
  const prevTabRef = useRef(activeTab);
  const prevLessonIdRef = useRef(currentLessonId);
  const prevConflictsCountRef = useRef(0);
  const prevCompletedLessonsCountRef = useRef(0);

  // Streaming and Interruption control
  const abortControllerRef = useRef<AbortController | null>(null);
  const sentenceBufferRef = useRef<string>('');

  // Speech Recognition & Synthesis references
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const synthesisUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Track page interaction for sleeping state
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      if (pose === 'sleeping') {
        setPose('idle');
        speakText("Oh! *Yawn*... I'm awake! Ready for some version control action!");
      }
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);

    // Sleep check interval (sleep after 2 minutes of complete inactivity)
    const sleepInterval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 120000 && pose === 'idle' && !isOpen) {
        setPose('sleeping');
      }
    }, 15000);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      clearInterval(sleepInterval);
    };
  }, [pose, isOpen]);

  // Autoscroll chat history
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isOpen]);

  // Periodic Blink effect
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      if (pose !== 'sleeping') {
        setIsBlinking(true);
        setTimeout(() => setIsBlinking(false), 150);
      }
    }, 4000 + Math.random() * 3000);

    return () => clearInterval(blinkInterval);
  }, [pose]);

  // Track cursor movement to rotate/move eyes toward mouse
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Find the center of the viewport or near the bottom right where the mascot is
      const targetX = window.innerWidth - 80;
      const targetY = window.innerHeight - 80;
      
      const dx = e.clientX - targetX;
      const dy = e.clientY - targetY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 10) {
        // Map offset to a max of 2.5px
        const maxOffset = 2.5;
        const angle = Math.atan2(dy, dx);
        setEyeOffset({
          x: Math.cos(angle) * maxOffset,
          y: Math.sin(angle) * maxOffset
        });
        
        // If mouse is near, go into attentive pose briefly
        if (distance < 300 && pose === 'idle') {
          setPose('attentive');
        } else if (distance >= 300 && pose === 'attentive') {
          setPose('idle');
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [pose]);

  // Proactive/Predictive greetings and real-time foxy context tips
  useEffect(() => {
    // 1. Proactive Tab Transition Greeting
    if (activeTab !== prevTabRef.current) {
      if (activeTab === 'playground') {
        speakText("Sandbox mode is active! Feel free to create custom files and build whatever branches you want. I'm right here if you get lost!");
      } else if (activeTab === 'learn') {
        speakText("Welcome to the Academy! Let's choose a path and learn how repository snapshots work!");
      }
      prevTabRef.current = activeTab;
    }

    // 2. Proactive Lesson Activation Greeting
    if (currentLessonId !== prevLessonIdRef.current) {
      if (currentLessonId) {
        speakText(`Let's tackle: "${currentLessonTitle || 'VCS Concepts'}". Read the guide on the left, then try the practice box!`);
      }
      prevLessonIdRef.current = currentLessonId;
    }

    // 3. Proactive Merge Conflict Reassurance
    const currentConflicts = status?.files.filter(f => f.status === 'conflict').length || 0;
    if (currentConflicts > 0 && prevConflictsCountRef.current === 0) {
      speakText("Oh whiskers! We've run into a merge conflict! Don't worry, look at the files with red labels, resolve the code between markers, stage, and commit!");
    }
    prevConflictsCountRef.current = currentConflicts;

    // 4. Proactive Lesson Completion Cheer
    const completedCount = localStorage.getItem('gc_completed_lessons') 
      ? JSON.parse(localStorage.getItem('gc_completed_lessons')!).length 
      : 0;
    if (completedCount > prevCompletedLessonsCountRef.current && prevCompletedLessonsCountRef.current > 0) {
      setPose('happy');
      speakText("Hurray! *Happy Spin!* You successfully completed that VCS lesson! You're becoming a true pathmaster!");
      setTimeout(() => setPose('idle'), 2000);
    }
    prevCompletedLessonsCountRef.current = completedCount;

  }, [activeTab, currentLessonId, status, currentLessonTitle]);

  // Instant Interruption for both AI streams and vocal tracks
  const handleInterrupt = () => {
    // 1. Abort the HTTP streaming fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 2. Clear browser speech queues immediately
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    // 3. Clear transient sentence buffers
    sentenceBufferRef.current = '';
    // 4. Reset poses and spinners
    setIsSending(false);
    setPose('idle');
  };

  // Speak sentences incrementally without canceling previous items in speech queue
  const speakIncremental = (text: string) => {
    if (isMuted) {
      showSpeechBubble(text);
      return;
    }
    try {
      if (window.speechSynthesis) {
        // Strip out common markdown styling characters
        const cleanSpeech = text.replace(/[*_`]/g, '').trim();
        if (!cleanSpeech) return;

        const utterance = new SpeechSynthesisUtterance(cleanSpeech);
        
        // Find high-quality, female-toned voices with brighter timbre
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(
          v => v.name.toLowerCase().includes('female') ||
               v.name.includes('Google US English') ||
               v.name.includes('Zira') || 
               v.name.includes('Samantha') || 
               v.lang.startsWith('en')
        );
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
        
        utterance.rate = 1.1; // Speedy and quick-witted
        utterance.pitch = 1.35; // Bright, adorable female-sounding pitch for our fox

        utterance.onstart = () => {
          setPose('speaking');
          showSpeechBubble(text);
        };

        utterance.onend = () => {
          if (!window.speechSynthesis.speaking) {
            setPose('idle');
          }
        };

        utterance.onerror = () => {
          if (!window.speechSynthesis.speaking) {
            setPose('idle');
          }
        };

        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn('Incremental speech synthesis failed', e);
      showSpeechBubble(text);
    }
  };

  // Native Speech Synthesis (Text-To-Speech) with clean voices
  const speakText = (text: string) => {
    if (isMuted) {
      // Display a quick pop-up bubble above the fox instead of speaking
      showSpeechBubble(text);
      return;
    }

    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel(); // Stop any current speech
        
        // Strip markdown stars or backticks for speech
        const cleanSpeech = text.replace(/[*_`]/g, '');
        
        const utterance = new SpeechSynthesisUtterance(cleanSpeech);
        synthesisUtteranceRef.current = utterance;
        
        // Find a high-quality, friendly-sounding voice (preferably US female or lighter timbre)
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(
          v => v.name.toLowerCase().includes('female') ||
               v.name.includes('Google US English') || 
               v.name.includes('Zira') || 
               v.name.includes('Samantha') || 
               v.lang.startsWith('en')
        );
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
        
        utterance.rate = 1.1; // Slightly faster/chirpier
        utterance.pitch = 1.35; // Slightly higher pitch for fox companion cute feel
 
        utterance.onstart = () => {
          setPose('speaking');
          showSpeechBubble(text);
        };
 
        utterance.onend = () => {
          setPose('idle');
        };
 
        utterance.onerror = () => {
          setPose('idle');
        };
 
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn('Speech synthesis not supported or failed', e);
      showSpeechBubble(text);
    }
  };

  // Pop up speech bubble text
  const showSpeechBubble = (text: string) => {
    // Trim length for visual layout neatness
    const previewText = text.length > 80 ? text.substring(0, 77) + '...' : text;
    setSpeechBubbleText(previewText);

    if (bubbleTimer) clearTimeout(bubbleTimer);
    const timer = setTimeout(() => {
      setSpeechBubbleText(null);
    }, 4500);
    setBubbleTimer(timer);
  };

  // Initialize Speech Recognition (Speech-to-Text)
  const initSpeechRecognition = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('Speech Recognition is not supported by your browser. Please type your message instead.');
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setIsListening(true);
      setPose('listening');
      startAudioAnalysis();
    };

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        setInputMessage(transcript);
        handleSendMessage(transcript);
      }
    };

    rec.onerror = (e: any) => {
      console.error('Speech recognition error', e);
      setIsListening(false);
      setPose('idle');
      stopAudioAnalysis();
    };

    rec.onend = () => {
      setIsListening(false);
      setPose('idle');
      stopAudioAnalysis();
    };

    recognitionRef.current = rec;
  };

  // Microphone permission handler
  const handleMicClick = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    if (micPermissionGranted === null) {
      setShowMicPermissionModal(true);
    } else if (micPermissionGranted === false) {
      alert('Microphone access was denied. You can re-enable it in your browser settings or use text chat!');
    } else {
      startListeningFlow();
    }
  };

  const grantMicPermission = async () => {
    setShowMicPermissionModal(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Keep track of permission
      setMicPermissionGranted(true);
      // Stop the stream immediately, it'll be reopened by recognition or analysis
      stream.getTracks().forEach(track => track.stop());
      startListeningFlow();
    } catch (err) {
      console.error('Mic permission denied', err);
      setMicPermissionGranted(false);
      alert('Microphone permission denied. Fallback to standard text keyboard entry.');
    }
  };

  const startListeningFlow = () => {
    if (!recognitionRef.current) {
      initSpeechRecognition();
    }
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
    }
  };

  // Real-time voice frequency analyzer for live tail-wags and ear twitch animations
  const startAudioAnalysis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Map average volume (0-120) to scaling factor 0-1
        setMicVolume(Math.min(average / 45, 1));
        
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('Audio visualization failed to start', e);
    }
  };

  const stopAudioAnalysis = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setMicVolume(0);
  };

  // Helper to update the streaming model response placeholder in-place
  const updatePlaceholderWithText = (text: string) => {
    setChatHistory(prev => {
      const next = [...prev];
      if (next.length > 0 && next[next.length - 1].role === 'model') {
        next[next.length - 1].text = text;
      }
      return next;
    });
  };

  // Chat message sender with high-speed streaming and proactive interruption
  const handleSendMessage = async (msgOverride?: string) => {
    const textToSend = msgOverride || inputMessage;
    if (!textToSend.trim()) return;

    // 1. Interrupt any current stream/speech to remain 100% responsive
    handleInterrupt();

    // 2. Setup AbortController for streaming connection
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Add user message to local history and push an empty model placeholder
    const userMsg: ChatHistoryMessage = {
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChatHistory(prev => [
      ...prev,
      userMsg,
      {
        role: 'model',
        text: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);

    if (!msgOverride) setInputMessage('');
    setIsSending(true);
    setPose('thinking'); // Tilt head curiously to acknowledge immediately

    // Compile active context for Gemini
    const stagedCount = status?.files.filter(f => 
      f.status === 'staged_new' || f.status === 'modified_staged' || f.status === 'staged_deleted'
    ).length || 0;

    const modifiedCount = status?.files.filter(f => f.status === 'modified_unstaged').length || 0;
    const conflictCount = status?.files.filter(f => f.status === 'conflict').length || 0;

    const contextPayload = {
      activeTab,
      repoInitialized: status?.isInitialized || false,
      currentBranch: status?.currentBranch || null,
      stagedCount,
      modifiedCount,
      conflictCount,
      currentLessonId,
      currentLessonTitle
    };

    // 30-second connection failure safety timeout to survive cold starts or network lag
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    let accumulatedText = '';
    sentenceBufferRef.current = '';

    try {
      const token = localStorage.getItem('gc_session_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-session-token'] = token;
      }
      
      const isPlaygroundActive = (window as any).isPlaygroundModeActive;
      if (isPlaygroundActive) {
        headers['x-is-playground'] = 'true';
      }

      const url = isPlaygroundActive 
        ? '/api/companion/chat-stream?playground=true' 
        : '/api/companion/chat-stream';

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          message: textToSend,
          history: chatHistory
            .filter(h => h.text && h.text.trim())
            .map(h => ({ role: h.role, text: h.text })),
          context: contextPayload
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Streaming connection failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) throw new Error('ReadableStream not supported on this browser');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulatedText += chunk;
        sentenceBufferRef.current += chunk;

        // Update UI placeholder streamingly
        updatePlaceholderWithText(accumulatedText);

        // Periodically parse and speak finished clauses
        // Look for common end of clause/sentence markers
        let match;
        const boundaryRegex = /([^.?!;:\n]+[.?!;:\n]+)/g;
        while ((match = boundaryRegex.exec(sentenceBufferRef.current)) !== null) {
          const sentence = match[1];
          speakIncremental(sentence);
          // Crop spoken text from buffer
          sentenceBufferRef.current = sentenceBufferRef.current.substring(match.index + sentence.length);
          boundaryRegex.lastIndex = 0;
        }
      }

      // Speak remaining text in sentence buffer
      if (sentenceBufferRef.current.trim()) {
        speakIncremental(sentenceBufferRef.current);
      }

      // Finish with a happy jump or tail wag
      setPose('happy');
      setTimeout(() => setPose('idle'), 1500);

    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        if (accumulatedText === '') {
          // Absolute fail due to connection timeout
          const fallbackText = "Oh whiskers! My connection is a bit tangled up right now. Let's practice some standard commands while I reconnect!";
          updatePlaceholderWithText(fallbackText);
          speakText(fallbackText);
        }
      } else {
        console.error(err);
        const fallbackText = "Oh whiskers! Something tangled up our tail-track. Could you try asking me again?";
        updatePlaceholderWithText(fallbackText);
        speakText(fallbackText);
      }
    } finally {
      setIsSending(false);
      abortControllerRef.current = null;
    }
  };

  // Suggest interactive quick questions / command shortcuts
  const handleQuickQuestion = (question: string) => {
    handleSendMessage(question);
  };

  // Interactive advice generator based on local repo status
  const getFoxyHint = () => {
    if (!status?.isInitialized) {
      return "Whiskers! Our VCS tracker isn't initialized yet. Initialize the clean sandbox or launch the academy path to begin tracking revisions!";
    }

    const conflictFiles = status.files.filter(f => f.status === 'conflict');
    if (conflictFiles.length > 0) {
      return `Oh boy! We have ${conflictFiles.length} merge conflicts! Look for conflict markers (<<<<<<< HEAD) in your files, choose which lines to keep, save, and hit 'Commit' to resolve!`;
    }

    const modifiedFiles = status.files.filter(f => f.status === 'modified_unstaged');
    if (modifiedFiles.length > 0) {
      return `Foxy-fine! You have ${modifiedFiles.length} file(s) with unstaged edits. Stage them with the "Stage Changes" button to queue them up for a commit snapshot!`;
    }

    const stagedFiles = status.files.filter(f => 
      f.status === 'staged_new' || f.status === 'modified_staged' || f.status === 'staged_deleted'
    );
    if (stagedFiles.length > 0) {
      return `Excellent work! You have ${stagedFiles.length} changes staged and ready to commit. Type a description in the Commit Box on the dashboard to save your snapshot forever!`;
    }

    if (activeTab === 'playground') {
      return "You are in the free Sandbox mode! Create files, make experimental changes, and examine how GitClone's internal database tracks snapshots under the 'VCS Internals' tab.";
    }

    if (activeTab === 'learn' && currentLessonId) {
      // Special custom hints for each lesson
      switch (currentLessonId) {
        case 'lesson_repo':
          return "First step: make sure your repository is initialized! Just click the 'Initialize Repo' button to set up our hidden database.";
        case 'lesson_stage':
          return "Edit or create a file (like index.js), then stage it! This tracks the file and puts it in our preparation area (the index).";
        case 'lesson_commit':
          return "Ready to commit! Make sure you stage at least one change first, then type a commit message (like 'Initial commit') and commit!";
        case 'lesson_branches':
          return "Create a parallel universe! Use the branch manager to create a new branch, and switch to it to write independent code.";
        case 'lesson_merge':
          return "Bring it back together! Switch to the main branch, then merge your secondary branch to combine your parallel changes.";
        case 'lesson_conflicts':
          return "A merge conflict is a puzzle! Open index.js, find the conflict lines, choose the best code, save the file, stage it, and commit!";
        case 'lesson_cherrypick':
          return "Cherry-picking lets you copy a single commit from another branch onto your current branch! Find the target commit ID in the graph, and click Cherry-Pick.";
        default:
          return "Follow the Academy lesson instructions on the left to earn your version control merit badge!";
      }
    }

    return "Looking good! Click the 'Workspace Files' folder-tree to create files, write code, or switch branches to experiment!";
  };

  // Manual Trigger to get a contextual advice tip
  const triggerFoxyHintSpeech = () => {
    const hint = getFoxyHint();
    speakText(hint);
    // Add to chat history as model output
    setChatHistory(prev => [
      ...prev,
      {
        role: 'model',
        text: hint,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  return (
    <>
      {/* 1. Speech Permission Modal */}
      <AnimatePresence>
        {showMicPermissionModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border-2 border-[#141414] max-w-sm w-full p-6 shadow-[8px_8px_0px_#141414] font-mono text-xs text-[#141414]"
            >
              <div className="flex items-center gap-2 pb-3 border-b-2 border-[#141414] mb-4">
                <Mic className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold uppercase tracking-widest text-sm">Microphone Request</h3>
              </div>
              <p className="font-serif italic leading-relaxed text-zinc-700 mb-4">
                "Hi friend! I process your voice 100% locally in your web browser. No audio recordings are ever transmitted, saved, or sent to a remote server. Do you mind if I listen to transcribe your questions?"
              </p>
              <div className="flex gap-2">
                <button
                  onClick={grantMicPermission}
                  className="flex-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-mono uppercase font-bold border border-emerald-950 shadow-[3px_3px_0px_#047857]"
                >
                  Yes, Allow
                </button>
                <button
                  onClick={() => setShowMicPermissionModal(false)}
                  className="flex-1 py-2 bg-[#E4E3E0] hover:bg-zinc-300 border border-[#141414] font-mono uppercase font-bold"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. Floating Mascot Anchor Widget with Spring entry/exit on tab navigation */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, scale: 0.6, y: 80, rotate: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: 80, rotate: -12 }}
          transition={{
            type: "spring",
            stiffness: 280,
            damping: 18,
            mass: 0.8
          }}
          className="fixed bottom-6 right-6 z-40 flex flex-col items-end"
        >
        
        {/* Real-time speech bubble directly above the fox */}
        <AnimatePresence>
          {speechBubbleText && !isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.8 }}
              className="max-w-[180px] bg-white border border-[#141414] p-2 rounded-lg shadow-[3px_3px_0px_#141414] mb-2 font-mono text-[10px] text-[#141414] leading-tight relative"
            >
              <div className="font-bold uppercase text-[8px] text-zinc-500 mb-1">Branchy Says:</div>
              <p className="font-serif italic">{speechBubbleText}</p>
              {/* Little speech arrow pointing down */}
              <div className="absolute bottom-[-5px] right-6 w-2.5 h-2.5 bg-white border-r border-b border-[#141414] transform rotate-45"></div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Fox Character Wrapper */}
        <div className="flex items-center gap-2">
          {/* Action Hint trigger, only when chat panel is closed */}
          {!isOpen && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              onClick={() => {
                setIsOpen(true);
                setIsMinimized(false);
                speakText("How can I assist you with your project path today?");
              }}
              className="p-1.5 bg-[#EAFAF1] border border-emerald-900 text-emerald-900 hover:bg-emerald-50 text-[10px] font-mono uppercase tracking-widest font-bold shadow-[2px_2px_0px_#049669] flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>Ask Branchy</span>
            </motion.button>
          )}

          {/* Actual Animatable Fox Character Render */}
          <motion.div
            onClick={() => {
              if (isSending || window.speechSynthesis?.speaking) {
                handleInterrupt();
                speakText("I'm listening! What trail shall we choose next?");
                return;
              }
              setIsOpen(prev => !prev);
              setIsMinimized(false);
              if (!isOpen) {
                speakText("Hello! Need some help navigating your branches or reviewing a commit berry?");
              }
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="w-16 h-16 cursor-pointer relative"
            title="Click to talk with Branchy!"
          >
            {/* The real-time volume ripple/pulse effect */}
            {isListening && (
              <div 
                className="absolute inset-0 border-4 border-rose-500 rounded-full animate-ping opacity-35" 
                style={{ transform: `scale(${1.1 + micVolume * 0.75})` }} 
              />
            )}
            
            {/* The SVG Fox Illustration */}
            <svg
              viewBox="0 0 60 60"
              className="w-full h-full select-none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Definition of gradients */}
              <defs>
                <radialGradient id="foxyShadow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#141414" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#141414" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Floor Shadow */}
              <ellipse cx="30" cy="54" rx="14" ry="3.5" fill="url(#foxyShadow)" />

              {/* TAIL Element (Animated Rotations) */}
              <motion.g
                animate={
                  pose === 'happy'
                    ? { rotate: [-18, 18, -18] }
                    : pose === 'listening'
                    ? { rotate: [-10 + micVolume * 20, 10 + micVolume * 20, -10 + micVolume * 20] }
                    : pose === 'sleeping'
                    ? { rotate: [0, 2, 0] }
                    : { rotate: [-6, 6, -6] } // Standard Idle tail wag
                }
                transition={{
                  repeat: Infinity,
                  duration: pose === 'happy' ? 0.35 : pose === 'listening' ? 0.8 : pose === 'sleeping' ? 5 : 2.8,
                  ease: "easeInOut"
                }}
                style={{ originX: "46px", originY: "48px" }}
              >
                {/* Tail body */}
                <path d="M 36,44 C 42,42 50,44 48,50 C 46,54 40,52 36,44 Z" fill="#E65100" />
                {/* Tail tip */}
                <path d="M 44,48 C 47,46 50,44 48,50 C 46,54 44,52 44,48 Z" fill="#FDFEFE" />
              </motion.g>

              {/* BODY Structure */}
              <motion.g
                animate={
                  pose === 'sleeping'
                    ? { scaleY: [0.95, 1.0, 0.95] }
                    : { scaleY: [1.0, 1.03, 1.0] } // breathing cycle
                }
                transition={{
                  repeat: Infinity,
                  duration: pose === 'sleeping' ? 5.5 : 3.8,
                  ease: "easeInOut"
                }}
                style={{ originX: "30px", originY: "50px" }}
              >
                {/* Main orange back/sides */}
                <ellipse cx="30" cy="44" rx="11" ry="8" fill="#EF6C00" />
                {/* Cream-white chest pocket */}
                <ellipse cx="30" cy="45" rx="6.5" ry="5.5" fill="#FDFEFE" />
                {/* Little cute paws */}
                <circle cx="25" cy="51" r="2" fill="#E65100" />
                <circle cx="35" cy="51" r="2" fill="#E65100" />
              </motion.g>

              {/* HEAD & FACE (Twitches, head tilts, and looking poses) */}
              <motion.g
                animate={
                  pose === 'listening'
                    ? { rotate: -6, y: -1 }
                    : pose === 'thinking'
                    ? { rotate: [10, -8, 10], y: -2 } // Curious, slow head tilting cycle
                    : pose === 'speaking'
                    ? { y: [-0.5, 0.8, -0.5] }
                    : pose === 'happy'
                    ? { y: [-5, 0, -5], rotate: [0, 10, -10, 0] }
                    : pose === 'sleeping'
                    ? { y: 2, rotate: 3 }
                    : { y: 0, rotate: 0 }
                }
                transition={
                  pose === 'speaking'
                    ? { repeat: Infinity, duration: 0.45, ease: "easeInOut" }
                    : pose === 'thinking'
                    ? { repeat: Infinity, duration: 3.5, ease: "easeInOut" }
                    : { duration: 0.5, ease: "easeOut" }
                }
                style={{ originX: "30px", originY: "38px" }}
              >
                {/* LEFT EAR (Animated twitching) */}
                <motion.polygon
                  points="18,24 12,12 24,20"
                  fill="#E65100"
                  animate={
                    pose === 'listening'
                      ? { rotate: [0, -12, 0] }
                      : { rotate: [0, -3, 0, 5, 0] }
                  }
                  transition={{
                    repeat: Infinity,
                    duration: pose === 'listening' ? 1.2 : 4.8,
                    repeatDelay: 2
                  }}
                  style={{ originX: "18px", originY: "24px" }}
                />
                <polygon points="17,21 13,14 21,18" fill="#FFCDD2" /> {/* Inner left ear */}

                {/* RIGHT EAR (Animated twitching) */}
                <motion.polygon
                  points="42,24 48,12 36,20"
                  fill="#E65100"
                  animate={
                    pose === 'listening'
                      ? { rotate: [0, 12, 0] }
                      : { rotate: [0, 4, 0, -6, 0] }
                  }
                  transition={{
                    repeat: Infinity,
                    duration: pose === 'listening' ? 1.5 : 5.5,
                    repeatDelay: 1.5
                  }}
                  style={{ originX: "42px", originY: "24px" }}
                />
                <polygon points="43,21 47,14 39,18" fill="#FFCDD2" /> {/* Inner right ear */}

                {/* Head base shape */}
                <path d="M 16,32 C 16,24 44,24 44,32 C 44,40 38,44 30,44 C 22,44 16,40 16,32 Z" fill="#EF6C00" />

                {/* Cream cheeks */}
                <path d="M 16,32 C 16,37 22,42 25,41 C 21,37 20,33 16,32 Z" fill="#FDFEFE" />
                <path d="M 44,32 C 44,37 38,42 35,41 C 39,37 40,33 44,32 Z" fill="#FDFEFE" />

                {/* EYES Section (Cursor Eye-Tracking & Blink State) */}
                {pose === 'sleeping' ? (
                  // Sleeping eyes: ^ ^
                  <>
                    <path d="M 20,31 Q 23,29 26,31" stroke="#141414" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    <path d="M 34,31 Q 37,29 40,31" stroke="#141414" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </>
                ) : isBlinking ? (
                  // Blink slots
                  <>
                    <line x1="20" y1="31" x2="26" y2="31" stroke="#141414" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="34" y1="31" x2="40" y2="31" stroke="#141414" strokeWidth="1.5" strokeLinecap="round" />
                  </>
                ) : pose === 'listening' || pose === 'happy' ? (
                  // Happy curved crescent eyes: \ / or arch
                  <>
                    <path d="M 20,32 Q 23,28 26,32" stroke="#141414" strokeWidth="2" fill="none" strokeLinecap="round" />
                    <path d="M 34,32 Q 37,28 40,32" stroke="#141414" strokeWidth="2" fill="none" strokeLinecap="round" />
                  </>
                ) : (
                  // Normal eyes with eye translation tracking
                  <>
                    {/* Left Eye Whites & Pupils */}
                    <circle cx="23" cy="31" r="3" fill="#FDFEFE" />
                    <circle
                      cx={23 + eyeOffset.x}
                      cy={31 + eyeOffset.y}
                      r="1.8"
                      fill="#141414"
                    />
                    <circle cx={22.2 + eyeOffset.x} cy={30.2 + eyeOffset.y} r="0.6" fill="#FDFEFE" />

                    {/* Right Eye Whites & Pupils */}
                    <circle cx="37" cy="31" r="3" fill="#FDFEFE" />
                    <circle
                      cx={37 + eyeOffset.x}
                      cy={31 + eyeOffset.y}
                      r="1.8"
                      fill="#141414"
                    />
                    <circle cx={36.2 + eyeOffset.x} cy={30.2 + eyeOffset.y} r="0.6" fill="#FDFEFE" />
                  </>
                )}

                {/* Cute rosy blush dots */}
                {pose === 'happy' && (
                  <>
                    <circle cx="18" cy="35" r="2" fill="#FF8A80" opacity="0.8" />
                    <circle cx="42" cy="35" r="2" fill="#FF8A80" opacity="0.8" />
                  </>
                )}

                {/* Snout and small nose */}
                <polygon points="28,36 32,36 30,39" fill="#141414" />
                <path d="M 29,39 Q 30,41 31,39" stroke="#141414" strokeWidth="1" fill="none" />

                {/* Animated Lipsync Mouth */}
                {pose === 'speaking' ? (
                  <motion.ellipse
                    cx="30"
                    cy="41"
                    rx="1.5"
                    ry="2.5"
                    fill="#141414"
                    animate={{ scaleY: [0.3, 1.2, 0.4, 1.0, 0.2] }}
                    transition={{ repeat: Infinity, duration: 0.35 }}
                  />
                ) : pose === 'happy' ? (
                  <path d="M 28,40 Q 30,42 32,40" stroke="#141414" strokeWidth="1" fill="none" />
                ) : null}
              </motion.g>

              {/* Sleeping particle letters float */}
              {pose === 'sleeping' && (
                <>
                  <motion.text
                    x="42"
                    y="18"
                    fontSize="6"
                    fontFamily="monospace"
                    fill="#141414"
                    opacity="0.6"
                    animate={{ y: [18, 8], opacity: [0.6, 0] }}
                    transition={{ repeat: Infinity, duration: 2.5, repeatDelay: 0.5 }}
                  >
                    z
                  </motion.text>
                  <motion.text
                    x="48"
                    y="14"
                    fontSize="9"
                    fontFamily="monospace"
                    fill="#141414"
                    opacity="0.8"
                    animate={{ y: [14, 2], opacity: [0.8, 0] }}
                    transition={{ repeat: Infinity, duration: 2.5, repeatDelay: 1.2 }}
                  >
                    Z
                  </motion.text>
                </>
              )}
            </svg>
          </motion.div>
        </div>

        {/* 3. The Expandable Interactive Chat Drawer/Panel */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 30, scale: 0.95 }}
              className="absolute bottom-18 right-0 w-[340px] max-w-[calc(100vw-32px)] bg-[#F0EFED] border-2 border-[#141414] shadow-[8px_8px_0px_#141414] font-mono text-xs flex flex-col overflow-hidden"
              style={{ height: isMinimized ? '44px' : '440px' }}
            >
              {/* Header block */}
              <div className="bg-[#141414] text-[#E4E3E0] px-3 py-2.5 flex items-center justify-between border-b-2 border-[#141414] select-none">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse" />
                  <span className="font-bold uppercase tracking-wider text-[11px]">Branchy.core Companion</span>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Mute toggle button */}
                  <button
                    onClick={() => setIsMuted(prev => !prev)}
                    className="p-1 text-[#E4E3E0] hover:text-white hover:bg-zinc-800 rounded transition"
                    title={isMuted ? 'Unmute voice output' : 'Mute voice output'}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>

                  {/* Minimize Toggle button */}
                  <button
                    onClick={() => setIsMinimized(prev => !prev)}
                    className="p-1 text-[#E4E3E0] hover:text-white hover:bg-zinc-800 rounded transition text-[10px]"
                    title={isMinimized ? 'Expand window' : 'Minimize window'}
                  >
                    {isMinimized ? '▲' : '▼'}
                  </button>

                  {/* Complete Close button */}
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 text-[#E4E3E0] hover:text-rose-400 hover:bg-zinc-800 rounded transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Chat Content Body (when not minimized) */}
              {!isMinimized && (
                <>
                  {/* Scrolling Conversation Log */}
                  <div
                    ref={scrollRef}
                    className="flex-1 p-3 overflow-y-auto space-y-3 bg-[#D9D8D5]/20 max-h-[290px]"
                  >
                    {chatHistory.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1 text-[8px] text-zinc-500 uppercase font-bold mb-1 select-none">
                          <span>{msg.role === 'user' ? 'You' : 'Branchy'}</span>
                          <span>•</span>
                          <span>{msg.timestamp}</span>
                        </div>
                        <div
                          className={`p-2.5 max-w-[85%] border border-[#141414] shadow-[2px_2px_0px_#141414] ${
                            msg.role === 'user'
                              ? 'bg-[#141414] text-[#E4E3E0] font-semibold'
                              : 'bg-white text-[#141414] font-serif italic leading-relaxed'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}

                    {isSending && (
                      <div className="flex flex-col items-start select-none">
                        <span className="text-[8px] text-zinc-500 font-bold uppercase mb-1">Branchy is digging...</span>
                        <div className="p-2 border border-[#141414] bg-white text-zinc-500 italic font-serif flex items-center gap-1.5 shadow-[2px_2px_0px_#141414]">
                          <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                          <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                          <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Interactive Quick Shortcuts Panel */}
                  <div className="px-3 py-1.5 border-t border-b border-[#141414]/15 bg-[#F0EFED] flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-none select-none">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tight mr-1">Ask:</span>
                    <button
                      onClick={triggerFoxyHintSpeech}
                      className="px-2 py-0.5 bg-white border border-[#141414]/20 hover:border-[#141414] rounded-full text-[9px] font-mono hover:bg-[#D9D8D5]/50 flex items-center gap-0.5 shrink-0"
                    >
                      <Info className="w-2.5 h-2.5 text-orange-600" />
                      Context Hint
                    </button>
                    <button
                      onClick={() => handleQuickQuestion("Explain Git branches simply")}
                      className="px-2 py-0.5 bg-white border border-[#141414]/20 hover:border-[#141414] rounded-full text-[9px] font-mono hover:bg-[#D9D8D5]/50 shrink-0"
                    >
                      What are branches?
                    </button>
                    <button
                      onClick={() => handleQuickQuestion("How do I fix a merge conflict?")}
                      className="px-2 py-0.5 bg-white border border-[#141414]/20 hover:border-[#141414] rounded-full text-[9px] font-mono hover:bg-[#D9D8D5]/50 shrink-0"
                    >
                      Fix conflict?
                    </button>
                    <button
                      onClick={() => handleQuickQuestion("Tell me a funny Version Control joke")}
                      className="px-2 py-0.5 bg-white border border-[#141414]/20 hover:border-[#141414] rounded-full text-[9px] font-mono hover:bg-[#D9D8D5]/50 shrink-0"
                    >
                      Git Joke 🦊
                    </button>
                  </div>

                  {/* Input Form Footer */}
                  <div className="p-2 border-t border-[#141414]/20 bg-white flex items-center gap-1.5">
                    {/* Native Web Audio microphone transcribe trigger */}
                    <button
                      type="button"
                      onClick={handleMicClick}
                      className={`p-2 border border-[#141414] flex items-center justify-center transition cursor-pointer shrink-0 ${
                        isListening 
                          ? 'bg-rose-600 text-white animate-pulse' 
                          : 'bg-[#F0EFED] text-[#141414] hover:bg-zinc-200'
                      }`}
                      title={isListening ? 'Stop listening' : 'Speak with Branchy'}
                    >
                      {isListening ? <Mic className="w-4 h-4" /> : <Mic className="w-4 h-4 text-zinc-700" />}
                    </button>

                    {/* Typed Text Input */}
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={isSending || isListening}
                      className="flex-1 min-w-0 bg-[#F0EFED] border border-[#141414] text-xs font-mono px-2 py-2 focus:outline-none placeholder-zinc-400"
                      placeholder={isListening ? "Listening closely..." : "Ask Branchy a question..."}
                    />

                    {/* Send submit button */}
                    <button
                      type="button"
                      onClick={() => handleSendMessage()}
                      disabled={isSending || isListening || !inputMessage.trim()}
                      className="p-2 bg-[#141414] text-white border border-[#141414] hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        </motion.div>
      </AnimatePresence>
    </>
  );
}
