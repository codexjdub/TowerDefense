const TILE_SIZE = 64;
const COLS      = 20;
const ROWS      = 14;
const UI_WIDTH  = 200;
const CANVAS_W  = COLS * TILE_SIZE + UI_WIDTH; // 1480
const CANVAS_H  = ROWS * TILE_SIZE;            // 896

// ─── Map definitions ──────────────────────────────────────────────────────────
const MAP_CONFIGS = [
  {
    name: 'S-Curve',
    theme: 'meadow',
    difficulty: 'Medium',
    diffColor: '#f39c12',
    desc: 'A smooth winding path.\nBalanced for new players.',
    waypoints: [
      {col:0,row:6},{col:4,row:6},{col:4,row:2},{col:9,row:2},
      {col:9,row:10},{col:14,row:10},{col:14,row:4},{col:19,row:4},
    ],
  },
  {
    name: 'Zigzag',
    theme: 'desert',
    difficulty: 'Hard',
    diffColor: '#e74c3c',
    desc: 'Sharp turns and a\nshorter path. Act fast!',
    waypoints: [
      {col:0,row:1},{col:7,row:1},{col:7,row:5},{col:3,row:5},
      {col:3,row:9},{col:7,row:9},{col:7,row:12},{col:12,row:12},
      {col:12,row:8},{col:16,row:8},{col:16,row:4},{col:19,row:4},
    ],
  },
  {
    name: 'Serpentine',
    theme: 'meadow',
    difficulty: 'Easy',
    diffColor: '#2ecc71',
    desc: 'A long looping path.\nMore time to build towers.',
    waypoints: [
      {col:0,row:1},{col:18,row:1},{col:18,row:5},{col:2,row:5},
      {col:2,row:9},{col:18,row:9},{col:18,row:12},{col:19,row:12},
    ],
  },
  {
    name: 'Switchback',
    theme: 'snow',
    difficulty: 'Easy+',
    diffColor: '#1abc9c',
    desc: 'Six tight corridors.\nThe longest path of all.',
    waypoints: [
      {col:0,row:1},{col:18,row:1},{col:18,row:3},{col:2,row:3},
      {col:2,row:5},{col:18,row:5},{col:18,row:7},{col:2,row:7},
      {col:2,row:9},{col:18,row:9},{col:18,row:11},{col:2,row:11},
      {col:2,row:13},{col:19,row:13},
    ],
  },
  {
    name: 'Crown',
    theme: 'desert',
    difficulty: 'Medium',
    diffColor: '#f39c12',
    desc: 'Arch up and over the top.\nSymmetric and balanced.',
    waypoints: [
      {col:0,row:6},{col:3,row:6},{col:3,row:3},{col:7,row:3},
      {col:7,row:0},{col:12,row:0},{col:12,row:3},{col:16,row:3},
      {col:16,row:6},{col:19,row:6},
    ],
  },
  {
    name: 'Figure-8',
    theme: 'autumn',
    difficulty: 'Medium',
    diffColor: '#f39c12',
    desc: 'Two interlocked loops.\nNeeds coverage everywhere.',
    waypoints: [
      {col:0,row:7},{col:4,row:7},{col:4,row:2},{col:9,row:2},
      {col:9,row:5},{col:6,row:5},{col:6,row:9},{col:9,row:9},
      {col:9,row:12},{col:14,row:12},{col:14,row:7},{col:19,row:7},
    ],
  },
  {
    name: 'Twisted',
    theme: 'snow',
    difficulty: 'Hard',
    diffColor: '#e74c3c',
    desc: 'Unpredictable turns.\nNo clear defensive lane.',
    waypoints: [
      {col:0,row:2},{col:3,row:2},{col:3,row:7},{col:7,row:7},
      {col:7,row:4},{col:11,row:4},{col:11,row:11},{col:15,row:11},
      {col:15,row:6},{col:19,row:6},
    ],
  },
  {
    name: 'Spiral',
    theme: 'volcanic',
    difficulty: 'Expert',
    diffColor: '#9b59b6',
    desc: 'Winds deep inward.\nExtremely long. Good luck.',
    waypoints: [
      {col:0,row:0},{col:18,row:0},{col:18,row:12},{col:2,row:12},
      {col:2,row:2},{col:16,row:2},{col:16,row:10},{col:4,row:10},
      {col:4,row:4},{col:14,row:4},{col:14,row:8},{col:6,row:8},
      {col:6,row:6},{col:12,row:6},{col:12,row:7},{col:19,row:7},
    ],
  },
  {
    name: 'Descent',
    theme: 'meadow',
    difficulty: 'Easy',
    diffColor: '#2ecc71',
    desc: 'Enters from the north.\nThree long sweeps down.',
    waypoints: [
      {col:2,row:0},{col:2,row:2},{col:17,row:2},{col:17,row:6},
      {col:4,row:6},{col:4,row:10},{col:15,row:10},{col:15,row:13},
    ],
  },
  {
    name: 'Horseshoe',
    theme: 'autumn',
    difficulty: 'Medium',
    diffColor: '#f39c12',
    desc: 'In and out the same side.\nCover both arms at once.',
    waypoints: [
      {col:0,row:2},{col:16,row:2},{col:16,row:11},{col:0,row:11},
    ],
  },
  {
    name: 'Crossroads',
    theme: 'desert',
    difficulty: 'Medium',
    diffColor: '#f39c12',
    desc: 'The road crosses itself twice.\nHold the junctions.',
    waypoints: [
      {col:0,row:8},{col:7,row:8},{col:7,row:3},{col:3,row:3},
      {col:3,row:11},{col:17,row:11},{col:17,row:4},{col:14,row:4},
      {col:14,row:13},
    ],
  },
  {
    name: 'Sprint',
    theme: 'volcanic',
    difficulty: 'Expert',
    diffColor: '#9b59b6',
    desc: 'The shortest road in.\nEvery tower must count.',
    waypoints: [
      {col:0,row:11},{col:6,row:11},{col:6,row:6},{col:13,row:6},
      {col:13,row:2},{col:19,row:2},
    ],
  },
];

