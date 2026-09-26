const TILE_SIZE = 64;
const COLS      = 20;
const ROWS      = 14;
const UI_WIDTH  = 200;
const CANVAS_W  = COLS * TILE_SIZE + UI_WIDTH; // 1160
const CANVAS_H  = ROWS * TILE_SIZE;            // 672

// ─── Map definitions ──────────────────────────────────────────────────────────
const MAP_CONFIGS = [
  {
    name: 'S-Curve',
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
];

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

// ─── Map rendering ────────────────────────────────────────────────────────────
function drawMap(ctx) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (isPathTile(col, row)) {
        ctx.fillStyle = '#c8a96e';
      } else {
        ctx.fillStyle = (col + row) % 2 === 0 ? '#4a7c3f' : '#3d6b35';
      }
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth   = 0.5;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * TILE_SIZE, 0); ctx.lineTo(c * TILE_SIZE, CANVAS_H); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * TILE_SIZE); ctx.lineTo(COLS * TILE_SIZE, r * TILE_SIZE); ctx.stroke();
  }

  // Path edge shading — draw a "curb" line only where path meets grass
  // Inner shadow (dark line on path side)
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'square';
  PATH_TILES.forEach(key => {
    const [c, r] = key.split(',').map(Number);
    const px = c * TILE_SIZE, py = r * TILE_SIZE;
    // [dc, dr, x1, y1, x2, y2, shadow-offset direction]
    const edges = [
      [0, -1, px,            py,            px + TILE_SIZE, py           ],  // top
      [1,  0, px + TILE_SIZE, py,            px + TILE_SIZE, py + TILE_SIZE], // right
      [0,  1, px,            py + TILE_SIZE, px + TILE_SIZE, py + TILE_SIZE], // bottom
      [-1, 0, px,            py,             px,            py + TILE_SIZE],  // left
    ];
    for (const [dc, dr, x1, y1, x2, y2] of edges) {
      if (!PATH_TILES.has(`${c + dc},${r + dr}`)) {
        // Dark shadow on the grass side of the border
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        // Lighter inner highlight on the path side (gives sunken-road feel)
        ctx.strokeStyle = 'rgba(80,50,10,0.18)';
        const inset = 2.5;
        const ix1 = x1 + (dc === -1 ? inset : dc === 1 ? -inset : 0);
        const iy1 = y1 + (dr === -1 ? inset : dr === 1 ? -inset : 0);
        const ix2 = x2 + (dc === -1 ? inset : dc === 1 ? -inset : 0);
        const iy2 = y2 + (dr === -1 ? inset : dr === 1 ? -inset : 0);
        ctx.beginPath(); ctx.moveTo(ix1, iy1); ctx.lineTo(ix2, iy2); ctx.stroke();
      }
    }
  });
  ctx.lineCap = 'butt';

  // Direction arrows on path tiles
  const ARROW_ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  PATH_DIRECTIONS.forEach((dir, key) => {
    const [c, r] = key.split(',').map(Number);
    const cx = c * TILE_SIZE + TILE_SIZE / 2;
    const cy = r * TILE_SIZE + TILE_SIZE / 2;
    const s  = 7;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ARROW_ANGLES[dir] || 0);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.55, -s * 0.7);
    ctx.lineTo(-s * 0.15, 0);
    ctx.lineTo(-s * 0.55, s * 0.7);
    ctx.closePath();
    ctx.fillStyle = 'rgba(155,105,25,0.42)';
    ctx.fill();
    ctx.restore();
  });

  // START marker
  const s = PATH_WAYPOINTS_TILES[0];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(s.col * TILE_SIZE, s.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle   = '#2ecc71';
  ctx.font        = 'bold 10px Arial';
  ctx.textAlign   = 'center';
  ctx.fillText('START', s.col * TILE_SIZE + TILE_SIZE / 2, s.row * TILE_SIZE + TILE_SIZE / 2 + 4);

  // END marker
  const e = PATH_WAYPOINTS_TILES[PATH_WAYPOINTS_TILES.length - 1];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(e.col * TILE_SIZE, e.row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle   = '#e74c3c';
  ctx.fillText('END', e.col * TILE_SIZE + TILE_SIZE / 2, e.row * TILE_SIZE + TILE_SIZE / 2 + 4);
  ctx.textAlign   = 'left';
}

// ─── Mini-map preview (for map selection screen) ──────────────────────────────
function drawMiniMap(ctx, mapIndex, x, y, w, h) {
  const cfg   = MAP_CONFIGS[mapIndex];
  const scaleX = w / (COLS * TILE_SIZE);
  const scaleY = h / (ROWS * TILE_SIZE);
  const tiles  = buildPathTiles(cfg.waypoints);

  // Background
  ctx.fillStyle = '#2d4a2d';
  ctx.fillRect(x, y, w, h);

  // Tiles
  const tw = Math.ceil(TILE_SIZE * scaleX);
  const th = Math.ceil(TILE_SIZE * scaleY);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (tiles.has(`${col},${row}`)) {
        ctx.fillStyle = '#c8a96e';
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
