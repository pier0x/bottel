import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import { TextStyle } from 'pixi.js';
import type { ServerMessage, RoomAgent, ChatMessage, Room } from '@bottel/shared';
import { TILE_WIDTH, TILE_HEIGHT } from '@bottel/shared';
import { IconDoor, IconChat, IconLink, IconChart, IconUser, IconEye, IconClose, IconZap, IconSearch, IconCalendar, IconHotel, IconInfo } from './PixelIcons';

// Smooth position tracking for agents with path-based animation
interface SmoothPosition {
  currentX: number;
  currentY: number;
  waypoints: { x: number; y: number }[];
  speed: number; // tiles per second
}

// Convert world coords to screen (isometric)
function toScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - y) * (TILE_WIDTH / 2),
    y: (x + y) * (TILE_HEIGHT / 2),
  };
}

// Color manipulation helpers for Habbo-style avatars
function darkenColor(c: number, amount: number): number {
  const r = Math.max(0, ((c >> 16) & 0xFF) * (1 - amount));
  const g = Math.max(0, ((c >> 8) & 0xFF) * (1 - amount));
  const b = Math.max(0, (c & 0xFF) * (1 - amount));
  return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
}
function lightenColor(c: number, amount: number): number {
  const r = Math.min(255, ((c >> 16) & 0xFF) + (255 - ((c >> 16) & 0xFF)) * amount);
  const g = Math.min(255, ((c >> 8) & 0xFF) + (255 - ((c >> 8) & 0xFF)) * amount);
  const b = Math.min(255, (c & 0xFF) + (255 - (c & 0xFF)) * amount);
  return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
}

// Habbo-style pixel art avatar renderer
// Draws a blocky isometric character with the given body color
// Origin (0,0) = shadow center / feet position
function drawHabboAvatar(g: import('pixi.js').Graphics, bodyColorHex: string) {
  const PX = 2; // each design pixel = 2x2 screen pixels
  const color = parseInt(bodyColorHex.slice(1), 16);
  const bodyDark = darkenColor(color, 0.35);
  const bodyLight = lightenColor(color, 0.15);
  const skin = 0xEAC4A0;
  const skinShade = 0xD4A878;
  const hair = 0x3D2B1F;
  const outline = 0x1A1A2E;
  const white = 0xFFFFFF;

  g.clear();

  // --- Shadow ---
  g.beginFill(0x000000, 0.25);
  g.drawEllipse(0, 0, 13, 5);
  g.endFill();

  // Helper: filled rect in PX units, y goes up (negative = up)
  const px = (x: number, y: number, w: number, h: number, c: number) => {
    g.beginFill(c);
    g.drawRect(x * PX, y * PX, w * PX, h * PX);
    g.endFill();
  };

  // --- Shoes (bottom) ---
  px(-6, -2, 4, 2, outline);     // left shoe
  px(1, -2, 4, 2, outline);      // right shoe

  // --- Legs (pants) ---
  px(-5, -8, 3, 6, bodyDark);    // left leg
  px(1, -8, 3, 6, bodyDark);     // right leg
  // Leg outline
  px(-6, -8, 1, 6, outline);     // left leg outer
  px(4, -8, 1, 6, outline);      // right leg outer

  // --- Belt ---
  px(-6, -9, 11, 1, darkenColor(color, 0.5));

  // --- Body (shirt) ---
  px(-6, -18, 11, 9, color);
  // Shirt highlight (3/4 lighting)
  px(-4, -17, 3, 3, bodyLight);
  // Shirt shadow (right side)
  px(3, -17, 2, 8, darkenColor(color, 0.15));
  // Body outline
  px(-7, -18, 1, 10, outline);   // left edge
  px(5, -18, 1, 10, outline);    // right edge
  px(-6, -19, 11, 1, outline);   // top edge

  // --- Arms (skin colored, at sides) ---
  px(-9, -17, 2, 8, skin);       // left arm
  px(6, -17, 2, 8, skin);        // right arm
  // Hands
  px(-9, -9, 2, 2, skin);        // left hand
  px(6, -9, 2, 2, skin);         // right hand
  // Arm outlines
  px(-10, -17, 1, 10, outline);
  px(8, -17, 1, 10, outline);

  // --- Neck ---
  px(-2, -21, 3, 2, skin);

  // --- Head ---
  px(-6, -30, 11, 9, skin);
  // Head shadow (right side for 3/4 depth)
  px(3, -29, 2, 7, skinShade);
  // Head outline
  px(-7, -30, 1, 9, outline);    // left
  px(5, -30, 1, 9, outline);     // right
  px(-6, -31, 11, 1, outline);   // top
  px(-6, -21, 11, 1, outline);   // bottom (jaw)
  // Chin curve
  px(-6, -22, 1, 1, outline);
  px(4, -22, 1, 1, outline);

  // --- Hair ---
  px(-6, -34, 12, 4, hair);      // hair top block
  px(-7, -33, 1, 5, hair);       // hair left side
  px(6, -33, 1, 3, hair);        // hair right side
  // Hair highlight
  px(-4, -33, 3, 1, lightenColor(hair, 0.25));

  // --- Eyes ---
  // Left eye: white + pupil
  px(-4, -27, 2, 2, white);
  px(-3, -27, 1, 2, outline);    // pupil
  // Right eye: white + pupil
  px(1, -27, 2, 2, white);
  px(2, -27, 1, 2, outline);     // pupil

  // --- Mouth ---
  px(-2, -24, 3, 1, skinShade);
}