// ─── Map themes (looks) ───────────────────────────────────────────────────────
// Each map's `theme` picks one of these. render3d.js paints the island, scenery, sky,
// lights and ambient particles from it; the menu thumbnail uses `mini`.
// Colours given as 'r,g,b' are used inside rgba() with varying alpha.
const MEADOW = {
  grass: { base: '#4b8537', light: '122,178,76', dark: '42,96,40', blades: 3600,
           bladeCols: ['rgba(34,82,30,0.55)', 'rgba(126,184,86,0.45)', 'rgba(64,122,50,0.7)', 'rgba(150,200,100,0.3)'],
           tuft: 'rgba(30,72,28,0.8)', tufts: 230, flowers: ['#f4efe1', '#f6d04d', '#e98bb0', '#b8a4f2'], flowerCount: 110,
           edge: 'rgba(34,58,22,0.4)' },
  road:  { base: '#b48e58', light: '222,192,132', dark: '134,100,58', specks: ['rgba(106,78,40,0.55)', 'rgba(236,216,168,0.5)'],
           pebble: ['#d8cdb8', '#7d705c'], rut: '#5a4020', chevron: 'rgba(90,62,28,0.2)', glow: null },
  side:  { bands: ['#6b4a2b', '#5d3f24', '#74522f', '#4f351e', '#5a3d22', '#43301c', '#503820'], stone: '#7e7466',
           lip: '#3f7a30', lipHi: '#5c9c45' },
  scenery: { foliage: ['#2f6b2a', '#3b7d31', '#4a8f3a', '#2a5e2a'], trunk: '#6b4a2b', conifers: 0.55, trees: 0.62,
             bushes: ['#2f6b2a', '#3b7d31', '#4a8f3a'], rocks: ['#7e8189', '#6f717b', '#8d8e86'] },
  sky:   { css: 'radial-gradient(120% 90% at 50% 30%, #243449 0%, #141c2e 55%, #0b0f1b 100%)', fog: 0x121a2a },
  light: { sky: 0xcfe3ff, ground: 0x2f3b22, hemi: 0.44, sun: 0xfff0d8, sunI: 0.7, fill: 0x8fb0ff, fillI: 0.22 },
  ambient: { mode: 'firefly', count: 55, size: 0.13, additive: true, opacity: 1, colors: [[1, 0.85, 0.3], [0.65, 1, 0.8]] },
  mini:  { ground: '#2d4a2d', road: '#c8a96e' },
};
// Other themes are the meadow with sections replaced
const withMeadow = (over) => {
  const t = {};
  for (const k of Object.keys(MEADOW)) t[k] = Object.assign({}, MEADOW[k], over[k]);
  return t;
};
const THEMES = {
  meadow: MEADOW,
  autumn: withMeadow({
    grass: { base: '#8a8a3c', light: '196,170,90', dark: '110,96,40',
             bladeCols: ['rgba(120,100,40,0.55)', 'rgba(200,170,90,0.45)', 'rgba(150,130,60,0.6)', 'rgba(220,190,110,0.3)'],
             tuft: 'rgba(100,80,30,0.7)', flowers: ['#d9542b', '#e8a23a', '#b8342a', '#c0702a'], flowerCount: 160, // fallen leaves
             edge: 'rgba(70,50,20,0.35)' },
    road:  { base: '#a9845a' },
    side:  { lip: '#7a7a35', lipHi: '#a09a48' },
    scenery: { foliage: ['#c0532a', '#d9822b', '#e3b13c', '#9e3b22'], trunk: '#5a3a22', conifers: 0.25,
               bushes: ['#c0532a', '#d9822b', '#9e3b22'] },
    sky:   { css: 'radial-gradient(120% 90% at 50% 30%, #3a2d2a 0%, #1f1a1c 55%, #0f0c0e 100%)', fog: 0x1e1819 },
    light: { sky: 0xffe2c0, ground: 0x3b2a18, sun: 0xffc98a, sunI: 0.72, fill: 0xa08cff, fillI: 0.18 },
    ambient: { mode: 'leaf', count: 70, size: 0.12, additive: false, colors: [[0.85, 0.35, 0.15], [0.9, 0.55, 0.2], [0.75, 0.2, 0.12]] },
    mini:  { ground: '#6b6230' },
  }),
  desert: withMeadow({
    grass: { base: '#d8b878', light: '240,215,160', dark: '180,140,80', blades: 900,
             bladeCols: ['rgba(150,120,60,0.25)', 'rgba(240,220,170,0.3)', 'rgba(170,140,80,0.2)', 'rgba(250,235,195,0.2)'],
             tuft: 'rgba(120,110,50,0.6)', tufts: 80, flowers: [], flowerCount: 0, edge: 'rgba(120,90,40,0.25)' },
    road:  { base: '#a87a4e', light: '200,160,110', dark: '120,85,50', specks: ['rgba(110,78,45,0.5)', 'rgba(225,195,150,0.45)'],
             pebble: ['#d9c3a0', '#8a6a48'], rut: '#6a4a2a', chevron: 'rgba(90,60,30,0.2)' },
    side:  { bands: ['#c98e57', '#b97a45', '#d6a06a', '#a96a3c', '#c4864f', '#9c5f35', '#b5773f'], stone: '#a8784c',
             lip: '#d8b878', lipHi: '#ecd09a' },
    scenery: { foliage: ['#7d8a3e', '#8f9a4a', '#6b7536', '#a3a65a'], trunk: '#7a5a3a', conifers: 0.1, trees: 0.25,
               bushes: ['#8f8a4a', '#7d7a3e', '#a39a58'], rocks: ['#b98a5a', '#a8784c', '#c79c6c'] },
    sky:   { css: 'radial-gradient(120% 90% at 50% 30%, #4a3b2a 0%, #241c16 55%, #100c0a 100%)', fog: 0x2a2016 },
    light: { sky: 0xfff0d0, ground: 0x6a5030, hemi: 0.5, sun: 0xfff2c8, sunI: 0.8, fill: 0xa0b8ff, fillI: 0.18 },
    ambient: { mode: 'dust', count: 80, size: 0.1, additive: false, opacity: 0.35, colors: [[0.95, 0.85, 0.65]] },
    mini:  { ground: '#b8995c', road: '#8a603a' },
  }),
  snow: withMeadow({
    grass: { base: '#e8eef4', light: '255,255,255', dark: '190,205,222', blades: 1200,
             bladeCols: ['rgba(170,190,210,0.25)', 'rgba(255,255,255,0.4)', 'rgba(200,215,230,0.3)', 'rgba(150,170,195,0.15)'],
             tuft: 'rgba(120,140,110,0.5)', tufts: 60, flowers: [], flowerCount: 0, edge: 'rgba(120,140,170,0.35)' },
    road:  { base: '#9c8f80', light: '200,195,190', dark: '100,90,80', specks: ['rgba(80,70,60,0.5)', 'rgba(240,245,250,0.6)'],
             pebble: ['#cfd6de', '#7d8590'], rut: '#5f554a', chevron: 'rgba(70,60,50,0.2)' },
    side:  { bands: ['#6f7480', '#5f6470', '#7a808c', '#545864', '#686d79', '#4a4e58', '#626772'], stone: '#8a909c',
             lip: '#e8eef4', lipHi: '#ffffff' },
    scenery: { foliage: ['#1f4a3a', '#2a5a46', '#24503e', '#1a3f32'], trunk: '#4a3a2a', conifers: 0.9,
               bushes: ['#dfe7ef', '#c9d4df', '#eef3f8'], rocks: ['#aab4c0', '#c2cbd5', '#8e98a5'] },   // bushes are snow mounds
    sky:   { css: 'radial-gradient(120% 90% at 50% 30%, #2c3a4e 0%, #18202e 55%, #0b0f18 100%)', fog: 0x1a2232 },
    light: { sky: 0xdfeaff, ground: 0x8090a8, hemi: 0.5, sun: 0xeaf2ff, sunI: 0.62, fill: 0x9fc0ff, fillI: 0.25 },
    ambient: { mode: 'snow', count: 220, size: 0.12, additive: false, opacity: 0.85, colors: [[1, 1, 1]] },
    mini:  { ground: '#c9d4df', road: '#9c8f80' },
  }),
  volcanic: withMeadow({
    grass: { base: '#5a524d', light: '130,118,108', dark: '40,35,33', blades: 1500,
             bladeCols: ['rgba(20,18,18,0.5)', 'rgba(110,95,85,0.3)', 'rgba(60,52,48,0.5)', 'rgba(140,60,30,0.25)'],
             tuft: 'rgba(70,60,40,0.5)', tufts: 40, flowers: ['#ff7a2a', '#ffb347'], flowerCount: 40, edge: 'rgba(0,0,0,0.4)' },
    road:  { base: '#1c1615', light: '70,58,52', dark: '8,6,6', specks: ['rgba(10,8,8,0.6)', 'rgba(120,100,90,0.4)'],
             pebble: ['#5a504c', '#1e1a19'], rut: '#000000', chevron: 'rgba(255,90,30,0.12)', glow: '#ff6a1f' },
    side:  { bands: ['#3b3130', '#2e2625', '#463a37', '#251e1d', '#3a2f2d', '#1e1817', '#33292a'], stone: '#5a4038',
             lip: '#5a524d', lipHi: '#7a706a' },
    scenery: { foliage: ['#2b2422', '#3a2e2a', '#1f1a19', '#4a3a33'], trunk: '#1a1414', conifers: 0.4, trees: 0.35,
               bushes: ['#3a2e2a', '#2b2422', '#4a3a33'], rocks: ['#3d3533', '#2e2827', '#4a403c'] },
    sky:   { css: 'radial-gradient(120% 90% at 50% 30%, #3a1c16 0%, #1c0f0d 55%, #0c0605 100%)', fog: 0x1e0e0b },
    light: { sky: 0xffc0a0, ground: 0x401810, hemi: 0.55, sun: 0xffb890, sunI: 0.75, fill: 0xff6a3a, fillI: 0.25 },
    ambient: { mode: 'ember', count: 90, size: 0.11, additive: true, colors: [[1, 0.45, 0.1], [1, 0.7, 0.25]] },
    mini:  { ground: '#5a524d', road: '#2a1614' },
  }),
};
const mapTheme = (index) => THEMES[MAP_CONFIGS[index].theme] || MEADOW;

