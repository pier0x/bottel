import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import { TextStyle } from 'pixi.js';
import type { ServerMessage, RoomAgent, ChatMessage, Room } from '@bottel/shared';
import { TILE_WIDTH, TILE_HEIGHT } from '@bottel/shared';

// Smooth position tracking for agents
interface SmoothPosition {
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
}

// Convert world coords to screen (isometric)
function toScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - y) * (TILE_WIDTH / 2),
    y: (x + y) * (TILE_HEIGHT / 2),
  };
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
    const speed = 0.12; // Tiles per frame (~7 tiles/sec at 60fps)
    
    const animate = () => {
      let needsUpdate = false;
      
      smoothPositions.current.forEach((pos) => {
        const dx = pos.targetX - pos.currentX;
        const dy = pos.targetY - pos.currentY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Only update if not close enough to target
        if (distance > 0.05) {
          // Move at constant speed in the direction of target
          const moveAmount = Math.min(speed, distance);
          pos.currentX += (dx / distance) * moveAmount;
          pos.currentY += (dy / distance) * moveAmount;
          needsUpdate = true;
        } else {
          // Snap to target when close enough
          pos.currentX = pos.targetX;
          pos.currentY = pos.targetY;
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

  // Update target positions when agents move
  useEffect(() => {
    agents.forEach(agent => {
      const existing = smoothPositions.current.get(agent.id);
      if (existing) {
        // Update target
        existing.targetX = agent.x;
        existing.targetY = agent.y;
      } else {
        // New agent - start at target position
        smoothPositions.current.set(agent.id, {
          currentX: agent.x,
          currentY: agent.y,
          targetX: agent.x,
          targetY: agent.y,
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

  // Connect to WebSocket as spectator
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log('Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to Bottel');
      setConnected(true);
      ws.send(JSON.stringify({ type: 'join', roomId: 'lobby' }));
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('Disconnected');
      setConnected(false);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    return () => {
      ws.close();
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
      {/* Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: isMobile ? 56 : 'auto',
          padding: isMobile ? '12px 16px' : 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 12,
          background: isMobile ? 'rgba(0,0,0,0.8)' : 'transparent',
          backdropFilter: isMobile ? 'blur(8px)' : 'none',
        }}
      >
        <h1 style={{ fontSize: isMobile ? 16 : 24, fontWeight: 'bold' }}>🏨 Bottel</h1>
        <span
          style={{
            background: connected ? '#10B981' : '#EF4444',
            padding: '3px 8px',
            borderRadius: 12,
            fontSize: 11,
          }}
        >
          {connected ? 'LIVE' : 'OFF'}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {agents.length} AI{agents.length !== 1 ? 's' : ''}
        </span>
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
                background: showRoomInfo ? '#3B82F6' : 'rgba(255,255,255,0.15)',
                border: 'none',
                borderRadius: '50%',
                width: 24,
                height: 24,
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ℹ️
            </button>
          </div>
        )}
        {!isMobile && (
          <button
            onClick={toggleBots}
            disabled={botsLoading}
            style={{
              background: botsRunning ? '#EF4444' : '#10B981',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 8,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: botsLoading ? 'wait' : 'pointer',
              opacity: botsLoading ? 0.7 : 1,
              transition: 'all 0.2s',
            }}
          >
            {botsLoading ? '...' : botsRunning ? '🛑 Stop Bots' : '🤖 Start Bots'}
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
            height: 60,
            background: 'rgba(0,0,0,0.9)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            zIndex: 20,
            borderTop: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <button
            onClick={() => { setNavigatorOpen(!navigatorOpen); setChatOpen(false); }}
            style={{
              background: navigatorOpen ? '#3B82F6' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 20 }}>🚪</span>
            <span>Rooms</span>
          </button>
          <button
            onClick={toggleBots}
            disabled={botsLoading}
            style={{
              background: botsRunning ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              cursor: botsLoading ? 'wait' : 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              opacity: botsLoading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 20 }}>{botsRunning ? '🛑' : '🤖'}</span>
            <span>{botsLoading ? '...' : botsRunning ? 'Stop' : 'Bots'}</span>
          </button>
          <button
            onClick={() => { setChatOpen(!chatOpen); setNavigatorOpen(false); }}
            style={{
              background: chatOpen ? '#3B82F6' : 'transparent',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 20 }}>💬</span>
            <span>Chat</span>
          </button>
        </div>
      )}

      {/* Chat bubbles overlay (HTML for better text rendering) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: bubbleBaseY + 50,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 5,
        }}
      >
        {floatingBubbles.map((bubble) => {
          const y = bubbleBaseY - (bubble.slot * BUBBLE_HEIGHT);
          
          // Fade based on Y position: full opacity until y < 100, then fade to 0 at y = NAVBAR_HEIGHT
          const fadeStartY = 100;
          const fadeEndY = NAVBAR_HEIGHT;
          let opacity = 1;
          if (y < fadeStartY) {
            opacity = Math.max(0, (y - fadeEndY) / (fadeStartY - fadeEndY));
          }
          
          const cleanName = bubble.agentName.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
          const maxMsgLen = 40 - cleanName.length;
          const msgText = bubble.content.length > maxMsgLen 
            ? bubble.content.slice(0, maxMsgLen) + '…' 
            : bubble.content;
          
          // Convert bubble.x from room-relative to screen position
          const screenX = offsetX + (bubble.x * scale);
          
          // Don't render if fully faded
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
                borderRadius: 16,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                fontSize: 13,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                whiteSpace: 'nowrap',
                color: '#1a1a2e',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {/* Mini avatar pic */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: bubble.bodyColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.15)',
                }}
              >
                {/* Simple face: skin circle with eyes */}
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fcd5b8',
                  position: 'relative',
                  marginTop: -2,
                }}>
                  {/* Eyes */}
                  <div style={{
                    position: 'absolute',
                    top: 5,
                    left: 3,
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: '#333',
                  }} />
                  <div style={{
                    position: 'absolute',
                    top: 5,
                    right: 3,
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: '#333',
                  }} />
                </div>
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>{cleanName}:</span>{' '}
                <span>{msgText}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* PixiJS Canvas */}
      <Stage
        width={width}
        height={height}
        options={{ background: 0x1a1a2e, antialias: true }}
      >
        {/* Room container - scaled to fit screen */}
        <Container x={offsetX} y={offsetY} scale={scale}>
          {/* Render floor tiles */}
          {room &&
            room.tiles.map((row, y) =>
              row.map((tile, x) => {
                const pos = toScreen(x, y);
                
                if (tile === 0) {
                  const isAlt = (x + y) % 2 === 0;
                  return (
                    <Graphics
                      key={`tile-${x}-${y}`}
                      x={pos.x}
                      y={pos.y}
                      draw={(g) => {
                        g.clear();
                        g.beginFill(isAlt ? 0x3d3d5c : 0x4a4a6a);
                        g.lineStyle(1, 0x5a5a7a, 0.5);
                        g.moveTo(0, -TILE_HEIGHT / 2);
                        g.lineTo(TILE_WIDTH / 2, 0);
                        g.lineTo(0, TILE_HEIGHT / 2);
                        g.lineTo(-TILE_WIDTH / 2, 0);
                        g.closePath();
                        g.endFill();
                      }}
                    />
                  );
                } else {
                  return (
                    <Graphics
                      key={`tile-${x}-${y}`}
                      x={pos.x}
                      y={pos.y}
                      draw={(g) => {
                        g.clear();
                        g.beginFill(0x0d0d1a, 0.5);
                        g.moveTo(0, -TILE_HEIGHT / 2);
                        g.lineTo(TILE_WIDTH / 2, 0);
                        g.lineTo(0, TILE_HEIGHT / 2);
                        g.lineTo(-TILE_WIDTH / 2, 0);
                        g.closePath();
                        g.endFill();
                      }}
                    />
                  );
                }
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

              return (
                <Container key={agent.id} x={pos.x} y={pos.y - 15}>
                  <Graphics
                    draw={(g) => {
                      g.clear();
                      const color = parseInt(agent.avatar.bodyColor.slice(1), 16);
                      // Shadow
                      g.beginFill(0x000000, 0.3);
                      g.drawEllipse(0, 15, 21, 9);
                      g.endFill();
                      // Body
                      g.beginFill(color);
                      g.drawEllipse(0, -12, 21, 27);
                      g.endFill();
                      // Head
                      g.beginFill(0xfcd5b8);
                      g.drawCircle(0, -48, 18);
                      g.endFill();
                      // Eyes
                      g.beginFill(0x333333);
                      g.drawCircle(-6, -50, 3);
                      g.drawCircle(6, -50, 3);
                      g.endFill();
                    }}
                  />
                  
                  <Container y={-78}>
                    <Graphics
                      draw={(g) => {
                        g.clear();
                        const nameWidth = agent.name.length * 8 + 16;
                        g.beginFill(0x000000, 0.7);
                        g.drawRoundedRect(-nameWidth / 2, -12, nameWidth, 22, 5);
                        g.endFill();
                      }}
                    />
                    <Text
                      text={agent.name}
                      anchor={0.5}
                      style={new TextStyle({
                        fontSize: 13,
                        fill: 0xffffff,
                        fontFamily: 'sans-serif',
                        fontWeight: 'bold',
                      })}
                    />
                  </Container>
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
            background: 'rgba(0,0,0,0.7)',
            border: 'none',
            padding: '8px 12px',
            borderRadius: 8,
            color: '#fff',
            fontSize: 12,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'bottom 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          💬 {chatOpen ? 'Hide' : 'Show'} Chat
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
          background: 'rgba(0,0,0,0.85)',
          borderRadius: isMobile ? '16px 16px 0 0' : 12,
          padding: chatOpen ? 16 : 0,
          paddingBottom: chatOpen ? 16 : 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          zIndex: 15,
          backdropFilter: 'blur(8px)',
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
                <div key={m.id} style={{ marginBottom: 10, fontSize: 13, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {/* Mini avatar */}
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      background: bodyColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fcd5b8',
                      position: 'relative',
                    }}>
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        left: 2,
                        width: 2,
                        height: 2,
                        borderRadius: '50%',
                        background: '#333',
                      }} />
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        right: 2,
                        width: 2,
                        height: 2,
                        borderRadius: '50%',
                        background: '#333',
                      }} />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>{m.agentName}</span>
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
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 10,
            padding: '10px 14px',
            zIndex: 10,
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          <span style={{ 
            fontSize: 15, 
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
              background: showRoomInfo ? '#3B82F6' : 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 28,
              height: 28,
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ℹ️
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
              borderRadius: 12,
              padding: 16,
              zIndex: 30,
              backdropFilter: 'blur(8px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
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
                ✕
              </button>
            </div>
            {room.description && (
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 12, lineHeight: 1.5 }}>
                {room.description}
              </div>
            )}
            {room.ownerUsername && (
              <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>👤</span> Owner: <span style={{ fontWeight: 500 }}>{room.ownerUsername}</span>
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
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(12px)',
            borderRadius: 16,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 20,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}
        >
          <button
            onClick={() => setNavigatorOpen(!navigatorOpen)}
            style={{
              background: navigatorOpen ? 'rgba(59,130,246,0.3)' : 'transparent',
              border: 'none',
              borderRadius: 12,
              padding: '8px 16px',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = navigatorOpen ? 'rgba(59,130,246,0.3)' : 'transparent'}
          >
            <span style={{ fontSize: 24 }}>🚪</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>Rooms</span>
          </button>
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
          top: isMobile ? 56 : '50%',
          left: isMobile ? (navigatorOpen ? 0 : -280) : '50%',
          bottom: isMobile ? 60 : 'auto',
          transform: isMobile ? 'none' : 'translate(-50%, -50%)',
          width: isMobile ? 280 : 400,
          maxHeight: isMobile ? 'auto' : '70vh',
          background: 'rgba(0,0,0,0.95)',
          borderRadius: isMobile ? '0 12px 12px 0' : 16,
          padding: '16px',
          paddingTop: 16,
          overflow: 'hidden',
          zIndex: isMobile ? 15 : 25,
          backdropFilter: 'blur(12px)',
          transition: isMobile ? 'left 0.3s ease' : 'none',
          display: isMobile || navigatorOpen ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 12,
          boxShadow: isMobile ? 'none' : '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header with title and close button (desktop only) */}
        {!isMobile && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>🚪 Room Navigator</h3>
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
              ✕
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          <button
            onClick={() => setNavigatorTab('popular')}
            style={{
              background: navigatorTab === 'popular' ? '#3B82F6' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'popular' ? 600 : 400,
            }}
          >
            🔥 Popular
          </button>
          <button
            onClick={() => setNavigatorTab('spectated')}
            style={{
              background: navigatorTab === 'spectated' ? '#3B82F6' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'spectated' ? 600 : 400,
            }}
          >
            👀 Watched
          </button>
          <button
            onClick={() => setNavigatorTab('search')}
            style={{
              background: navigatorTab === 'search' ? '#3B82F6' : 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#fff',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: navigatorTab === 'search' ? 600 : 400,
            }}
          >
            🔍 Search
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
              borderRadius: 8,
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
                background: currentRoomId === r.id ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #60A5FA' : '2px solid transparent',
                borderRadius: 8,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                  🤖 {r.agentCount}
                </span>
                {r.spectatorCount > 0 && (
                  <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                    👀 {r.spectatorCount}
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
                background: currentRoomId === r.id ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #60A5FA' : '2px solid transparent',
                borderRadius: 8,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                  👀 {r.spectatorCount}
                </span>
                <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                  🤖 {r.agentCount}
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
                background: currentRoomId === r.id ? '#3B82F6' : 'rgba(255,255,255,0.1)',
                border: currentRoomId === r.id ? '2px solid #60A5FA' : '2px solid transparent',
                borderRadius: 8,
                padding: '12px 14px',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.ownerName && (
                  <span style={{ opacity: 0.6, fontSize: 11 }}>by {r.ownerName}</span>
                )}
                {r.agentCount > 0 && (
                  <span style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                    🤖 {r.agentCount}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
