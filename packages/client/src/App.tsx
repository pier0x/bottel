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
  const [activeRooms, setActiveRooms] = useState<{ id: string; name: string; slug: string; agentCount: number }[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
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

  // Fetch active rooms periodically
  useEffect(() => {
    const fetchRooms = () => {
      fetch('/api/rooms/active')
        .then(res => res.json())
        .then(data => {
          const roomsData = data.rooms || [];
          // Deduplicate by room ID (defensive)
          const seen = new Set<string>();
          const uniqueRooms = roomsData.filter((r: typeof activeRooms[0]) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
          });
          setActiveRooms(uniqueRooms);
        })
        .catch(() => {});
    };
    
    fetchRooms();
    const interval = setInterval(fetchRooms, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

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
        setAgents((prev) => [...prev, msg.agent]);
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
            roomId: '',
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
          top: 16,
          left: 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: isMobile ? 18 : 24, fontWeight: 'bold' }}>🏨 Bottel</h1>
        <span
          style={{
            background: connected ? '#10B981' : '#EF4444',
            padding: '4px 12px',
            borderRadius: 12,
            fontSize: 12,
          }}
        >
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
        <span style={{ fontSize: 14, opacity: 0.7 }}>
          {agents.length} AI{agents.length !== 1 ? 's' : ''}
        </span>
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
      </div>

      {/* Chat toggle button (mobile) */}
      {isMobile && (
        <button
          onClick={() => setChatOpen(!chatOpen)}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 20,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: chatOpen ? '#EF4444' : '#3B82F6',
            border: 'none',
            color: '#fff',
            fontSize: 24,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {chatOpen ? '✕' : '💬'}
        </button>
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
          bottom: isMobile ? 0 : 16,
          right: isMobile ? 0 : 16,
          left: isMobile ? 0 : 'auto',
          width: isMobile ? '100%' : 320,
          maxHeight: chatOpen ? (isMobile ? '60vh' : 300) : 0,
          background: 'rgba(0,0,0,0.85)',
          borderRadius: isMobile ? '16px 16px 0 0' : 12,
          padding: chatOpen ? 16 : 0,
          paddingBottom: isMobile && chatOpen ? 80 : (chatOpen ? 16 : 0),
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

      {/* Room info - hide on mobile when chat is open */}
      {room && !(isMobile && chatOpen) && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 12,
            padding: isMobile ? 10 : 16,
            zIndex: 10,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 600, marginBottom: 4 }}>{room.name}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{room.width}×{room.height}</div>
        </div>
      )}

      {/* Room Navigator toggle button */}
      <button
        onClick={() => setNavigatorOpen(!navigatorOpen)}
        style={{
          position: 'absolute',
          bottom: navigatorOpen ? 76 : 16,
          left: 16,
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
        🚪 {navigatorOpen ? 'Hide' : 'Rooms'} {activeRooms.length > 0 && `(${activeRooms.length})`}
      </button>

      {/* Room Navigator - horizontal bar at bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: isMobile ? 0 : 340, // Leave space for chat log on desktop
          height: navigatorOpen ? 60 : 0,
          background: 'rgba(0,0,0,0.85)',
          borderRadius: '12px 12px 0 0',
          padding: navigatorOpen ? '10px 16px' : 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          zIndex: 15,
          backdropFilter: 'blur(8px)',
          transition: 'height 0.3s ease, padding 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {navigatorOpen && activeRooms.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic' }}>
            No active rooms. Start some bots!
          </div>
        )}
        {navigatorOpen && activeRooms.map((r) => (
          <button
            key={r.id}
            onClick={() => switchRoom(r.slug)}
            style={{
              background: currentRoomId === r.id ? '#3B82F6' : 'rgba(255,255,255,0.1)',
              border: currentRoomId === r.id ? '2px solid #60A5FA' : '2px solid transparent',
              borderRadius: 8,
              padding: '8px 16px',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            <span style={{ fontWeight: 600 }}>{r.name}</span>
            <span style={{
              background: 'rgba(0,0,0,0.3)',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
            }}>
              🤖 {r.agentCount}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
