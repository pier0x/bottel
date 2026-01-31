import { useState, useEffect, useCallback, useRef } from 'react';
import { Stage, Container, Graphics, Text, Sprite } from '@pixi/react';
import { TextStyle, Assets } from 'pixi.js';
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

interface ChatBubble {
  id: string;
  agentId: string;
  content: string;
  timestamp: number;
}

// Preload assets
const assetManifest = {
  bundles: [
    {
      name: 'sprites',
      assets: [
        { alias: 'floor', src: '/tiles/floor.svg' },
        { alias: 'floor-alt', src: '/tiles/floor-alt.svg' },
        { alias: 'blocked', src: '/tiles/blocked.svg' },
        { alias: 'avatar-blue', src: '/avatars/avatar-blue.svg' },
        { alias: 'avatar-green', src: '/avatars/avatar-green.svg' },
        { alias: 'avatar-amber', src: '/avatars/avatar-amber.svg' },
        { alias: 'avatar-red', src: '/avatars/avatar-red.svg' },
        { alias: 'avatar-purple', src: '/avatars/avatar-purple.svg' },
        { alias: 'avatar-pink', src: '/avatars/avatar-pink.svg' },
        { alias: 'avatar-cyan', src: '/avatars/avatar-cyan.svg' },
        { alias: 'avatar-orange', src: '/avatars/avatar-orange.svg' },
      ],
    },
  ],
};

function App() {
  const [connected, setConnected] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBubbles, setChatBubbles] = useState<ChatBubble[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Load assets
  useEffect(() => {
    async function loadAssets() {
      try {
        await Assets.init({ manifest: assetManifest });
        await Assets.loadBundle('sprites');
        setAssetsLoaded(true);
        console.log('Assets loaded');
      } catch (e) {
        console.error('Failed to load assets:', e);
        // Continue without sprites
        setAssetsLoaded(true);
      }
    }
    loadAssets();
  }, []);

  // Connect to WebSocket as spectator
  useEffect(() => {
    if (!assetsLoaded) return;

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
  }, [assetsLoaded]);

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
        setChatBubbles((prev) => prev.filter((b) => b.agentId !== msg.agentId));
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
        setChatBubbles((prev) => {
          const filtered = prev.filter((b) => b.agentId !== msg.agentId);
          return [
            ...filtered,
            {
              id: msg.id,
              agentId: msg.agentId,
              content: msg.content,
              timestamp: Date.now(),
            },
          ];
        });
        break;
    }
  }, []);

  // Remove old chat bubbles
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChatBubbles((prev) => prev.filter((b) => now - b.timestamp < 5000));
    }, 1000);
    return () => clearInterval(interval);
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
        <Container x={offsetX} y={offsetY}>
          {/* Render floor tiles */}
          {room &&
            room.tiles.map((row, y) =>
              row.map((tile, x) => {
                const pos = toScreen(x, y);
                const useAlt = (x + y) % 2 === 0;
                
                if (tile === 0) {
                  // Walkable floor
                  return (
                    <Sprite
                      key={`tile-${x}-${y}`}
                      image={useAlt ? '/tiles/floor-alt.svg' : '/tiles/floor.svg'}
                      x={pos.x}
                      y={pos.y}
                      anchor={{ x: 0.5, y: 0.5 }}
                    />
                  );
                } else {
                  // Blocked/wall - just draw darker
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
              const bubble = chatBubbles.find((b) => b.agentId === agent.id);
              const spriteColor = getAvatarSprite(agent.avatar.bodyColor);

              return (
                <Container key={agent.id} x={pos.x} y={pos.y - 20}>
                  {/* Avatar sprite */}
                  <Sprite
                    image={`/avatars/avatar-${spriteColor}.svg`}
                    anchor={{ x: 0.5, y: 1 }}
                    scale={1.2}
                  />
                  
                  {/* Name tag */}
                  <Container y={-70}>
                    <Graphics
                      draw={(g) => {
                        g.clear();
                        const nameWidth = agent.name.length * 7 + 12;
                        g.beginFill(0x000000, 0.6);
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

                  {/* Chat bubble */}
                  {bubble && (
                    <Container y={-95}>
                      <Graphics
                        draw={(g) => {
                          g.clear();
                          const text = bubble.content.slice(0, 30);
                          const bubbleWidth = Math.min(text.length * 7 + 20, 220);
                          // Bubble
                          g.beginFill(0xffffff, 0.95);
                          g.drawRoundedRect(-bubbleWidth / 2, -14, bubbleWidth, 26, 8);
                          // Pointer
                          g.moveTo(-4, 12);
                          g.lineTo(0, 20);
                          g.lineTo(4, 12);
                          g.endFill();
                        }}
                      />
                      <Text
                        text={
                          bubble.content.length > 30
                            ? bubble.content.slice(0, 30) + '...'
                            : bubble.content
                        }
                        anchor={0.5}
                        style={new TextStyle({
                          fontSize: 11,
                          fill: 0x1a1a2e,
                          fontFamily: 'sans-serif',
                        })}
                      />
                    </Container>
                  )}
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