// ─── Active map state (mutable) ───────────────────────────────────────────────
let PATH_WAYPOINTS_TILES = [];
let PATH_WAYPOINTS       = [];
let PATH_TILES           = new Set();
let PATH_DIRECTIONS      = new Map(); // "col,row" → 'up'|'down'|'left'|'right'
let CURRENT_MAP_INDEX    = 0;

function buildPathTiles(waypoints) {
  const tiles = new Set();
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    if (a.col === b.col) {
      const lo = Math.min(a.row, b.row), hi = Math.max(a.row, b.row);
      for (let r = lo; r <= hi; r++) tiles.add(`${a.col},${r}`);
    } else {
      const lo = Math.min(a.col, b.col), hi = Math.max(a.col, b.col);
      for (let c = lo; c <= hi; c++) tiles.add(`${c},${a.row}`);
    }
  }
  return tiles;
}

function buildPathDirections(waypoints) {
  const dirs = new Map();
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    let dir;
    if (a.col === b.col) {
      dir = b.row > a.row ? 'down' : 'up';
      const lo = Math.min(a.row, b.row), hi = Math.max(a.row, b.row);
      for (let r = lo; r <= hi; r++) dirs.set(`${a.col},${r}`, dir);
    } else {
      dir = b.col > a.col ? 'right' : 'left';
      const lo = Math.min(a.col, b.col), hi = Math.max(a.col, b.col);
      for (let c = lo; c <= hi; c++) dirs.set(`${c},${a.row}`, dir);
    }
  }
  return dirs;
}

