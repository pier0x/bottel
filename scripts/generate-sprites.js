#!/usr/bin/env node

/**
 * Generate placeholder isometric sprites for Bottel
 * Run with: node scripts/generate-sprites.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Tile dimensions (standard isometric 2:1 ratio)
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

// Avatar colors
const AVATAR_COLORS = [
  { name: 'blue', hex: '#3B82F6' },
  { name: 'green', hex: '#10B981' },
  { name: 'amber', hex: '#F59E0B' },
  { name: 'red', hex: '#EF4444' },
  { name: 'purple', hex: '#8B5CF6' },
  { name: 'pink', hex: '#EC4899' },
  { name: 'cyan', hex: '#06B6D4' },
  { name: 'orange', hex: '#F97316' },
];

// Helper to darken a hex color
function darken(hex, amount = 0.2) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((num >> 16) & 255) * (1 - amount));
  const g = Math.max(0, ((num >> 8) & 255) * (1 - amount));
  const b = Math.max(0, (num & 255) * (1 - amount));
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
}

// Helper to lighten a hex color
function lighten(hex, amount = 0.2) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((num >> 16) & 255) + (255 - ((num >> 16) & 255)) * amount);
  const g = Math.min(255, ((num >> 8) & 255) + (255 - ((num >> 8) & 255)) * amount);
  const b = Math.min(255, (num & 255) + (255 - (num & 255)) * amount);
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
}

// Generate floor tile SVG
function generateFloorTile(color = '#4a5568', highlight = '#718096') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" viewBox="0 0 ${TILE_WIDTH} ${TILE_HEIGHT}">
  <!-- Isometric diamond floor tile -->
  <polygon 
    points="${TILE_WIDTH/2},0 ${TILE_WIDTH},${TILE_HEIGHT/2} ${TILE_WIDTH/2},${TILE_HEIGHT} 0,${TILE_HEIGHT/2}" 
    fill="${color}" 
    stroke="${highlight}" 
    stroke-width="1"
  />
  <!-- Subtle grid pattern -->
  <line x1="${TILE_WIDTH/2}" y1="0" x2="${TILE_WIDTH/2}" y2="${TILE_HEIGHT}" stroke="${highlight}" stroke-width="0.5" opacity="0.3"/>
  <line x1="0" y1="${TILE_HEIGHT/2}" x2="${TILE_WIDTH}" y2="${TILE_HEIGHT/2}" stroke="${highlight}" stroke-width="0.5" opacity="0.3"/>
</svg>`;
}

// Generate blocked/wall tile
function generateBlockedTile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT + 16}" viewBox="0 0 ${TILE_WIDTH} ${TILE_HEIGHT + 16}">
  <!-- Isometric cube/block -->
  <!-- Top face -->
  <polygon 
    points="${TILE_WIDTH/2},0 ${TILE_WIDTH},${TILE_HEIGHT/2} ${TILE_WIDTH/2},${TILE_HEIGHT} 0,${TILE_HEIGHT/2}" 
    fill="#2d3748"
  />
  <!-- Left face -->
  <polygon 
    points="0,${TILE_HEIGHT/2} ${TILE_WIDTH/2},${TILE_HEIGHT} ${TILE_WIDTH/2},${TILE_HEIGHT + 16} 0,${TILE_HEIGHT/2 + 16}" 
    fill="#1a202c"
  />
  <!-- Right face -->
  <polygon 
    points="${TILE_WIDTH},${TILE_HEIGHT/2} ${TILE_WIDTH/2},${TILE_HEIGHT} ${TILE_WIDTH/2},${TILE_HEIGHT + 16} ${TILE_WIDTH},${TILE_HEIGHT/2 + 16}" 
    fill="#232a38"
  />
</svg>`;
}

// Generate isometric avatar SVG
function generateAvatar(color) {
  const dark = darken(color, 0.3);
  const light = lighten(color, 0.2);
  
  // Avatar dimensions
  const width = 32;
  const height = 56;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Shadow -->
  <ellipse cx="16" cy="54" rx="10" ry="4" fill="rgba(0,0,0,0.3)"/>
  
  <!-- Legs (simple) -->
  <rect x="10" y="38" width="5" height="14" rx="2" fill="${dark}"/>
  <rect x="17" y="38" width="5" height="14" rx="2" fill="${dark}"/>
  
  <!-- Body (isometric-ish torso) -->
  <path d="M8 24 L16 20 L24 24 L24 40 L16 44 L8 40 Z" fill="${color}"/>
  <path d="M16 20 L16 44 L24 40 L24 24 Z" fill="${dark}"/>
  <path d="M8 24 L16 20 L16 44 L8 40 Z" fill="${light}"/>
  
  <!-- Arms -->
  <ellipse cx="6" cy="30" rx="4" ry="6" fill="${color}"/>
  <ellipse cx="26" cy="30" rx="4" ry="6" fill="${dark}"/>
  
  <!-- Head -->
  <circle cx="16" cy="12" r="10" fill="#fcd5b8"/>
  
  <!-- Face details -->
  <circle cx="13" cy="11" r="1.5" fill="#333"/>
  <circle cx="19" cy="11" r="1.5" fill="#333"/>
  <path d="M14 15 Q16 17 18 15" stroke="#333" stroke-width="1" fill="none"/>
  
  <!-- Hair (simple) -->
  <path d="M6 10 Q8 2 16 2 Q24 2 26 10 Q24 6 16 6 Q8 6 6 10" fill="${color}"/>
</svg>`;
}

// Generate a simple chat bubble
function generateChatBubble() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.2"/>
    </filter>
  </defs>
  <!-- Bubble -->
  <rect x="4" y="4" width="112" height="28" rx="8" fill="white" filter="url(#shadow)"/>
  <!-- Pointer -->
  <polygon points="55,32 60,40 65,32" fill="white"/>
</svg>`;
}

// Generate name tag background
function generateNameTag() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" viewBox="0 0 80 20">
  <rect x="0" y="0" width="80" height="20" rx="4" fill="rgba(0,0,0,0.6)"/>
</svg>`;
}

// Main generation
function main() {
  console.log('🎨 Generating Bottel placeholder sprites...\n');

  // Floor tiles
  const tilesDir = path.join(ASSETS_DIR, 'tiles');
  
  fs.writeFileSync(
    path.join(tilesDir, 'floor.svg'),
    generateFloorTile('#3d3d5c', '#4d4d6c')
  );
  console.log('  ✓ tiles/floor.svg');

  fs.writeFileSync(
    path.join(tilesDir, 'floor-alt.svg'),
    generateFloorTile('#4a4a6a', '#5a5a7a')
  );
  console.log('  ✓ tiles/floor-alt.svg');

  fs.writeFileSync(
    path.join(tilesDir, 'blocked.svg'),
    generateBlockedTile()
  );
  console.log('  ✓ tiles/blocked.svg');

  // Avatars in different colors
  const avatarsDir = path.join(ASSETS_DIR, 'avatars');
  
  for (const { name, hex } of AVATAR_COLORS) {
    fs.writeFileSync(
      path.join(avatarsDir, `avatar-${name}.svg`),
      generateAvatar(hex)
    );
    console.log(`  ✓ avatars/avatar-${name}.svg`);
  }

  // UI elements
  const uiDir = path.join(ASSETS_DIR, 'ui');
  
  fs.writeFileSync(
    path.join(uiDir, 'chat-bubble.svg'),
    generateChatBubble()
  );
  console.log('  ✓ ui/chat-bubble.svg');

  fs.writeFileSync(
    path.join(uiDir, 'name-tag.svg'),
    generateNameTag()
  );
  console.log('  ✓ ui/name-tag.svg');

  console.log('\n✅ Generated', 3 + AVATAR_COLORS.length + 2, 'sprites');
  console.log('   Location:', ASSETS_DIR);
}

main();
