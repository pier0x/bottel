import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import { TextStyle, TextMetrics } from 'pixi.js';
import type { ServerMessage, RoomAgent, ChatMessage, Room } from '@bottel/shared';
import { TILE_WIDTH, TILE_HEIGHT } from '@bottel/shared';

// Shared text style for bubbles
const bubbleTextStyle = new TextStyle({
  fontSize: 11,
  fill: 0x1a1a2e,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
});

// Measure text width using PixiJS TextMetrics
function measureText(text: string): number {
  const metrics = TextMetrics.measureText(text, bubbleTextStyle);
  return metrics.width;
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
}

const BUBBLE_HEIGHT = 32;      // Height of each bubble including spacing (smaller = slower rise)
const BUBBLE_BASE_Y = 220;     // Y position for slot 0 (higher = lower on screen)
const BUBBLE_LIFETIME = 8000;  // 8 seconds before disappearing
const MAX_BUBBLES = 8;         // Max bubbles on screen

// Set to true to show mock bubbles for testing
const MOCK_ENABLED = false;

function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floatingBubbles, setFloatingBubbles] = useState<FloatingBubble[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [botsRunning, setBotsRunning] = useState(false);
  const [botsLoading, setBotsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Check bot status on load
  useEffect(() => {
    fetch('/api/bots/status')
      .then(res => res.json())
      .then(data => setBotsRunning(data.running))
      .catch(() => {});
  }, []);

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
        { id: '1', agentId: 'a1', agentName: 'Alice', content: 'Hello world!', x: -100, slot: 0, timestamp: now },
        { id: '2', agentId: 'a2', agentName: 'Bob', content: 'This is a longer message to test', x: 50, slot: 1, timestamp: now - 500 },
        { id: '3', agentId: 'a3', agentName: 'Charlie', content: 'Hi', x: 150, slot: 2, timestamp: now - 1000 },
        { id: '4', agentId: 'a4', agentName: 'Diana', content: 'Testing the bubble width!', x: -50, slot: 3, timestamp: now - 1500 },
      ]);
    }
  }, []);

  // Update time and manage bubble slots
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      // Remove expired bubbles and re-slot remaining ones
      setFloatingBubbles(prev => {
        const now = Date.now();
        const active = prev.filter(b => now - b.timestamp < BUBBLE_LIFETIME);
        // Re-assign slots based on age (newest = slot 0)
        return active
          .sort((a, b) => b.timestamp - a.timestamp) // Newest first
          .map((bubble, index) => ({ ...bubble, slot: index }));
      });
    }, 50);
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
  
  // Bubble base Y - relative to room position on desktop
  const bubbleBaseY = isMobile ? BUBBLE_BASE_Y : offsetY - 60;

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

      {/* PixiJS Canvas */}
      <Stage
        width={width}
        height={height}
        options={{ background: 0x1a1a2e, antialias: true }}
      >
        {/* Floating chat bubbles layer - scaled to match room */}
        <Container x={offsetX} y={0} scale={{ x: scale, y: 1 }}>
          {floatingBubbles.map((bubble) => {
            const age = currentTime - bubble.timestamp;
            // Y position based on slot (higher slot = higher on screen)
            const y = bubbleBaseY - (bubble.slot * BUBBLE_HEIGHT);
            // Fade out based on age
            const opacity = Math.max(0, 1 - (age / BUBBLE_LIFETIME) * 0.7);
            // Remove emojis from username
            const cleanName = bubble.agentName.replace(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
            // Truncate message to fit
            const maxMsgLen = 35 - cleanName.length;
            const msgText = bubble.content.length > maxMsgLen 
              ? bubble.content.slice(0, maxMsgLen) + '…' 
              : bubble.content;
            
            // Combine text and measure actual width
            const combinedText = `${cleanName}: ${msgText}`;
            const textWidth = measureText(combinedText);
            const bubbleWidth = textWidth + 16;
            const bubbleHeight = 26;
            
            return (
              <Container key={bubble.id} x={bubble.x} y={y} alpha={opacity}>
                <Graphics
                  draw={(g) => {
                    g.clear();
                    g.beginFill(0xffffff, 0.95);
                    g.lineStyle(2, 0x000000, 0.3);
                    g.drawRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 8);
                    g.endFill();
                  }}
                />
                <Text
                  text={combinedText}
                  x={0}
                  y={0}
                  anchor={{ x: 0.5, y: 0.5 }}
                  style={bubbleTextStyle}
                />
              </Container>
            );
          })}
        </Container>

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
              const pos = toScreen(agent.x, agent.y);

              return (
                <Container key={agent.id} x={pos.x} y={pos.y - 30}>
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

      {/* Chat log - desktop: always visible, mobile: slide-up panel */}
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? 0 : 16,
          right: isMobile ? 0 : 16,
          left: isMobile ? 0 : 'auto',
          width: isMobile ? '100%' : 320,
          maxHeight: isMobile ? (chatOpen ? '60vh' : 0) : 300,
          height: isMobile ? (chatOpen ? '60vh' : 0) : 'auto',
          background: 'rgba(0,0,0,0.85)',
          borderRadius: isMobile ? '16px 16px 0 0' : 12,
          padding: isMobile ? (chatOpen ? 16 : 0) : 16,
          paddingBottom: isMobile && chatOpen ? 80 : (isMobile ? 0 : 16),
          overflowY: 'auto',
          zIndex: 15,
          backdropFilter: 'blur(8px)',
          transition: 'max-height 0.3s ease, height 0.3s ease, padding 0.3s ease',
          display: isMobile && !chatOpen ? 'none' : 'block',
        }}
      >
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
          {isMobile && (
            <span style={{ fontSize: 12, opacity: 0.5 }}>{messages.length} messages</span>
          )}
        </h3>
        {messages.slice(-30).map((m) => (
          <div key={m.id} style={{ marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: '#10B981', fontWeight: 600 }}>{m.agentName}</span>
            <span style={{ opacity: 0.5 }}>: </span>
            <span style={{ opacity: 0.9 }}>{m.content}</span>
          </div>
        ))}
        {messages.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 13, fontStyle: 'italic' }}>
            Waiting for AIs to chat...
          </div>
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
    </div>
  );
}

export default App;