function setMap(index) {
  CURRENT_MAP_INDEX    = index;
  PATH_WAYPOINTS_TILES = MAP_CONFIGS[index].waypoints;
  PATH_WAYPOINTS       = PATH_WAYPOINTS_TILES.map(w => ({
    x: w.col * TILE_SIZE + TILE_SIZE / 2,
    y: w.row * TILE_SIZE + TILE_SIZE / 2,
  }));
  PATH_TILES      = buildPathTiles(PATH_WAYPOINTS_TILES);
  PATH_DIRECTIONS = buildPathDirections(PATH_WAYPOINTS_TILES);
}

// Initialise with map 0
setMap(0);

function isPathTile(col, row) {
  return PATH_TILES.has(`${col},${row}`);
}

// ─── Mini-map preview (for map selection screen) ──────────────────────────────
// Minimaps never change, so each is painted once into an offscreen canvas at the target
// context's pixel scale and reused every frame; repainted only if the size or scale changes.
const miniMapCache = new Map();   // mapIndex → { key, canvas }
const MINI_PAD = 4;               // room for the start/end dots, which overhang the edge tiles

function drawMiniMap(ctx, mapIndex, x, y, w, h) {
  const scale = ctx.getTransform().a;
  const key   = `${w}x${h}@${scale}`;
  let entry   = miniMapCache.get(mapIndex);
  if (!entry || entry.key !== key) {
    const c = document.createElement('canvas');
    c.width  = Math.ceil((w + MINI_PAD * 2) * scale);
    c.height = Math.ceil((h + MINI_PAD * 2) * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    paintMiniMap(g, mapIndex, MINI_PAD, MINI_PAD, w, h);
    entry = { key, canvas: c };
    miniMapCache.set(mapIndex, entry);
  }
  ctx.drawImage(entry.canvas, x - MINI_PAD, y - MINI_PAD, w + MINI_PAD * 2, h + MINI_PAD * 2);
}

function paintMiniMap(ctx, mapIndex, x, y, w, h) {
  const cfg   = MAP_CONFIGS[mapIndex];
  const scaleX = w / (COLS * TILE_SIZE);
  const scaleY = h / (ROWS * TILE_SIZE);
  const tiles  = buildPathTiles(cfg.waypoints);
  const mini   = mapTheme(mapIndex).mini;

  // Background
  ctx.fillStyle = mini.ground;
  ctx.fillRect(x, y, w, h);

  // Tiles
  const tw = Math.ceil(TILE_SIZE * scaleX);
  const th = Math.ceil(TILE_SIZE * scaleY);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (tiles.has(`${col},${row}`)) {
        ctx.fillStyle = mini.road;
        ctx.fillRect(x + col * TILE_SIZE * scaleX, y + row * TILE_SIZE * scaleY, tw, th);
      }
    }
  }

  // Path line
  ctx.strokeStyle = 'rgba(255,200,100,0.6)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  cfg.waypoints.forEach((wp, i) => {
    const px = x + (wp.col * TILE_SIZE + TILE_SIZE / 2) * scaleX;
    const py = y + (wp.row * TILE_SIZE + TILE_SIZE / 2) * scaleY;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Start / end dots
  const s  = cfg.waypoints[0];
  const e  = cfg.waypoints[cfg.waypoints.length - 1];
  [[s, '#2ecc71'], [e, '#e74c3c']].forEach(([wp, col]) => {
    ctx.beginPath();
    ctx.arc(x + (wp.col * TILE_SIZE + TILE_SIZE / 2) * scaleX,
            y + (wp.row * TILE_SIZE + TILE_SIZE / 2) * scaleY, 4, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
}
