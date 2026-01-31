import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import { TextStyle } from 'pixi.js';
import type { ServerMessage, RoomAgent, ChatMessage, Room } from '@bottel/shared';
import { TILE_WIDTH, TILE_HEIGHT } from '@bottel/shared';

// Convert world coords to screen (isometric)
function toScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - y) * (TILE_WIDTH / 2),
    y: (x + y) * (TILE_HEIGHT / 2),
  };
}

// Habbo-style floating chat bubble
interface FloatingBubble {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  startX: number;
  startY: number;
  timestamp: number;
}

const BUBBLE_START_Y = 80;
const BUBBLE_FLOAT_SPEED = 15;
const BUBBLE_LIFETIME = 8000;

function App() {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floatingBubbles, setFloatingBubbles] = useState<FloatingBubble[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update time for bubble animation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      setFloatingBubbles(prev => prev.filter(b => Date.now() - b.timestamp < BUBBLE_LIFETIME));
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
            setFloatingBubbles(prev => [
              ...prev,
              {
                id: msg.id,
                agentId: msg.agentId,
                agentName: msg.agentName,
                content: msg.content,
                startX: screenPos.x,
                startY: BUBBLE_START_Y,
                timestamp: Date.now(),
              },
            ]);
          }
          return currentAgents;
        });
        break;
    }
  }, []);

  const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;
  const offsetX = width / 2;
  const offsetY = 150;

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
        {/* Floating chat bubbles layer */}
        <Container x={offsetX} y={0}>
          {floatingBubbles.map((bubble) => {
            const age = currentTime - bubble.timestamp;
            const floatOffset = (age / 1000) * BUBBLE_FLOAT_SPEED;
            const opacity = Math.max(0, 1 - (age / BUBBLE_LIFETIME));
            const y = bubble.startY - floatOffset;
            
            return (
              <Container key={bubble.id} x={bubble.startX} y={y} alpha={opacity}>
                <Graphics
                  draw={(g) => {
                    g.clear();
                    const text = bubble.content.slice(0, 40);
                    const bubbleWidth = Math.min(text.length * 7 + 24, 280);
                    const bubbleHeight = 32;
                    
                    g.beginFill(0xffffff, 0.95);
                    g.lineStyle(2, 0x000000, 0.3);
                    g.drawRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 10);
                    g.endFill();
                    
                    g.beginFill(0xffffff, 0.95);
                    g.lineStyle(2, 0x000000, 0.3);
                    g.moveTo(-6, bubbleHeight / 2 - 2);
                    g.lineTo(0, bubbleHeight / 2 + 8);
                    g.lineTo(6, bubbleHeight / 2 - 2);
                    g.endFill();
                  }}
                />
                <Text
                  text={bubble.agentName}
                  x={0}
                  y={-6}
                  anchor={{ x: 0.5, y: 0.5 }}
                  style={new TextStyle({
                    fontSize: 10,
                    fill: 0x666666,
                    fontFamily: 'sans-serif',
                    fontWeight: 'bold',
                  })}
                />
                <Text
                  text={
                    bubble.content.length > 40
                      ? bubble.content.slice(0, 40) + '...'
                      : bubble.content
                  }
                  x={0}
                  y={6}
                  anchor={{ x: 0.5, y: 0.5 }}
                  style={new TextStyle({
                    fontSize: 11,
                    fill: 0x1a1a2e,
                    fontFamily: 'sans-serif',
                  })}
                />
              </Container>
            );
          })}
        </Container>

        {/* Room container */}
        <Container x={offsetX} y={offsetY}>
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
                <Container key={agent.id} x={pos.x} y={pos.y - 20}>
                  <Graphics
                    draw={(g) => {
                      g.clear();
                      const color = parseInt(agent.avatar.bodyColor.slice(1), 16);
                      g.beginFill(0x000000, 0.3);
                      g.drawEllipse(0, 10, 14, 6);
                      g.endFill();
                      g.beginFill(color);
                      g.drawEllipse(0, -8, 14, 18);
                      g.endFill();
                      g.beginFill(0xfcd5b8);
                      g.drawCircle(0, -32, 12);
                      g.endFill();
                      g.beginFill(0x333333);
                      g.drawCircle(-4, -33, 2);
                      g.drawCircle(4, -33, 2);
                      g.endFill();
                    }}
                  />
                  
                  <Container y={-52}>
                    <Graphics
                      draw={(g) => {
                        g.clear();
                        const nameWidth = agent.name.length * 7 + 12;
                        g.beginFill(0x000000, 0.7);
                        g.drawRoundedRect(-nameWidth / 2, -10, nameWidth, 18, 4);
                        g.endFill();
                      }}
                    />
                    <Text
                      text={agent.name}
                      anchor={0.5}
                      style={new TextStyle({
                        fontSize: 11,
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