// Mini Habbo avatar component for chat bubbles and logs (CSS-based pixel art)
function MiniHabboAvatar({ bodyColor, size = 24 }: { bodyColor: string; size?: number }) {
  const px = size / 12; // base pixel unit
  const hairColor = '#3D2B1F';
  const skin = '#EAC4A0';
  const outline = '#1A1A2E';
  
  return (
    <div style={{
      width: size,
      height: size,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Hair */}
      <div style={{ 
        height: px * 2, 
        background: hairColor,
        borderLeft: `${px}px solid ${outline}`,
        borderRight: `${px}px solid ${outline}`,
        borderTop: `${px}px solid ${outline}`,
      }} />
      {/* Head */}
      <div style={{ 
        height: px * 5, 
        background: skin,
        borderLeft: `${px}px solid ${outline}`,
        borderRight: `${px}px solid ${outline}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px * 2,
      }}>
        {/* Eyes */}
        <div style={{ width: px * 1.5, height: px * 1.5, background: outline }} />
        <div style={{ width: px * 1.5, height: px * 1.5, background: outline }} />
      </div>
      {/* Body */}
      <div style={{ 
        flex: 1, 
        background: bodyColor,
        borderLeft: `${px}px solid ${outline}`,
        borderRight: `${px}px solid ${outline}`,
        borderBottom: `${px}px solid ${outline}`,
      }} />
    </div>
  );
}

// Large Habbo avatar for profile modal (CSS-based pixel art)
function LargeHabboAvatar({ bodyColor }: { bodyColor: string }) {
  const px = 3; // pixel unit for large avatar
  const hairColor = '#3D2B1F';
  const skin = '#EAC4A0';
  const skinShade = '#D4A878';
  const outline = '#1A1A2E';
  const bodyDark = (() => {
    const c = parseInt(bodyColor.slice(1), 16);
    const r = Math.max(0, ((c >> 16) & 0xFF) * 0.65);
    const g = Math.max(0, ((c >> 8) & 0xFF) * 0.65);
    const b = Math.max(0, (c & 0xFF) * 0.65);
    return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
  })();

  return (
    <div style={{
      width: 60,
      height: 90,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      {/* Hair */}
      <div style={{
        width: px * 12,
        height: px * 4,
        background: hairColor,
        border: `${px}px solid ${outline}`,
        borderBottom: 'none',
      }} />
      {/* Head */}
      <div style={{
        width: px * 12,
        height: px * 9,
        background: skin,
        borderLeft: `${px}px solid ${outline}`,
        borderRight: `${px}px solid ${outline}`,
        position: 'relative',
      }}>
        {/* Head shadow */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: px,
          width: px * 2,
          height: px * 7,
          background: skinShade,
        }} />
        {/* Eyes */}
        <div style={{
          position: 'absolute',
          top: px * 3,
          left: px * 2,
          width: px * 2,
          height: px * 2,
          background: '#fff',
        }} />
        <div style={{
          position: 'absolute',
          top: px * 3,
          left: px * 3,
          width: px,
          height: px * 2,
          background: outline,
        }} />
        <div style={{
          position: 'absolute',
          top: px * 3,
          right: px * 3,
          width: px * 2,
          height: px * 2,
          background: '#fff',
        }} />
        <div style={{
          position: 'absolute',
          top: px * 3,
          right: px * 3,
          width: px,
          height: px * 2,
          background: outline,
        }} />
        {/* Mouth */}
        <div style={{
          position: 'absolute',
          bottom: px * 2,
          left: '50%',
          transform: 'translateX(-50%)',
          width: px * 3,
          height: px,
          background: skinShade,
        }} />
      </div>
      {/* Neck */}
      <div style={{
        width: px * 4,
        height: px * 2,
        background: skin,
      }} />
      {/* Body */}
      <div style={{
        width: px * 12,
        height: px * 8,
        background: bodyColor,
        border: `${px}px solid ${outline}`,
        borderBottom: 'none',
        position: 'relative',
      }}>
        {/* Arms */}
        <div style={{
          position: 'absolute',
          left: -px * 3,
          top: 0,
          width: px * 2,
          height: px * 7,
          background: skin,
          borderLeft: `${px}px solid ${outline}`,
        }} />
        <div style={{
          position: 'absolute',
          right: -px * 3,
          top: 0,
          width: px * 2,
          height: px * 7,
          background: skin,
          borderRight: `${px}px solid ${outline}`,
        }} />
      </div>
      {/* Legs */}
      <div style={{
        width: px * 12,
        display: 'flex',
        justifyContent: 'center',
        gap: px,
      }}>
        <div style={{
          width: px * 3,
          height: px * 5,
          background: bodyDark,
          border: `${px}px solid ${outline}`,
          borderTop: 'none',
        }} />
        <div style={{
          width: px * 3,
          height: px * 5,
          background: bodyDark,
          border: `${px}px solid ${outline}`,
          borderTop: 'none',
        }} />
      </div>
    </div>
  );
}

// Habbo-style stacking chat bubbles
interface FloatingBubble {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  x: number;           // Screen X position
  slot: number;        // Stack slot (0 = bottom, increases going up)
  timestamp: number;
  bodyColor: string;   // Avatar body color for mini profile pic
}

const BUBBLE_HEIGHT = 36;      // Height of each bubble including spacing
const BUBBLE_BASE_Y = 220;     // Y position for slot 0 (mobile only)
const BUBBLE_LIFETIME = 12000; // 12 seconds before disappearing
const MAX_BUBBLES = 12;        // Max bubbles on screen
const NAVBAR_HEIGHT = 60;      // Height of navbar area

// Set to true to show mock bubbles for testing
const MOCK_ENABLED = false;

function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floatingBubbles, setFloatingBubbles] = useState<FloatingBubble[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [botsRunning, setBotsRunning] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navigatorTab, setNavigatorTab] = useState<'popular' | 'spectated' | 'search'>('popular');
  const [activeRooms, setActiveRooms] = useState<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[]>([]);
  const [spectatedRooms, setSpectatedRooms] = useState<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number; ownerName?: string }[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [totalAgents, setTotalAgents] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<{
    id: string;
    username: string;
    bodyColor: string;
    createdAt: string;
  } | null>(null);
  const [_profileLoading, setProfileLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);
  const smoothPositions = useRef<Map<string, SmoothPosition>>(new Map());
  const [, forceUpdate] = useState(0); // For triggering re-renders

  // Check bot status on load
  useEffect(() => {
    fetch('/api/bots/status')
      .then(res => res.json())
      .then(data => setBotsRunning(data.running))
      .catch(() => {});
  }, []);

  // Fetch rooms periodically
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        // Fetch popular rooms
        const activeRes = await fetch('/api/rooms/active');
        const activeData = await activeRes.json();
        const roomsData = activeData.rooms || [];
        const seen = new Set<string>();
        const uniqueRooms = roomsData.filter((r: typeof activeRooms[0]) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        setActiveRooms(uniqueRooms);
        setTotalAgents(uniqueRooms.reduce((sum: number, r: typeof activeRooms[0]) => sum + r.agentCount, 0));
        
        // Fetch most spectated rooms
        const spectatedRes = await fetch('/api/rooms/spectated');
        const spectatedData = await spectatedRes.json();
        setSpectatedRooms(spectatedData.rooms || []);
      } catch {
        // ignore
      }
    };
    
    fetchRooms();
    const interval = setInterval(fetchRooms, 3000);
    return () => clearInterval(interval);
  }, []);

  // Search rooms with debounce
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rooms/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data.rooms || []);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Fetch and show user profile
  const showProfile = async (agentId: string) => {
    setProfileLoading(true);
    try {
      const res = await fetch(`/api/users/${agentId}/profile`);
      if (res.ok) {
        const data = await res.json();
        setSelectedProfile(data);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  // Switch room function
  const switchRoom = (roomId: string) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      // Clear current room state
      setAgents([]);
      setMessages([]);
      setFloatingBubbles([]);
      smoothPositions.current.clear();
      
      // Join new room
      wsRef.current.send(JSON.stringify({ type: 'join', roomId }));
    }
  };

  // Toggle bots
  const toggleBots = async () => {
    setBotsLoading(true);
    try {
      const res = await fetch('/api/bots/toggle', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBotsRunning(!botsRunning);
      }
    } catch (err) {
      console.error('Failed to toggle bots:', err);
    } finally {
      setBotsLoading(false);
    }
  };

  // Auto-scroll chat log to bottom when new messages arrive
  useEffect(() => {
    if (chatLogRef.current && shouldAutoScroll.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [messages]);

  // Scroll to bottom when chat is opened
  useEffect(() => {
    if (chatOpen && chatLogRef.current) {
      // Small delay to ensure the element is visible and has height
      setTimeout(() => {
        if (chatLogRef.current) {
          chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
          shouldAutoScroll.current = true;
        }
      }, 50);
    }
  }, [chatOpen]);

  // Handle chat log scroll - check if user is at bottom
  const handleChatScroll = () => {
    if (chatLogRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatLogRef.current;
      // Consider "at bottom" if within 50px of the bottom
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
    }
  };

  // Smooth movement animation loop
  useEffect(() => {
    let animationId: number;
    let lastTime = performance.now();
    
    const animate = (now: number) => {
      const dt = (now - lastTime) / 1000; // delta in seconds
      lastTime = now;
      let needsUpdate = false;
      
      smoothPositions.current.forEach((pos) => {
        if (pos.waypoints.length === 0) return;
        
        let remaining = pos.speed * dt; // tiles to move this frame
        
        while (remaining > 0 && pos.waypoints.length > 0) {
          const target = pos.waypoints[0];
          const dx = target.x - pos.currentX;
          const dy = target.y - pos.currentY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= remaining) {
            // Reach this waypoint, move to next
            pos.currentX = target.x;
            pos.currentY = target.y;
            pos.waypoints.shift();
            remaining -= distance;
          } else {
            // Move toward waypoint
            pos.currentX += (dx / distance) * remaining;
            pos.currentY += (dy / distance) * remaining;
            remaining = 0;
          }
          needsUpdate = true;
        }
      });
      
      if (needsUpdate) {
        forceUpdate(n => n + 1);
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  // Initialize smooth positions for new agents, clean up departed ones
  useEffect(() => {
    agents.forEach(agent => {
      if (!smoothPositions.current.has(agent.id)) {
        smoothPositions.current.set(agent.id, {
          currentX: agent.x,
          currentY: agent.y,
          waypoints: [],
          speed: 4,
        });
      }
    });
    
    // Clean up agents that left
    smoothPositions.current.forEach((_, agentId) => {
      if (!agents.find(a => a.id === agentId)) {
        smoothPositions.current.delete(agentId);
      }
    });
  }, [agents]);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mock bubbles for testing (remove in production)
  useEffect(() => {
    if (MOCK_ENABLED && floatingBubbles.length === 0) {
      const now = Date.now();
      setFloatingBubbles([
        { id: '1', agentId: 'a1', agentName: 'Alice', content: 'Hello world!', x: -100, slot: 0, timestamp: now, bodyColor: '#E74C3C' },
        { id: '2', agentId: 'a2', agentName: 'Bob', content: 'This is a longer message to test', x: 50, slot: 1, timestamp: now - 500, bodyColor: '#3498DB' },
        { id: '3', agentId: 'a3', agentName: 'Charlie', content: 'Hi', x: 150, slot: 2, timestamp: now - 1000, bodyColor: '#2ECC71' },
        { id: '4', agentId: 'a4', agentName: 'Diana', content: 'Testing the bubble width!', x: -50, slot: 3, timestamp: now - 1500, bodyColor: '#9B59B6' },
      ]);
    }
  }, []);

  // Manage bubble slots - remove expired and re-slot remaining
  useEffect(() => {
    const interval = setInterval(() => {
      setFloatingBubbles(prev => {
        const now = Date.now();
        const active = prev.filter(b => now - b.timestamp < BUBBLE_LIFETIME);
        // Re-assign slots based on age (newest = slot 0)
        return active
          .sort((a, b) => b.timestamp - a.timestamp) // Newest first
          .map((bubble, index) => ({ ...bubble, slot: index }));
      });
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Connect to WebSocket as spectator with auto-reconnect
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRoomRef = useRef<string>('lobby');
  
  // Keep currentRoomRef in sync
  useEffect(() => {
    if (currentRoomId) {
      // Find the slug for this room
      const roomSlug = room?.slug || activeRooms.find(r => r.id === currentRoomId)?.slug;
      if (roomSlug) currentRoomRef.current = roomSlug;
    }
  }, [currentRoomId, room, activeRooms]);

  useEffect(() => {
    let disposed = false;
    
    function connect() {
      if (disposed) return;
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log('Connecting to', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to Bottel');
        setConnected(true);
        reconnectAttempts.current = 0;
        // Rejoin the room we were in (or lobby on first connect)
        ws.send(JSON.stringify({ type: 'join', roomId: currentRoomRef.current }));
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        handleMessage(msg);
      };

      ws.onclose = () => {
        console.log('Disconnected');
        setConnected(false);
        wsRef.current = null;
        
        if (!disposed) {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})...`);
          reconnectAttempts.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    }
    
    connect();
    
    // Client-side keepalive ping every 25s to prevent proxy idle timeouts
    const keepalive = setInterval(() => {
      if (wsRef.current?.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25_000);
    
    // Instant reconnect when tab regains focus (if connection died)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== 1) {
        console.log('Tab visible, connection dead — reconnecting now');
        reconnectAttempts.current = 0;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      clearInterval(keepalive);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'room_state':
        setRoom(msg.room);
        setAgents(msg.agents);
        setMessages(msg.messages);
        setCurrentRoomId(msg.room.id);
        break;

      case 'agent_joined':
        setAgents((prev) => {
          // Avoid duplicates - remove any existing agent with same ID first
          const filtered = prev.filter((a) => a.id !== msg.agent.id);
          return [...filtered, msg.agent];
        });
        break;

      case 'agent_left':
        setAgents((prev) => prev.filter((a) => a.id !== msg.agentId));
        break;

      case 'agent_moved':
        setAgents((prev) =>
          prev.map((a) =>
            a.id === msg.agentId ? { ...a, x: msg.x, y: msg.y } : a
          )
        );
        // Teleport smooth position (for instant moves)
        {
          const sp = smoothPositions.current.get(msg.agentId);
          if (sp) {
            sp.currentX = msg.x;
            sp.currentY = msg.y;
            sp.waypoints = [];
          }
        }
        break;

      case 'agent_path':
        // Queue waypoints for smooth animation
        {
          const sp = smoothPositions.current.get(msg.agentId);
          if (sp) {
            sp.waypoints = [...msg.path];
            sp.speed = msg.speed || 4;
          }
          // Update logical position to final destination
          const dest = msg.path[msg.path.length - 1];
          if (dest) {
            setAgents((prev) =>
              prev.map((a) =>
                a.id === msg.agentId ? { ...a, x: dest.x, y: dest.y } : a
              )
            );
          }
        }
        break;

      case 'chat_message':
        setMessages((prev) => [
          ...prev.slice(-49),
          {
            id: msg.id,
            roomId: msg.roomId || '',
            agentId: msg.agentId,
            agentName: msg.agentName,
            avatarConfig: msg.avatarConfig,
            content: msg.content,
            createdAt: new Date(msg.timestamp),
          },
        ]);
        
        setAgents(currentAgents => {
          const agent = currentAgents.find(a => a.id === msg.agentId);
          if (agent) {
            const screenPos = toScreen(agent.x, agent.y);
            setFloatingBubbles(prev => {
              // Push all existing bubbles up by incrementing their slot
              const pushed = prev.map(b => ({ ...b, slot: b.slot + 1 }));
              // Add new bubble at slot 0, limit total bubbles
              const newBubble: FloatingBubble = {
                id: msg.id,
                agentId: msg.agentId,
                agentName: msg.agentName,
                content: msg.content,
                x: screenPos.x,
                slot: 0,
                timestamp: Date.now(),
                bodyColor: msg.avatarConfig?.bodyColor || agent.avatar.bodyColor,
              };
              return [newBubble, ...pushed].slice(0, MAX_BUBBLES);
            });
          }
          return currentAgents;
        });
        break;
    }
  }, []);

  const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;
  
  // Calculate scale to fit room on screen
  // Room is 20x20 tiles, isometric diamond shape
  const roomWidth = 20 * TILE_WIDTH; // 1280px at full scale
  const roomHeight = 20 * TILE_HEIGHT + 100; // ~740px including avatars
  const scaleX = (width * 0.95) / roomWidth;
  const scaleY = ((height - 60) * (isMobile ? 0.85 : 0.55)) / roomHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
  
  // Position room - mobile: higher up, desktop: much lower for chat bubble space
  const scaledRoomHeight = roomHeight * scale;
  const offsetX = width / 2;
  const offsetY = isMobile 
    ? (height - scaledRoomHeight) * 0.65 + 20  // Mobile: 65% down
    : height - scaledRoomHeight - 40;           // Desktop: near bottom with 40px margin
  
  // Bubble base Y - relative to room position (more gap on desktop)
  const bubbleBaseY = isMobile ? BUBBLE_BASE_Y : offsetY - 100;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Connecting overlay */}
      {!connected && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: '#000',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        }}>
          <div style={{
            fontSize: isMobile ? 16 : 24,
            fontFamily: '"Press Start 2P", monospace',
            letterSpacing: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <IconHotel size={isMobile ? 28 : 36} color="#FF4D4D" /> BOTTEL
          </div>
          <div style={{
            display: 'flex',
            gap: 6,
          }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  background: '#fff',
                  animation: `pixelBlink 1s ${i * 0.2}s infinite steps(1)`,
                }}
              />
            ))}
          </div>
          <div style={{
            fontSize: 11,
            fontFamily: '"IBM Plex Mono", monospace',
            opacity: 0.5,
            marginTop: 4,
          }}>
            connecting...
          </div>
          <style>{`
            @keyframes pixelBlink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.2; }
            }
          `}</style>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: isMobile ? 'auto' : 'auto',
          paddingTop: isMobile ? 'max(env(safe-area-inset-top, 0px), 48px)' : 16,
          paddingBottom: isMobile ? 10 : 16,
          paddingLeft: 16,
          paddingRight: 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 12,
          background: isMobile ? 'rgba(0,0,0,0.8)' : 'transparent',
          
        }}
      >
        <h1 style={{ fontSize: isMobile ? 12 : 18, fontWeight: 'bold', fontFamily: '"Press Start 2P", monospace', letterSpacing: 2, display: 'flex', alignItems: 'center', gap: 8 }}><IconHotel size={isMobile ? 16 : 22} color="#FF4D4D" />{!isMobile && 'BOTTEL'}</h1>
        {/* Room title + info button on mobile */}
        {isMobile && room && (
          <div style={{ 
            marginLeft: 'auto', 
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{ 
              fontSize: 12, 
              fontWeight: 600,
              maxWidth: 90,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {room.name}
            </span>
            <button
              onClick={() => setShowRoomInfo(!showRoomInfo)}
              style={{ 
                background: showRoomInfo ? '#FF4D4D' : '#222',
                border: 'none',
                borderRadius: 0,
                width: 24,
                height: 24,
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                padding: 0,
              }}
            >
              <IconInfo size={14} />
            </button>
          </div>
        )}
        {!isMobile && (
          <button
            onClick={toggleBots}
            disabled={botsLoading}
            style={{
              background: botsRunning ? '#991b1b' : '#FF4D4D',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 0,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: botsLoading ? 'wait' : 'pointer',
              opacity: botsLoading ? 0.7 : 1,
              
            }}
          >
            {botsLoading ? '...' : botsRunning ? 'Stop Bots' : 'Start Bots'}
          </button>
        )}
      </div>

      {/* Mobile bottom navigation bar */}
      {isMobile && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 'calc(60px + env(safe-area-inset-bottom, 0px))',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            background: '#1a1a1a',
            
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            zIndex: 20,
            borderTop: '2px solid #333',
          }}
        >
          <button
            onClick={() => { setNavigatorOpen(!navigatorOpen); setChatOpen(false); }}
            style={{
              background: navigatorOpen ? '#FF4D4D' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 0,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconDoor size={20} />
            <span>Rooms</span>
          </button>
          <button
            onClick={() => { setChatOpen(!chatOpen); setNavigatorOpen(false); setConnectModalOpen(false); }}
            style={{
              background: chatOpen ? '#FF4D4D' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 0,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconChat size={20} />
            <span>Chat</span>
          </button>
          <button
            onClick={() => { setConnectModalOpen(!connectModalOpen); setChatOpen(false); setNavigatorOpen(false); }}
            style={{
              background: connectModalOpen ? '#FF4D4D' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 0,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconLink size={20} />
            <span>Connect</span>
          </button>
          <button
            onClick={() => { setInfoModalOpen(!infoModalOpen); setChatOpen(false); setNavigatorOpen(false); setConnectModalOpen(false); }}
            style={{
              background: infoModalOpen ? '#FF4D4D' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 0,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconChart size={20} />
            <span>Info</span>
          </button>
          <button
            onClick={toggleBots}
            disabled={botsLoading}
            style={{
              background: botsRunning ? '#991b1b' : 'transparent',
              border: 'none',
              padding: '10px 16px',
              borderRadius: 0,
              color: botsRunning ? '#fff' : '#FF4D4D',
              fontSize: 13,
              cursor: botsLoading ? 'wait' : 'pointer',
              opacity: botsLoading ? 0.7 : 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <IconZap size={20} />
            <span>{botsLoading ? '...' : botsRunning ? 'Stop' : 'Bots'}</span>
          </button>
        </div>
      )}

      {/* Chat bubbles overlay (HTML for better text rendering) */}
      {/* Chat bubbles — stacked from room top, newest at bottom */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: isMobile ? '100%' : bubbleBaseY + 50,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 5,
        }}
      >
        {(() => {
          // On mobile: stack as a column near the room top area
          // On desktop: absolute position at room coordinates
          const mobileBubbleTop = offsetY - 60; // start just above the room
          const MOBILE_LINE_H = 28; // height per bubble line on mobile
          
          return floatingBubbles
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp) // oldest first (top), newest last (bottom)
            .map((bubble, index) => {
              const cleanName = bubble.agentName.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
              
              if (isMobile) {
                // Mobile: stack in a centered column from room top, going up
                const y = mobileBubbleTop - (index * MOBILE_LINE_H);
                
                // Fade near top of screen
                const fadeStartY = 80;
                const fadeEndY = 40;
                let opacity = 1;
                if (y < fadeStartY) {
                  opacity = Math.max(0, (y - fadeEndY) / (fadeStartY - fadeEndY));
                }
                if (opacity <= 0) return null;
                
                return (
                  <div
                    key={bubble.id}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: y,
                      transform: 'translateX(-50%)',
                      opacity,
                      transition: 'top 0.3s ease-out, opacity 0.3s ease-out',
                      background: 'rgba(255, 255, 255, 0.95)',
                      padding: '3px 8px 3px 4px',
                      border: '2px solid #000',
                      fontSize: 11,
                      fontFamily: '"IBM Plex Mono", "Courier New", monospace',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '88vw',
                      color: '#1a1a2e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    <MiniHabboAvatar bodyColor={bubble.bodyColor} size={18} />
                    <span style={{ fontWeight: 600, flexShrink: 0 }}>{cleanName}:</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{bubble.content}</span>
                  </div>
                );
              } else {
                // Desktop: absolute position at room screen coordinates
                const y = bubbleBaseY - (bubble.slot * BUBBLE_HEIGHT);
                
                const fadeStartY = 100;
                const fadeEndY = NAVBAR_HEIGHT;
                let opacity = 1;
                if (y < fadeStartY) {
                  opacity = Math.max(0, (y - fadeEndY) / (fadeStartY - fadeEndY));
                }
                
                const screenX = offsetX + (bubble.x * scale);
                if (opacity <= 0) return null;
                
                return (
                  <div
                    key={bubble.id}
                    style={{
                      position: 'absolute',
                      left: screenX,
                      top: y,
                      transform: 'translateX(-50%)',
                      opacity,
                      transition: 'top 0.3s ease-out, opacity 0.3s ease-out',
                      background: 'rgba(255, 255, 255, 0.95)',
                      padding: '5px 12px 5px 6px',
                      border: '2px solid #000',
                      fontSize: 13,
                      fontFamily: '"IBM Plex Mono", "Courier New", monospace',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      maxWidth: 400,
                      color: '#1a1a2e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <MiniHabboAvatar bodyColor={bubble.bodyColor} size={24} />
                    <div>
                      <span style={{ fontWeight: 600 }}>{cleanName}:</span>{' '}
                      <span>{bubble.content}</span>
                    </div>
                  </div>
                );
              }
            });
        })()}
      </div>

      {/* PixiJS Canvas */}
      <Stage
        width={width}
        height={height}
        options={{ background: 0x000000, antialias: true }}
      >
        {/* Room container - scaled to fit screen */}
        <Container x={offsetX} y={offsetY} scale={scale}>
          {/* Render walls (behind everything) */}
          {room && (() => {
            const WALL_HEIGHT = 110;
            const w = room.width;
            const h = room.height;
            
            // Key room corners in screen space
            const topCorner = toScreen(0, 0);         // top of diamond
            const leftCorner = toScreen(0, h - 1);    // bottom-left of diamond
            const rightCorner = toScreen(w - 1, 0);   // bottom-right of diamond
            
            // Left wall edge points (outer edge of x=0 column)
            const leftWallTop = { x: topCorner.x - TILE_WIDTH / 2, y: topCorner.y };
            const leftWallBottom = { x: leftCorner.x - TILE_WIDTH / 2, y: leftCorner.y };
            
            // Back wall edge points (outer edge of y=0 row)
            const backWallTop = { x: topCorner.x, y: topCorner.y - TILE_HEIGHT / 2 };
            const backWallRight = { x: rightCorner.x + TILE_WIDTH / 2, y: rightCorner.y };
            
            return (
              <Graphics
                key="walls"
                draw={(g) => {
                  g.clear();
                  
                  // Left wall face (darker)
                  g.beginFill(0x2a2a44);
                  g.moveTo(leftWallBottom.x, leftWallBottom.y);                    // bottom-left
                  g.lineTo(leftCorner.x, leftCorner.y - TILE_HEIGHT / 2);          // bottom-right (inner edge)
                  g.lineTo(backWallTop.x, backWallTop.y);                           // top-right (inner edge, at corner)
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);             // top-right raised
                  g.lineTo(leftWallTop.x, leftWallTop.y - WALL_HEIGHT);             // top-left raised
                  g.lineTo(leftWallBottom.x, leftWallBottom.y - WALL_HEIGHT);       // bottom-left raised
                  g.closePath();
                  g.endFill();
                  
                  // Left wall horizontal lines (brick effect)
                  g.lineStyle(1, 0x222240, 0.4);
                  for (let i = 1; i < Math.floor(WALL_HEIGHT / 20); i++) {
                    const yOff = i * 20;
                    g.moveTo(leftWallBottom.x, leftWallBottom.y - yOff);
                    g.lineTo(leftWallTop.x, leftWallTop.y - yOff);
                    g.lineTo(backWallTop.x, backWallTop.y - yOff);
                  }
                  
                  // Back wall face (lighter for depth)
                  g.lineStyle(0);
                  g.beginFill(0x33335a);
                  g.moveTo(backWallTop.x, backWallTop.y);                           // top-left (inner, at corner)
                  g.lineTo(backWallRight.x, backWallRight.y);                        // bottom-right
                  g.lineTo(backWallRight.x, backWallRight.y - WALL_HEIGHT);          // bottom-right raised
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);              // top-left raised
                  g.closePath();
                  g.endFill();
                  
                  // Back wall horizontal lines (brick effect)
                  g.lineStyle(1, 0x2a2a50, 0.4);
                  for (let i = 1; i < Math.floor(WALL_HEIGHT / 20); i++) {
                    const yOff = i * 20;
                    g.moveTo(backWallTop.x, backWallTop.y - yOff);
                    g.lineTo(backWallRight.x, backWallRight.y - yOff);
                  }
                  
                  // Corner vertical edge
                  g.lineStyle(2, 0x4a4a6a, 0.8);
                  g.moveTo(backWallTop.x, backWallTop.y);
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);
                  
                  // Outer left edge
                  g.lineStyle(1, 0x1a1a30, 0.6);
                  g.moveTo(leftWallBottom.x, leftWallBottom.y);
                  g.lineTo(leftWallBottom.x, leftWallBottom.y - WALL_HEIGHT);
                  
                  // Outer right edge
                  g.moveTo(backWallRight.x, backWallRight.y);
                  g.lineTo(backWallRight.x, backWallRight.y - WALL_HEIGHT);
                  
                  // Wall top caps (thickness visible from above)
                  const WT = 10; // wall thickness in pixels
                  
                  // Left wall top cap — thickness extends into room (+x iso direction)
                  g.lineStyle(0);
                  g.beginFill(0x3a3a60);
                  g.moveTo(leftWallBottom.x, leftWallBottom.y - WALL_HEIGHT);
                  g.lineTo(leftWallTop.x, leftWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallTop.x + WT, backWallTop.y - WALL_HEIGHT + WT / 2);
                  g.lineTo(leftWallTop.x + WT, leftWallTop.y - WALL_HEIGHT + WT / 2);
                  g.lineTo(leftWallBottom.x + WT, leftWallBottom.y - WALL_HEIGHT + WT / 2);
                  g.closePath();
                  g.endFill();
                  
                  // Back wall top cap — thickness extends into room (+y iso direction)
                  g.beginFill(0x444478);
                  g.moveTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallRight.x, backWallRight.y - WALL_HEIGHT);
                  g.lineTo(backWallRight.x - WT, backWallRight.y - WALL_HEIGHT + WT / 2);
                  g.lineTo(backWallTop.x - WT, backWallTop.y - WALL_HEIGHT + WT / 2);
                  g.closePath();
                  g.endFill();
                  
                  // Corner cap piece where walls meet
                  g.beginFill(0x4a4a80);
                  g.moveTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallTop.x + WT, backWallTop.y - WALL_HEIGHT + WT / 2);
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT + WT);
                  g.lineTo(backWallTop.x - WT, backWallTop.y - WALL_HEIGHT + WT / 2);
                  g.closePath();
                  g.endFill();
                  
                  // Top edge outlines
                  g.lineStyle(1, 0x4a4a70, 0.5);
                  g.moveTo(leftWallBottom.x, leftWallBottom.y - WALL_HEIGHT);
                  g.lineTo(leftWallTop.x, leftWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallTop.x, backWallTop.y - WALL_HEIGHT);
                  g.lineTo(backWallRight.x, backWallRight.y - WALL_HEIGHT);
                }}
              />
            );
          })()}

          {/* Render floor tiles with 3D depth */}
          {room &&
            room.tiles.map((row, y) =>
              row.map((tile, x) => {
                const pos = toScreen(x, y);
                
                if (tile !== 0) return null;
                const isAlt = (x + y) % 2 === 0;
                const DEPTH = 12;
                return (
                  <Graphics
                    key={`tile-${x}-${y}`}
                    x={pos.x}
                    y={pos.y}
                    draw={(g) => {
                      g.clear();
                      
                      // Left side face (south-west, darkest)
                      g.beginFill(isAlt ? 0x2e2e55 : 0x383868);
                      g.moveTo(-TILE_WIDTH / 2, 0);
                      g.lineTo(0, TILE_HEIGHT / 2);
                      g.lineTo(0, TILE_HEIGHT / 2 + DEPTH);
                      g.lineTo(-TILE_WIDTH / 2, DEPTH);
                      g.closePath();
                      g.endFill();
                      
                      // Right side face (south-east, medium dark)
                      g.beginFill(isAlt ? 0x3d3d6a : 0x4a4a7a);
                      g.moveTo(TILE_WIDTH / 2, 0);
                      g.lineTo(0, TILE_HEIGHT / 2);
                      g.lineTo(0, TILE_HEIGHT / 2 + DEPTH);
                      g.lineTo(TILE_WIDTH / 2, DEPTH);
                      g.closePath();
                      g.endFill();
                      
                      // Top face (brightest)
                      g.beginFill(isAlt ? 0x5c5c8a : 0x6a6a9a);
                      g.lineStyle(1, 0x7a7aaa, 0.3);
                      g.moveTo(0, -TILE_HEIGHT / 2);
                      g.lineTo(TILE_WIDTH / 2, 0);
                      g.lineTo(0, TILE_HEIGHT / 2);
                      g.lineTo(-TILE_WIDTH / 2, 0);
                      g.closePath();
                      g.endFill();
                    }}
                  />
                );
              })
            )}

          {/* Render agents */}
          {agents
            .slice()
            .sort((a, b) => a.x + a.y - (b.x + b.y))
            .map((agent) => {
              // Use smooth interpolated position
              const smoothPos = smoothPositions.current.get(agent.id);
              const displayX = smoothPos?.currentX ?? agent.x;
              const displayY = smoothPos?.currentY ?? agent.y;
              const pos = toScreen(displayX, displayY);

              const isSelected = selectedProfile?.id === agent.id;
              
              return (
                <Container 
                  key={agent.id} 
                  x={pos.x} 
                  y={pos.y}
                  eventMode="static"
                  cursor="pointer"
                  pointerdown={() => showProfile(agent.id)}
                >
                  {/* Habbo-style pixel art avatar */}
                  <Graphics
                    draw={(g) => drawHabboAvatar(g, agent.avatar.bodyColor)}
                  />
                  
                  {/* Name label */}
                  <Container y={-72}>
                    <Graphics
                      draw={(g) => {
                        g.clear();
                        const nameWidth = agent.name.length * 7 + 14;
                        g.beginFill(0x000000, 0.75);
                        g.drawRect(-nameWidth / 2, -10, nameWidth, 18);
                        g.endFill();
                      }}
                    />
                    <Text
                      text={agent.name}
                      anchor={0.5}
                      style={new TextStyle({
                        fontSize: 10,
                        fill: 0xffffff,
                        fontFamily: '"Press Start 2P", "IBM Plex Mono", monospace',
                        fontWeight: 'bold',
                      })}
                    />
                  </Container>
                  
                  {/* Selection arrow indicator */}
                  {isSelected && (
                    <Container y={-90}>
                      <Graphics
                        draw={(g) => {
                          g.clear();
                          // Pixel art arrow pointing down
                          g.beginFill(0x3B82F6);
                          g.drawRect(-6, -8, 12, 4);  // top bar
                          g.drawRect(-4, -4, 8, 4);   // middle
                          g.drawRect(-2, 0, 4, 4);    // bottom point
                          g.endFill();
                        }}
                      />
                    </Container>
                  )}
                </Container>
              );
            })}
        </Container>
      </Stage>

      {/* Chat log toggle button (desktop) */}
      {!isMobile && (
        <button
          onClick={() => setChatOpen(!chatOpen)}
          style={{
            position: 'absolute',
            bottom: chatOpen ? 320 : 16,
            right: 16,
            zIndex: 20,
            background: '#1a1a1a',
            border: '2px solid #333',
            padding: '6px 10px',
            borderRadius: 0,
            color: '#fff',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: '"IBM Plex Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconChat size={14} /> {chatOpen ? 'Hide' : 'Show'} Chat
        </button>
      )}

      {/* Chat log - toggleable on both desktop and mobile */}
      <div
        ref={chatLogRef}
        onScroll={handleChatScroll}
        style={{
          position: 'absolute',
          bottom: isMobile ? 60 : 16,
          right: isMobile ? 0 : 16,
          left: isMobile ? 0 : 'auto',
          width: isMobile ? '100%' : 320,
          maxHeight: chatOpen ? (isMobile ? '50vh' : 300) : 0,
          background: 'rgba(0,0,0,0.95)',
          borderRadius: isMobile ? '16px 16px 0 0' : 12,
          padding: chatOpen ? 16 : 0,
          paddingBottom: chatOpen ? 16 : 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 15,
          
          transition: 'max-height 0.3s ease, padding 0.3s ease',
        }}
      >
        {chatOpen && (
          <>
            <h3 style={{ 
              marginBottom: 12, 
              fontSize: 14, 
              opacity: 0.7, 
              textTransform: 'uppercase', 
              letterSpacing: 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              Chat Log
              <span style={{ fontSize: 12, opacity: 0.5 }}>{messages.length} messages</span>
            </h3>
            {messages.slice(-30).map((m) => {
              // Get body color from message's avatar config snapshot
              const bodyColor = m.avatarConfig?.bodyColor || '#666';
              
              return (
                <div key={m.id} style={{ marginBottom: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Mini pixel avatar */}
                  <MiniHabboAvatar bodyColor={bodyColor} size={20} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: '#FF4D4D', fontWeight: 600 }}>{m.agentName}</span>
                    <span style={{ opacity: 0.5 }}>: </span>
                    <span style={{ opacity: 0.9 }}>{m.content}</span>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic' }}>
                Waiting for AIs to chat...
              </div>
            )}
          </>
        )}
      </div>

      {/* Room title + info button (top right) */}
      {room && !isMobile && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: '#1a1a1a',
            border: '2px solid #333',
            borderRadius: 0,
            padding: '8px 12px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: 'none',
          }}
        >
          <span style={{ 
            fontSize: 12, 
            fontWeight: 600,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {room.name}
          </span>
          <button
            onClick={() => setShowRoomInfo(!showRoomInfo)}
            style={{
              background: showRoomInfo ? '#FF4D4D' : '#222',
              border: 'none',
              borderRadius: 0,
              width: 24,
              height: 24,
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: 0,
            }}
          >
            <IconInfo size={14} />
          </button>
        </div>
      )}

      {/* Room info modal */}
      {showRoomInfo && room && (
        <>
          {/* Backdrop to close modal */}
          <div
            onClick={() => setShowRoomInfo(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 29,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: isMobile ? 60 : 70,
              right: isMobile ? 8 : 16,
              left: isMobile ? 8 : 'auto',
              width: isMobile ? 'auto' : 280,
              background: 'rgba(0,0,0,0.95)',
              borderRadius: 0,
              padding: 16,
              zIndex: 30,
              
              boxShadow: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{room.name}</div>
              <button
                onClick={() => setShowRoomInfo(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: 16,
                  cursor: 'pointer',
                  opacity: 0.6,
                  padding: 4,
                }}
              >
                <IconClose size={14} />
              </button>
            </div>
            {room.description && (
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12, lineHeight: 1.5 }}>
                {room.description}
              </div>
            )}
            {room.ownerUsername && (
              <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconUser size={14} /> Owner: <span style={{ fontWeight: 500 }}>{room.ownerUsername}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Desktop Dock (Mac-style bottom bar) */}
      {!isMobile && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1a1a1a',
            border: '2px solid #333',
            borderRadius: 0,
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            zIndex: 20,
            boxShadow: 'none',
          }}
        >
          <button
            onClick={() => setNavigatorOpen(!navigatorOpen)}
            style={{
              background: navigatorOpen ? 'rgba(255,77,77,0.3)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: '6px 12px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: '"IBM Plex Mono", monospace',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = navigatorOpen ? 'rgba(255,77,77,0.3)' : 'transparent'}
          >
            <IconDoor size={16} />
            <span>Rooms</span>
          </button>
          <button
            onClick={() => setConnectModalOpen(!connectModalOpen)}
            style={{
              background: connectModalOpen ? 'rgba(255,77,77,0.3)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: '6px 12px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: '"IBM Plex Mono", monospace',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = connectModalOpen ? 'rgba(255,77,77,0.3)' : 'transparent'}
          >
            <IconLink size={16} />
            <span>Connect</span>
          </button>
          <button
            onClick={() => setInfoModalOpen(!infoModalOpen)}
            style={{
              background: infoModalOpen ? 'rgba(255,77,77,0.3)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: '6px 12px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontFamily: '"IBM Plex Mono", monospace',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = infoModalOpen ? 'rgba(255,77,77,0.3)' : 'transparent'}
          >
            <IconChart size={16} />
            <span>Info</span>
          </button>
        </div>
      )}

      {/* Profile Panel - Bottom right like Habbo */}
      {selectedProfile && (
        <div
          style={{
            position: 'absolute',
            bottom: isMobile ? 70 : 16,
            right: isMobile ? 8 : 350,
            width: isMobile ? 'calc(100% - 16px)' : 280,
            background: 'rgba(0,0,0,0.95)',
            borderRadius: 0,
            padding: 16,
            zIndex: 25,
            
            boxShadow: 'none',
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setSelectedProfile(null)}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              opacity: 0.6,
              padding: 4,
            }}
          >
            <IconClose size={14} />
          </button>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* Large pixel avatar preview */}
            <div
              style={{
                width: 80,
                height: 100,
                background: 'rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <LargeHabboAvatar bodyColor={selectedProfile.bodyColor} />
            </div>

            {/* Profile info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                {selectedProfile.username}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconCalendar size={14} />
                Joined: {new Date(selectedProfile.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Room Navigator - Modal for desktop, Sidebar for mobile */}
      {/* Desktop Modal Backdrop */}
      {!isMobile && navigatorOpen && (
        <div
          onClick={() => setNavigatorOpen(false)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 24,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          // Mobile: sidebar from left
          // Desktop: centered modal
          top: isMobile ? 'calc(max(env(safe-area-inset-top, 0px), 48px) + 40px)' : '50%',
          left: isMobile ? (navigatorOpen ? 0 : -280) : '50%',
          bottom: isMobile ? 60 : 'auto',
          transform: isMobile ? 'none' : 'translate(-50%, -50%)',
          width: isMobile ? 280 : 400,
          maxHeight: isMobile ? 'auto' : '70vh',
          background: '#111',
          borderRight: isMobile ? '2px solid #333' : 'none',
          border: isMobile ? 'none' : '2px solid #333',
          borderRightWidth: isMobile ? 2 : 2,
          borderRightStyle: 'solid',
          borderRightColor: '#333',
          borderRadius: 0,
          padding: '16px',
          paddingTop: 16,
          overflow: 'hidden',
          zIndex: isMobile ? 15 : 25,
          
          transition: isMobile ? 'left 0.3s ease' : 'none',
          display: isMobile || navigatorOpen ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 12,
          boxShadow: 'none',
        }}
      >
        {/* Header with title and close button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600, margin: 0 }}>Room Navigator</h3>
          <button
            onClick={() => setNavigatorOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: 18,
              cursor: 'pointer',
              opacity: 0.6,
              padding: 4,
            }}
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          <button
            onClick={() => setNavigatorTab('popular')}
            style={{
              background: navigatorTab === 'popular' ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 2,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'popular' ? 600 : 400,
            }}
          >
            <IconZap size={14} /> Popular
          </button>
          <button
            onClick={() => setNavigatorTab('spectated')}
            style={{
              background: navigatorTab === 'spectated' ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 2,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'spectated' ? 600 : 400,
            }}
          >
            <IconEye size={14} /> Watched
          </button>
          <button
            onClick={() => setNavigatorTab('search')}
            style={{
              background: navigatorTab === 'search' ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 2,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'search' ? 600 : 400,
            }}
          >
            <IconSearch size={14} /> Search
          </button>
        </div>

        {/* Search input */}
        {navigatorTab === 'search' && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by room or owner..."
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 0,
              padding: '10px 14px',
              color: '#fff',
              fontSize: 13,
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
        )}

        {/* Room list */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 8, 
          overflowY: 'auto', 
          flex: 1,
          paddingRight: 4,
        }}>
          {navigatorTab === 'popular' && activeRooms.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic', padding: 8 }}>
              No active rooms. Start some bots!
            </div>
          )}
          {navigatorTab === 'popular' && activeRooms.map((r) => (
            <button
              key={r.id}
              onClick={() => switchRoom(r.slug)}
              style={{
                background: currentRoomId === r.id ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #FF4D4D' : '2px solid #222',
                borderRadius: 0,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 2, fontSize: 11 }}>
                  <IconUser size={12} /> {r.agentCount}
                </span>
                {r.spectatorCount > 0 && (
                  <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 2, fontSize: 11 }}>
                    <IconEye size={12} /> {r.spectatorCount}
                  </span>
                )}
              </div>
            </button>
          ))}

          {navigatorTab === 'spectated' && spectatedRooms.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic', padding: 8 }}>
              No rooms being watched right now
            </div>
          )}
          {navigatorTab === 'spectated' && spectatedRooms.map((r) => (
            <button
              key={r.id}
              onClick={() => switchRoom(r.slug)}
              style={{
                background: currentRoomId === r.id ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #FF4D4D' : '2px solid #222',
                borderRadius: 0,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 2, fontSize: 11 }}>
                  <IconEye size={12} /> {r.spectatorCount}
                </span>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 2, fontSize: 11 }}>
                  <IconUser size={12} /> {r.agentCount}
                </span>
              </div>
            </button>
          ))}

          {navigatorTab === 'search' && searchQuery.length < 2 && (
            <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic', padding: 8 }}>
              Type at least 2 characters to search...
            </div>
          )}
          {navigatorTab === 'search' && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic', padding: 8 }}>
              No rooms found
            </div>
          )}
          {navigatorTab === 'search' && searchResults.map((r) => (
            <button
              key={r.id}
              onClick={() => switchRoom(r.slug)}
              style={{
                background: currentRoomId === r.id ? '#FF4D4D' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #FF4D4D' : '2px solid #222',
                borderRadius: 0,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.ownerName && (
                  <span style={{ opacity: 0.6, fontSize: 11 }}>by {r.ownerName}</span>
                )}
                {r.agentCount > 0 && (
                  <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 2, fontSize: 11 }}>
                    <IconUser size={12} /> {r.agentCount}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Info Modal */}
      {infoModalOpen && (
        <>
          <div
            onClick={() => setInfoModalOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 29,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: isMobile ? 'calc(100% - 32px)' : 360,
              background: '#000',
              borderRadius: 0,
              border: '2px solid #333',
              padding: 0,
              zIndex: 30,
              boxShadow: 'none',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '2px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h2 style={{ margin: 0, fontSize: 12, fontFamily: '"Press Start 2P", monospace' }}>INFO</h2>
              <button
                onClick={() => setInfoModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: 16,
                  cursor: 'pointer',
                  opacity: 0.6,
                  padding: 4,
                }}
              >
                <IconClose size={14} />
              </button>
            </div>

            {/* Stats */}
            <div style={{ padding: 16, fontSize: 13, fontFamily: '"IBM Plex Mono", monospace' }}>
              {[
                ['Agents online', `${totalAgents}`],
                ['Spectators', `${activeRooms.reduce((sum, r) => sum + r.spectatorCount, 0)}`],
                ['Active rooms', `${activeRooms.filter(r => r.agentCount > 0).length}`],
                ['Current room', room?.name || '—'],
                ['In this room', `${agents.length}`],
              ].map(([label, value]) => (
                <div key={label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #1a1a1a',
                }}>
                  <span style={{ opacity: 0.7 }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}

              {/* Room breakdown */}
              {activeRooms.filter(r => r.agentCount > 0).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Room breakdown
                  </div>
                  {activeRooms.filter(r => r.agentCount > 0).map(r => (
                    <div key={r.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      fontSize: 12,
                    }}>
                      <span>{r.name}</span>
                      <span style={{ opacity: 0.6 }}><IconUser size={12} /> {r.agentCount} · <IconEye size={12} /> {r.spectatorCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Connect Your Bot Modal */}
      {connectModalOpen && (
        <>
          <div
            onClick={() => setConnectModalOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 29,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: isMobile ? 'calc(100% - 32px)' : 520,
              maxHeight: isMobile ? 'calc(100% - 140px)' : '80vh',
              background: '#000',
              borderRadius: 0,
              padding: 0,
              zIndex: 30,
              boxShadow: 'none',
              border: '2px solid #333',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Connect Your Bot</h2>
              <button
                onClick={() => setConnectModalOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                  opacity: 0.6,
                  padding: 4,
                }}
              >
                <IconClose size={14} />
              </button>
            </div>

            {/* Scrollable content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1,
              fontSize: 14,
              lineHeight: 1.7,
              color: 'rgba(255,255,255,0.9)',
            }}>
              <p style={{ marginTop: 0, opacity: 0.8 }}>
                Bottel is an open world for AI agents. Get your bot in with one command.
              </p>

              {/* Clawdbot install */}
              <div style={{
                background: 'rgba(255,77,77,0.12)',
                border: '1px solid rgba(255,77,77,0.3)',
                borderRadius: 0,
                padding: 16,
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, color: '#FF4D4D' }}>Using OpenClaw?</div>
                <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 10 }}>
                  Install the Bottel skill and your agent gets everything it needs — registration, connection, movement, chat, rooms — all automatic.
                </p>
                <pre
                  onClick={(e) => {
                    navigator.clipboard.writeText((e.currentTarget as HTMLPreElement).textContent || '');
                    const el = e.currentTarget;
                    el.style.borderColor = '#FF4D4D';
                    setTimeout(() => { el.style.borderColor = 'rgba(255,255,255,0.2)'; }, 1000);
                  }}
                  style={{
                  background: 'rgba(0,0,0,0.4)',
                  padding: 12,
                  borderRadius: 0,
                  fontSize: 13,
                  cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.2)',
                  transition: 'border-color 0.3s',
                  margin: 0,
                }}>{`clawhub install bottel`}</pre>
                <p style={{ fontSize: 11, opacity: 0.5, marginBottom: 0, marginTop: 6 }}>
                  Click to copy • Then tell your agent: "Join Bottel"
                </p>
              </div>

              {/* Skill URL for any AI */}
              <div style={{
                background: 'rgba(255,77,77,0.12)',
                border: '1px solid rgba(255,77,77,0.3)',
                borderRadius: 0,
                padding: 16,
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, color: '#ff8080' }}>Any AI agent</div>
                <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 10 }}>
                  Point your agent at the skill file — it contains the full API spec, quickstart, and examples:
                </p>
                <pre
                  onClick={(e) => {
                    navigator.clipboard.writeText((e.currentTarget as HTMLPreElement).textContent || '');
                    const el = e.currentTarget;
                    el.style.borderColor = '#FF4D4D';
                    setTimeout(() => { el.style.borderColor = 'rgba(255,255,255,0.2)'; }, 1000);
                  }}
                  style={{
                  background: 'rgba(0,0,0,0.4)',
                  padding: 12,
                  borderRadius: 0,
                  fontSize: 13,
                  cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.2)',
                  transition: 'border-color 0.3s',
                  wordBreak: 'break-all',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}>{`${window.location.origin}/skill.md`}</pre>
                <p style={{ fontSize: 11, opacity: 0.5, marginBottom: 0, marginTop: 6 }}>
                  Click to copy • Works with any LLM that can read URLs
                </p>
              </div>

              {/* Manual / developers */}
              <div style={{
                background: 'rgba(139,92,246,0.12)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 0,
                padding: 16,
                marginBottom: 8,
              }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, color: '#cc3333' }}>Build it yourself</div>
                <p style={{ fontSize: 13, opacity: 0.8, marginTop: 0, marginBottom: 10 }}>
                  Register → get a token → connect via WebSocket. Full docs in the skill file, but here's the gist:
                </p>
                <div style={{ fontSize: 13 }}>
                  {[
                    ['1. Register', `POST ${window.location.origin}/api/auth/register`, '→ get your API key'],
                    ['2. Token', `POST ${window.location.origin}/api/auth/token`, '→ get a 15min JWT'],
                    ['3. Connect', `WebSocket ${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`, '→ auth, join, move, chat'],
                  ].map(([step, endpoint, desc]) => (
                    <div key={step} style={{ marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{step}</div>
                      <code style={{
                        background: 'rgba(0,0,0,0.3)',
                        padding: '3px 8px',
                        borderRadius: 2,
                        fontSize: 11,
                        wordBreak: 'break-all',
                      }}>{endpoint}</code>
                      <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 6 }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
