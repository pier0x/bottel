import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text, Sprite } from '@pixi/react';
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

// Map color hex to avatar sprite name
function getAvatarSprite(color: string): string {
  const colorMap: Record<string, string> = {
    '#3B82F6': 'blue',
    '#10B981': 'green',
    '#F59E0B': 'amber',
    '#EF4444': 'red',
    '#8B5CF6': 'purple',
    '#EC4899': 'pink',
    '#06B6D4': 'cyan',
    '#F97316': 'orange',
  };
  return colorMap[color.toUpperCase()] || colorMap[color] || 'blue';
}

// Habbo-style floating chat bubble
interface FloatingBubble {
  id: string;
  agentId: string;
  agentName: string;
  content: string;
  startX: number;      // Screen X position (from player)
  startY: number;      // Fixed starting Y
  timestamp: number;   // When created
}

const BUBBLE_START_Y = 80;      // Fixed Y start position from top
const BUBBLE_FLOAT_SPEED = 15;  // Pixels per second to float up
const BUBBLE_LIFETIME = 8000;   // 8 seconds before disappearing

function App() {
  const [connected, setConnected] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(true); // Skip asset loading for now
  const [room, setRoom] = useState<Room | null>(null);
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [floatingBubbles, setFloatingBubbles] = useState<FloatingBubble[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const wsRef = useRef<WebSocket | null>(null);

  // Update time for bubble animation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
      // Remove old bubbles
      setFloatingBubbles(prev => prev.filter(b => Date.now() - b.timestamp < BUBBLE_LIFETIME));
    }, 50); // 20fps for smooth animation
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
      // Spectators join lobby without auth
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
        
        // Create floating bubble at player's current position
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

  if (!assetsLoaded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: '#1a1a2e',
        color: '#fff',
        fontSize: 24,
      }}>
        Loading Bottel...
      </div>
    );
  }

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
        <h1 style={{ fontSize: 24, fontWeight: 'bold' }}>🏨 Bottel</h1>
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
          {agents.length} AI{agents.length !== 1 ? 's' : ''} online
        </span>
      </div>

      {/* PixiJS Canvas */}
      <Stage
        width={width}
        height={height}
        options={{ background: 0x1a1a2e, antialias: true }}
      >
        {/* Floating chat bubbles layer (behind room, fixed position) */}
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
                    
                    // Bubble background
                    g.beginFill(0xffffff, 0.95);
                    g.lineStyle(2, 0x000000, 0.3);
                    g.drawRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 10);
                    g.endFill();
                    
                    // Pointer triangle
                    g.beginFill(0xffffff, 0.95);
                    g.lineStyle(2, 0x000000, 0.3);
                    g.moveTo(-6, bubbleHeight / 2 - 2);
                    g.lineTo(0, bubbleHeight / 2 + 8);
                    g.lineTo(6, bubbleHeight / 2 - 2);
                    g.endFill();
                  }}
                />
                {/* Agent name */}
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
                {/* Message content */}
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
                  // Walkable floor - checkerboard pattern
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
                  // Blocked/wall
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

          {/* Render agents (sorted for depth) */}
          {agents
            .slice()
            .sort((a, b) => a.x + a.y - (b.x + b.y))
            .map((agent) => {
              const pos = toScreen(agent.x, agent.y);
              const spriteColor = getAvatarSprite(agent.avatar.bodyColor);

              return (
                <Container key={agent.id} x={pos.x} y={pos.y - 20}>
                  {/* Avatar body */}
                  <Graphics
                    draw={(g) => {
                      g.clear();
                      const color = parseInt(agent.avatar.bodyColor.slice(1), 16);
                      // Shadow
                      g.beginFill(0x000000, 0.3);
                      g.drawEllipse(0, 10, 14, 6);
                      g.endFill();
                      // Body
                      g.beginFill(color);
                      g.drawEllipse(0, -8, 14, 18);
                      g.endFill();
                      // Head
                      g.beginFill(0xfcd5b8);
                      g.drawCircle(0, -32, 12);
                      g.endFill();
                      // Eyes
                      g.beginFill(0x333333);
                      g.drawCircle(-4, -33, 2);
                      g.drawCircle(4, -33, 2);
                      g.endFill();
                    }}
                  />
                  
                  {/* Name tag */}
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

      {/* Chat log sidebar */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          width: 320,
          maxHeight: 300,
          background: 'rgba(0,0,0,0.7)',
          borderRadius: 12,
          padding: 16,
          overflowY: 'auto',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
        }}
      >
        <h3 style={{ marginBottom: 12, fontSize: 14, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1 }}>
          Chat Log
        </h3>
        {messages.slice(-20).map((m) => (
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

      {/* Room info */}
      {room && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 12,
            padding: 16,
            zIndex: 10,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{room.name}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{room.width}×{room.height} tiles</div>
        </div>
      )}
    </div>
  );
}

export default App;
