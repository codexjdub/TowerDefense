// ─── 3D renderer (Three.js) ──────────────────────────────────────────────────
// Draws the game area as a 3D scene on #scene3d. Game logic stays where it was:
// this module only reads `state` (towers, enemies, projectiles) and mirrors it
// into the scene every frame. The 2D canvas on top keeps the sidebar and overlays.
//
// Coordinates: one tile = one world unit. Game pixel (x, y) maps to world
// (x / TILE_SIZE - COLS / 2, height, y / TILE_SIZE - ROWS / 2); +Y is up.

const Render3D = (() => {
  // Stand-in used when Three.js didn't load or WebGL is unavailable (keep in step with the real API below)
  const noop = () => {};
  const STUB = { ok: false, render: noop, resize: noop, drawOverlay: noop, pickTile: () => null, project: () => [0, 0, 0],
                 orbit: noop, zoom: noop, zoomBy: noop, resetCamera: noop, onSpawn: noop, onDeath: noop, onEscape: noop,
                 onExplosion: noop, onPlace: noop, onUpgrade: noop, onSell: noop };
  if (!window.THREE) return STUB;

  const T = TILE_SIZE, TAU = Math.PI * 2;
  const BW = COLS + 2, BH = ROWS + 2;           // board plus a one-tile border ring
  const GRASS_Y = 0.18, BASE_Y = -1.6, PX = 80;  // grass height, island bottom, texture px per tile
  const GAME_W = COLS * TILE_SIZE;               // logical width of the 3D view (sidebar excluded)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toX = x => x / T - COLS / 2, toZ = y => y / T - ROWS / 2;
  const tileX = c => c + 0.5 - COLS / 2, tileZ = r => r + 0.5 - ROWS / 2;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function lerpAngle(a, b, k) { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * k; }
  function mulberry32(a) {
    return () => {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ─── Renderer, scene, lights ───────────────────────────────────────────────
  const canvas3d = document.getElementById('scene3d');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: true }); }
  catch (err) { return STUB; }
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x121a2a, 40, 80);
  const camera = new THREE.PerspectiveCamera(30, GAME_W / CANVAS_H, 0.1, 200);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2f3b22, 0.44);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 0.7);
  sun.position.set(-9, 17, -7);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fillLight = new THREE.DirectionalLight(0x8fb0ff, 0.22);
  fillLight.position.set(10, 6, 12);
  scene.add(fillLight);

  // Geometries, materials and textures reused across objects are never disposed
  const SHARED = new Set();
  function disposeTree(root) {
    root.traverse(o => {
      if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (SHARED.has(m)) continue;
        for (const tex of [m.map, m.emissiveMap]) if (tex && !SHARED.has(tex)) tex.dispose();
        m.dispose();
      }
    });
  }

  // ─── Textures ──────────────────────────────────────────────────────────────
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function radialTex(stops, size = 128) {
    const c = makeCanvas(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    SHARED.add(t);
    return t;
  }
  const GLOW = radialTex([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
  const DOT = radialTex([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']], 64);
  const SOFT = radialTex([[0, 'rgba(255,255,255,0.85)'], [0.55, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const SCORCH = radialTex([[0, 'rgba(20,12,6,0.85)'], [0.55, 'rgba(30,20,10,0.5)'], [1, 'rgba(30,20,10,0)']]);
  // Muzzle flash: a bright core with four long spikes and four short ones
  const STAR = (() => {
    const s = 128, c = makeCanvas(s, s), g = c.getContext('2d');
    g.translate(s / 2, s / 2);
    const core = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.22);
    core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(-s / 2, -s / 2, s, s);
    for (let i = 0; i < 8; i++) {
      const len = s * (i % 2 ? 0.26 : 0.48), w = s * (i % 2 ? 0.035 : 0.05);
      g.save(); g.rotate(i / 8 * TAU);
      const sp = g.createLinearGradient(0, 0, len, 0);
      sp.addColorStop(0, 'rgba(255,255,255,0.95)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sp; g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    SHARED.add(t);
    return t;
  })();
  // Frost patch under slowed enemies: an icy disc with six-fold crystal spikes
  const FROST = (() => {
    const s = 128, c = makeCanvas(s, s), g = c.getContext('2d'), rng = mulberry32(77);
    const disc = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    disc.addColorStop(0, 'rgba(230,248,255,0.95)'); disc.addColorStop(0.6, 'rgba(175,220,250,0.65)'); disc.addColorStop(1, 'rgba(150,200,240,0)');
    g.fillStyle = disc; g.fillRect(0, 0, s, s);
    g.translate(s / 2, s / 2); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + rng() * 0.2, len = s * (0.36 + rng() * 0.1);
      g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
      g.lineWidth = 1.4;
      for (const f of [0.45, 0.7]) {                       // side branches
        const bx = Math.cos(a) * len * f, by = Math.sin(a) * len * f, bl = len * 0.22;
        for (const d of [-0.7, 0.7]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + d) * bl, by + Math.sin(a + d) * bl); g.stroke(); }
      }
    }
    const t = new THREE.CanvasTexture(c);
    SHARED.add(t);
    return t;
  })();

  // ─── Board (recomputed whenever the map changes) ───────────────────────────
  let WP = [], START_DIR, END_DIR, START_EXT, END_EXT, extSet = new Set(), ROAD_PTS = [];
  const inBoard = (c, r) => c >= -1 && c <= COLS && r >= -1 && r <= ROWS;
  const isRoad = (c, r) => isPathTile(c, r) || extSet.has(`${c},${r}`);
  function groundAt(x, z) {
    const c = Math.floor(x + COLS / 2), r = Math.floor(z + ROWS / 2);
    return !inBoard(c, r) ? -50 : isRoad(c, r) ? 0 : GRASS_Y;
  }
  function computeBoard() {
    WP = PATH_WAYPOINTS_TILES;
    const s0 = WP[0], s1 = WP[1], e0 = WP[WP.length - 2], e1 = WP[WP.length - 1];
    START_DIR = { c: Math.sign(s1.col - s0.col), r: Math.sign(s1.row - s0.row) };
    END_DIR = { c: Math.sign(e1.col - e0.col), r: Math.sign(e1.row - e0.row) };
    START_EXT = { col: s0.col - START_DIR.c, row: s0.row - START_DIR.r };
    END_EXT = { col: e1.col + END_DIR.c, row: e1.row + END_DIR.r };
    extSet = new Set([`${START_EXT.col},${START_EXT.row}`, `${END_EXT.col},${END_EXT.row}`]);
    const P = WP.map(w => ({ x: (w.col + 1.5) * PX, y: (w.row + 1.5) * PX }));
    const ext = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1; return { x: a.x + dx / d * PX * 1.6, y: a.y + dy / d * PX * 1.6 }; };
    ROAD_PTS = [ext(P[0], P[1]), ...P, ext(P[P.length - 1], P[P.length - 2])];
  }
  function strokePoly(ctx, pts, width, style) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'butt'; ctx.strokeStyle = style; ctx.stroke();
  }
  function samplePoly(pts, step) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      for (let d = 0; d < len; d += step) out.push({ x: a.x + ux * d, y: a.y + uy * d, nx: -uy, ny: ux });
    }
    return out;
  }

  // The current map's look (THEMES in map.js), set by buildMap before anything is painted
  let TH = MEADOW;

  function paintGrass() {
    const W = BW * PX, H = BH * PX, c = makeCanvas(W, H), ctx = c.getContext('2d'), t = TH.grass;
    const rng = mulberry32(90210 + CURRENT_MAP_INDEX * 977), R = (a, b) => a + rng() * (b - a), u = PX / 64;
    const onRoad = (x, y) => isRoad(Math.floor(x / PX) - 1, Math.floor(y / PX) - 1);
    ctx.fillStyle = t.base; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      const x = R(0, W), y = R(0, H), r = R(50, 170) * u, light = rng() < 0.5;
      const col = light ? t.light : t.dark, a = light ? R(0.10, 0.22) : R(0.12, 0.26);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.lineCap = 'round'; ctx.lineWidth = 1.2 * u;
    for (const col of t.bladeCols) {
      ctx.beginPath();
      for (let i = 0; i < t.blades; i++) {
        const x = R(0, W), y = R(0, H), h = R(3, 7) * u, lean = R(-2.2, 2.2) * u;
        if (onRoad(x, y)) continue;
        ctx.moveTo(x, y); ctx.lineTo(x + lean, y - h);
      }
      ctx.strokeStyle = col; ctx.stroke();
    }
    ctx.strokeStyle = t.tuft; ctx.lineWidth = 1.5 * u; ctx.beginPath();
    for (let i = 0; i < t.tufts; i++) {
      const x = R(0, W), y = R(0, H), n = 3 + Math.floor(rng() * 3);
      if (onRoad(x, y)) continue;
      for (let j = 0; j < n; j++) {
        const a = -Math.PI / 2 + (j - (n - 1) / 2) * 0.35 + R(-0.1, 0.1), h = R(6, 10) * u;
        ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * h * 0.4, y + Math.sin(a) * h * 0.6, x + Math.cos(a) * h, y + Math.sin(a) * h);
      }
    }
    ctx.stroke();
    const petals = t.flowers;
    for (let i = 0; i < t.flowerCount; i++) {
      const cx = R(0, W), cy = R(0, H), col = petals[Math.floor(rng() * petals.length)], n = 2 + Math.floor(rng() * 4);
      for (let j = 0; j < n; j++) {
        const x = cx + R(-9, 9) * u, y = cy + R(-7, 7) * u;
        if (onRoad(x, y)) continue;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2.1 * u, 0, TAU); ctx.fill();
        ctx.fillStyle = col === '#f6d04d' ? '#b86e12' : '#f3c33a'; ctx.beginPath(); ctx.arc(x, y, 0.8 * u, 0, TAU); ctx.fill();
      }
    }
    strokePoly(ctx, ROAD_PTS, PX * 1.28, t.edge);
    return c;
  }
  // Returns the road texture canvas, plus a glow canvas (emissive map) when the theme has one
  function paintRoad() {
    const W = BW * PX, H = BH * PX, c = makeCanvas(W, H), ctx = c.getContext('2d'), t = TH.road;
    const rng = mulberry32(777 + CURRENT_MAP_INDEX), R = (a, b) => a + rng() * (b - a), u = PX / 64;
    ctx.fillStyle = t.base; ctx.fillRect(0, 0, W, H);
    const samples = samplePoly(ROAD_PTS, 6 * u);
    for (const s of samples) {
      if (rng() < 0.55) continue;
      const off = R(-0.42, 0.42) * PX, x = s.x + s.nx * off, y = s.y + s.ny * off, r = R(12, 36) * u, light = rng() < 0.5;
      const col = light ? t.light : t.dark;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${col},${R(0.18, 0.35)})`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const col of t.specks) {
      ctx.fillStyle = col; ctx.beginPath();
      for (const s of samples) for (let j = 0; j < 3; j++) {
        const off = R(-0.5, 0.5) * PX, x = s.x + s.nx * off + R(-3, 3) * u, y = s.y + s.ny * off + R(-3, 3) * u, r = R(0.6, 1.5) * u;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
    }
    for (const s of samples) {
      if (rng() > 0.07) continue;
      const off = R(-0.38, 0.38) * PX, x = s.x + s.nx * off, y = s.y + s.ny * off, r = R(1.8, 3.4) * u;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + r * 0.3, y + r * 0.4, r, r * 0.75, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
      g.addColorStop(0, t.pebble[0]); g.addColorStop(1, t.pebble[1]);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, 0, 0, TAU); ctx.fill();
    }
    // Wheel ruts: two thin bands either side of the centre line
    const band = makeCanvas(W, H), b = band.getContext('2d');
    strokePoly(b, ROAD_PTS, 0.72 * PX, t.rut);
    b.globalCompositeOperation = 'destination-out';
    strokePoly(b, ROAD_PTS, 0.6 * PX, '#000');
    ctx.globalAlpha = 0.22; ctx.drawImage(band, 0, 0); ctx.globalAlpha = 1;
    // Worn direction chevrons
    const ANG = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
    ctx.fillStyle = t.chevron;
    PATH_DIRECTIONS.forEach((dir, key) => {
      const [cc, rr] = key.split(',').map(Number);
      if ((cc + rr) % 2) return;
      ctx.save(); ctx.translate((cc + 1.5) * PX, (rr + 1.5) * PX); ctx.rotate(ANG[dir]);
      ctx.beginPath(); ctx.moveTo(8 * u, 0); ctx.lineTo(-5 * u, -8 * u); ctx.lineTo(-1 * u, 0); ctx.lineTo(-5 * u, 8 * u); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    // Glowing cracks (volcanic): drawn on both the colour map and a black emissive map
    let glow = null;
    if (t.glow) {
      glow = makeCanvas(W, H);
      const gl = glow.getContext('2d');
      gl.fillStyle = '#000'; gl.fillRect(0, 0, W, H);
      for (const k of [ctx, gl]) { k.strokeStyle = t.glow; k.lineCap = 'round'; k.lineJoin = 'round'; }
      const crack = mulberry32(4242 + CURRENT_MAP_INDEX), C = (a, b) => a + crack() * (b - a);
      for (const s of samples) {
        if (crack() > 0.1) continue;
        let x = s.x + s.nx * C(-0.3, 0.3) * PX, y = s.y + s.ny * C(-0.3, 0.3) * PX, a = C(0, TAU);
        const pts = [[x, y]];
        for (let i = 0, n = 3 + Math.floor(crack() * 4); i < n; i++) {
          a += C(-0.9, 0.9); x += Math.cos(a) * C(5, 11) * u; y += Math.sin(a) * C(5, 11) * u; pts.push([x, y]);
        }
        const w = C(1.2, 2.6) * u;
        for (const k of [ctx, gl]) {
          k.lineWidth = w; k.beginPath(); pts.forEach(([px, py], i) => i ? k.lineTo(px, py) : k.moveTo(px, py)); k.stroke();
        }
      }
    }
    return { map: c, glow };
  }
  function paintSide() {
    const W = 64, H = 512, c = makeCanvas(W, H), ctx = c.getContext('2d'), rng = mulberry32(31);
    const lip = Math.round(H * 0.045);
    const t = TH.side, bands = t.bands;
    let y = lip - 4;
    while (y < H) { const h = 18 + rng() * 60; ctx.fillStyle = bands[Math.floor(rng() * bands.length)]; ctx.fillRect(0, y, W, h + 1); y += h; }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(20,12,6,0.35)' : 'rgba(200,170,120,0.18)';
      ctx.fillRect(rng() * W, lip + rng() * (H - lip), 1 + rng() * 2, 1 + rng() * 2);
    }
    for (let i = 0; i < 22; i++) {
      const x = rng() * W, yy = lip + 20 + rng() * (H - lip - 20), r = 2 + rng() * 4;
      ctx.fillStyle = t.stone; ctx.beginPath(); ctx.ellipse(x, yy, r, r * 0.7, 0, 0, TAU); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, lip, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, lip, W, H - lip);
    ctx.fillStyle = t.lip; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0);
    for (let x = W; x >= 0; x -= 4) ctx.lineTo(x, lip + (rng() - 0.3) * 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = t.lipHi; ctx.fillRect(0, 0, W, 3);
    return c;
  }
  function paintSwirl() {
    const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d');
    ctx.translate(s / 2, s / 2); ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const f = i / 40, a = f * 3.6 + k * Math.PI / 2, r = 8 + f * 112;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.strokeStyle = 'rgba(190,130,255,0.85)'; ctx.lineWidth = 11; ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,230,255,0.9)'); g.addColorStop(0.35, 'rgba(160,90,255,0.35)'); g.addColorStop(1, 'rgba(90,30,160,0)');
    ctx.fillStyle = g; ctx.fillRect(-128, -128, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  // ─── Mesh helpers ──────────────────────────────────────────────────────────
  const matCache = new Map();
  function phong(hex, opts = {}) {
    const key = hex + JSON.stringify(opts);
    if (!matCache.has(key)) {
      const m = new THREE.MeshPhongMaterial(Object.assign({ color: hex, flatShading: true, shininess: 40, specular: 0x333333 }, opts));
      SHARED.add(m); matCache.set(key, m);
    }
    return matCache.get(key);
  }
  function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const alongX = geo => geo.rotateZ(-Math.PI / 2);
  const geoCache = new Map();
  function G(key, fn) {
    if (!geoCache.has(key)) { const g = fn(); SHARED.add(g); geoCache.set(key, g); }
    return geoCache.get(key);
  }
  function glowSprite(hex, scale, opacity) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(scale);
    return s;
  }

  // ─── Map: ground, scenery, portal, gatehouse ───────────────────────────────
  let mapGroup = null, builtFor = null, grassMesh = null, roadMesh = null;
  const portal = { group: null, swirl: null, glow: null, mats: [], fade: 1 };
  const gate = { group: null, flags: [], torches: [], mats: [], fade: 1 };

  function buildGround(parent) {
    const top = { pos: [], nor: [], uv: [], idx: [] }, side = { pos: [], nor: [], uv: [], idx: [] };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    function quad(buf, a, b, c, d, n, uvs) {
      const cr = cross(sub(b, a), sub(c, a));
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) { [b, d] = [d, b]; uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
      const base = buf.pos.length / 3;
      [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]].forEach(([p, t]) => { buf.pos.push(...p); buf.nor.push(...n); buf.uv.push(...t); });
      buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const V = y => (y - BASE_Y) / (GRASS_Y - BASE_Y);
    function wall(c, r, dc, dr, yb, yt) {
      const x0 = c - COLS / 2, z0 = r - ROWS / 2, x1 = x0 + 1, z1 = z0 + 1, vb = V(yb), vt = V(yt);
      const uvs = [[0, vb], [0, vt], [1, vt], [1, vb]];
      if (dc === 1) quad(side, [x1, yb, z0], [x1, yt, z0], [x1, yt, z1], [x1, yb, z1], [1, 0, 0], uvs);
      if (dc === -1) quad(side, [x0, yb, z1], [x0, yt, z1], [x0, yt, z0], [x0, yb, z0], [-1, 0, 0], uvs);
      if (dr === 1) quad(side, [x1, yb, z1], [x1, yt, z1], [x0, yt, z1], [x0, yb, z1], [0, 0, 1], uvs);
      if (dr === -1) quad(side, [x0, yb, z0], [x0, yt, z0], [x1, yt, z0], [x1, yb, z0], [0, 0, -1], uvs);
    }
    const U = x => (x + BW / 2) / BW, Vt = z => 1 - (z + BH / 2) / BH;
    for (let r = -1; r <= ROWS; r++) for (let c = -1; c <= COLS; c++) {
      const road = isRoad(c, r);
      if (!road) {
        const x0 = c - COLS / 2, z0 = r - ROWS / 2, x1 = x0 + 1, z1 = z0 + 1, y = GRASS_Y;
        quad(top, [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0],
          [[U(x0), Vt(z0)], [U(x0), Vt(z1)], [U(x1), Vt(z1)], [U(x1), Vt(z0)]]);
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (!inBoard(nc, nr)) wall(c, r, dc, dr, BASE_Y, road ? 0 : GRASS_Y);
        else if (!road && isRoad(nc, nr)) wall(c, r, dc, dr, 0, GRASS_Y);
      }
    }
    const mk = (buf, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
      g.setIndex(buf.idx);
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true;
      return m;
    };
    grassMesh = mk(top, new THREE.MeshLambertMaterial({ map: toTexture(paintGrass()) }));
    parent.add(grassMesh);
    parent.add(mk(side, new THREE.MeshLambertMaterial({ map: toTexture(paintSide()) })));
    const road = paintRoad();
    const roadMat = new THREE.MeshLambertMaterial({ map: toTexture(road.map) });
    if (road.glow) Object.assign(roadMat, { emissive: new THREE.Color('#ffffff'), emissiveMap: toTexture(road.glow) });
    roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH).rotateX(-Math.PI / 2), roadMat);
    roadMesh.receiveShadow = true;
    parent.add(roadMesh);
  }

  const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)];
  function rock(parent, x, y, z, s, rng) {
    const m = mesh(G('rock', () => new THREE.DodecahedronGeometry(0.2, 0)), phong(pickFrom(TH.scenery.rocks, rng)), x, y, z);
    m.scale.set(s * (0.9 + rng() * 0.5), s * (0.5 + rng() * 0.3), s * (0.8 + rng() * 0.4));
    m.rotation.set(rng() * 0.4, rng() * TAU, rng() * 0.4);
    parent.add(m);
    return m;
  }
  function tree(parent, x, z, s, rng) {
    const sc = TH.scenery, leaves = sc.foliage;
    const g = new THREE.Group(); g.position.set(x, GRASS_Y, z); g.scale.setScalar(s); g.rotation.y = rng() * TAU;
    g.add(mesh(G('trunk', () => new THREE.CylinderGeometry(0.05, 0.08, 0.36, 6)), phong(sc.trunk), 0, 0.18, 0));
    if (rng() < sc.conifers) {
      for (let i = 0; i < 3; i++) g.add(mesh(G('cone' + i, () => new THREE.ConeGeometry(0.34 - i * 0.08, 0.42, 7)), phong(leaves[i % leaves.length]), 0, 0.42 + i * 0.22, 0));
    } else {
      g.add(mesh(G('blob', () => new THREE.IcosahedronGeometry(0.3, 0)), phong(pickFrom(leaves, rng)), 0, 0.55, 0));
      g.add(mesh(G('blob2', () => new THREE.IcosahedronGeometry(0.2, 0)), phong(pickFrom(leaves, rng)), 0.14, 0.72, 0.06));
    }
    parent.add(g);
  }
  function bush(parent, x, z, s, rng) {
    const m = mesh(G('bush', () => new THREE.IcosahedronGeometry(0.2, 0)), phong(pickFrom(TH.scenery.bushes, rng)), x, GRASS_Y + 0.1 * s, z);
    m.scale.set(s * 1.2, s * 0.8, s); m.rotation.y = rng() * TAU;
    parent.add(m);
  }
  function buildScenery(parent) {
    const rng = mulberry32(2024 + CURRENT_MAP_INDEX);
    const nearEnd = (c, r) => [START_EXT, END_EXT].some(t => Math.abs(t.col - c) <= 1 && Math.abs(t.row - r) <= 1);
    for (let r = -1; r <= ROWS; r++) for (let c = -1; c <= COLS; c++) {
      const border = c === -1 || c === COLS || r === -1 || r === ROWS;
      if (!border || isRoad(c, r) || nearEnd(c, r)) continue;
      const x = tileX(c), z = tileZ(r);
      if (r === ROWS) {                              // front edge stays low so it never hides the board
        if (rng() < 0.5) bush(parent, x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 0.4, 0.8 + rng() * 0.6, rng);
        if (rng() < 0.3) rock(parent, x + (rng() - 0.5) * 0.6, GRASS_Y + 0.04, z, 0.9 + rng() * 0.6, rng);
        continue;
      }
      const roll = rng(), trees = TH.scenery.trees;   // rocks take up most of what trees leave
      if (roll < trees) {
        tree(parent, x + (rng() - 0.5) * 0.4, z + (rng() - 0.5) * 0.4, 0.85 + rng() * 0.5, rng);
        if (rng() < 0.35) tree(parent, x + (rng() - 0.5) * 0.7, z + (rng() - 0.5) * 0.7, 0.6 + rng() * 0.3, rng);
      } else if (roll < trees + (1 - trees) * 0.6) {
        rock(parent, x + (rng() - 0.5) * 0.4, GRASS_Y + 0.05, z + (rng() - 0.5) * 0.4, 1 + rng() * 1.2, rng);
      } else bush(parent, x, z, 1 + rng() * 0.5, rng);
    }
  }
  function buildPortal(parent) {
    const g = new THREE.Group(), rng = mulberry32(5), s0 = WP[0];
    g.position.set(tileX(s0.col) - START_DIR.c * 0.7, 0, tileZ(s0.row) - START_DIR.r * 0.7);
    g.rotation.y = -Math.atan2(START_DIR.r, START_DIR.c);
    const stone = phong('#7a7d86', { shininess: 10 });
    for (const s of [-1, 1]) g.add(mesh(G('pillar', () => new THREE.BoxGeometry(0.2, 0.95, 0.22)), stone, 0, 0.475, s * 0.52));
    const arch = mesh(G('arch', () => new THREE.TorusGeometry(0.52, 0.1, 6, 14, Math.PI)), stone, 0, 0.95, 0);
    arch.rotation.y = Math.PI / 2; g.add(arch);
    g.add(mesh(G('keystone', () => new THREE.BoxGeometry(0.24, 0.2, 0.2)), phong('#8d9099'), 0, 1.5, 0));
    // Opening: an ellipse filling the pillars and the arch
    const disc = new THREE.Mesh(G('portalDisc', () => new THREE.CircleGeometry(0.5, 32)), new THREE.MeshBasicMaterial({ color: '#12061f' }));
    disc.rotation.y = Math.PI / 2; disc.position.set(-0.02, 0.75, 0); disc.scale.set(0.9, 1.44, 1); g.add(disc);
    portal.swirl = new THREE.Mesh(G('portalDisc', () => new THREE.CircleGeometry(0.5, 32)), new THREE.MeshBasicMaterial({ map: paintSwirl(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const holder = new THREE.Group(); holder.rotation.y = Math.PI / 2; holder.position.set(0.01, 0.75, 0); holder.scale.set(0.9, 1.44, 1);
    holder.add(portal.swirl); g.add(holder);
    portal.glow = glowSprite('#a36bff', 2.2, 0.55); portal.glow.position.set(0.3, 0.8, 0); g.add(portal.glow);
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI - Math.PI / 2;
      rock(g, -0.15 - Math.cos(a) * 0.2, 0.05, Math.sin(a) * (0.75 + rng() * 0.2), 1.1 + rng() * 0.6, rng);
    }
    portal.group = g; portal.mats = fadeable(g);
    parent.add(g);
  }
  function buildGate(parent) {
    const g = new THREE.Group(), e1 = WP[WP.length - 1];
    gate.flags = []; gate.torches = [];
    g.position.set(tileX(e1.col) + END_DIR.c * 0.6, 0, tileZ(e1.row) + END_DIR.r * 0.6);
    g.rotation.y = -Math.atan2(END_DIR.r, END_DIR.c);
    const stone = phong('#9aa0a8', { shininess: 12 }), dark = phong('#6b7079', { shininess: 8 });
    for (const s of [-1, 1]) {
      g.add(mesh(G('gtower', () => new THREE.CylinderGeometry(0.27, 0.31, 1.3, 8)), stone, 0.1, 0.65, s * 0.68));
      g.add(mesh(G('groof', () => new THREE.ConeGeometry(0.36, 0.56, 8)), phong('#8e2b23', { shininess: 25 }), 0.1, 1.58, s * 0.68));
      g.add(mesh(G('gring', () => new THREE.CylinderGeometry(0.33, 0.33, 0.06, 8)), dark, 0.1, 1.3, s * 0.68));
      g.add(mesh(G('pole', () => new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4)), phong('#3a3226'), 0.1, 2.0, s * 0.68));
      const flag = new THREE.Mesh(G('flag', () => new THREE.PlaneGeometry(0.3, 0.17).translate(-0.15, 0, 0)), new THREE.MeshLambertMaterial({ color: '#c0392b', side: THREE.DoubleSide }));
      flag.position.set(0.1, 2.1, s * 0.68); flag.castShadow = true; g.add(flag); gate.flags.push(flag);
    }
    g.add(mesh(G('gwall', () => new THREE.BoxGeometry(0.36, 0.42, 1.12)), stone, 0.1, 1.0, 0));
    for (let i = 0; i < 4; i++) g.add(mesh(G('crenel', () => new THREE.BoxGeometry(0.12, 0.12, 0.14)), stone, 0.1, 1.27, -0.42 + i * 0.28));
    g.add(mesh(G('gdoor', () => new THREE.BoxGeometry(0.08, 0.8, 0.94)), phong('#140d08'), 0.22, 0.4, 0));
    for (let i = 0; i < 5; i++) g.add(mesh(G('gbar', () => new THREE.BoxGeometry(0.03, 0.26, 0.03)), phong('#3a3f46', { shininess: 60 }), -0.02, 0.66, -0.36 + i * 0.18));
    for (const s of [-1, 1]) {
      const torch = new THREE.Mesh(G('torch', () => new THREE.SphereGeometry(0.035, 6, 4)), new THREE.MeshBasicMaterial({ color: '#ffcf70' }));
      torch.position.set(-0.12, 0.78, s * 0.4);
      const tg = glowSprite('#ff9a3c', 0.55, 0.7); tg.position.copy(torch.position);
      g.add(torch, tg); gate.torches.push(tg);
    }
    gate.group = g; gate.mats = fadeable(g);
    parent.add(g);
  }

  // The portal and castle fade when they stand between the camera and the board (an exit
  // on the front edge, or after orbiting), so the tiles behind them stay visible.
  // Each gets its own material copies so the fade doesn't touch shared materials.
  function fadeable(group) {
    const mats = [];
    group.traverse(o => {
      if (!o.material || o.isSprite) return;   // glows are faded through their own opacity updates
      o.material = o.material.clone();
      o.material.transparent = true;
      o.material.userData.opacity = o.material.opacity;
      mats.push(o.material);
    });
    return mats;
  }
  const _toCam = new THREE.Vector3();
  function applyFade(s) {
    // How far the structure stands out toward the camera from the look-at point, on the ground
    _toCam.set(camera.position.x - cam.tx, 0, camera.position.z - cam.tz).normalize();
    const p = s.group.position, d = (p.x - cam.tx) * _toCam.x + (p.z - cam.tz) * _toCam.z;
    const t = Math.min(1, Math.max(0, (d - 4.5) / 2));
    s.fade = 1 - 0.7 * t * t * (3 - 2 * t);   // 1 → 0.3 as it moves into the foreground
    for (const m of s.mats) m.opacity = m.userData.opacity * s.fade;
  }
  function applyTheme() {
    TH = mapTheme(CURRENT_MAP_INDEX);
    const l = TH.light;
    hemi.color.setHex(l.sky); hemi.groundColor.setHex(l.ground); hemi.intensity = l.hemi;
    sun.color.setHex(l.sun); sun.intensity = l.sunI;
    fillLight.color.setHex(l.fill); fillLight.intensity = l.fillI;
    scene.fog.color.setHex(TH.sky.fog);
    canvas3d.style.background = TH.sky.css;
    ambient.setTheme(TH.ambient);
  }
  function buildMap() {
    if (mapGroup) { scene.remove(mapGroup); disposeTree(mapGroup); }
    applyTheme();
    computeBoard();
    mapGroup = new THREE.Group();
    buildGround(mapGroup);
    buildScenery(mapGroup);
    buildPortal(mapGroup);
    buildGate(mapGroup);
    scene.add(mapGroup);
    builtFor = PATH_WAYPOINTS_TILES;
  }

  // ─── Towers ────────────────────────────────────────────────────────────────
  const TYPE_COL = { Basic: '#3498db', Sniper: '#9fb6cc', Cannon: '#e67e22', Freeze: '#74b9ff', Rapid: '#fd79a8', Laser: '#a29bfe', Tesla: '#00cec9' };
  const BUILD = {
    Basic(head, v, lv) {
      const metal = lv === 3 ? '#d9a72b' : '#5d6670';
      head.add(mesh(G('bBase', () => new THREE.CylinderGeometry(0.24, 0.28, 0.12, 12)), phong('#1f5f8f'), 0, 0.06, 0));
      const yaw = new THREE.Group(); yaw.position.y = 0.12; head.add(yaw);
      yaw.add(mesh(G('bDome', () => new THREE.SphereGeometry(0.22, 14, 8, 0, TAU, 0, Math.PI / 2)), phong('#3498db', { shininess: 70 })));
      yaw.add(mesh(G('bHatch', () => new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10)), phong('#1f6aa0'), 0, 0.21, 0));
      const rec = new THREE.Group(); rec.position.y = 0.1; yaw.add(rec);
      rec.add(mesh(G('bBarrel', () => alongX(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10))), phong(metal, { shininess: 90, specular: 0x888888 }), 0.3, 0, 0));
      rec.add(mesh(G('bMuzzle', () => alongX(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10))), phong(lv === 3 ? '#a8821f' : '#3e454d'), 0.49, 0, 0));
      v.tip.position.set(0.55, 0, 0); rec.add(v.tip);
      Object.assign(v, { yaw, recoil: rec, recoilDist: 0.07 });
    },
    Sniper(head, v, lv) {
      const metal = lv === 3 ? '#d9a72b' : '#6f7a86', scopeLen = lv >= 2 ? 0.3 : 0.22;
      head.add(mesh(G('sCol', () => new THREE.CylinderGeometry(0.13, 0.19, 0.62, 6)), phong('#3d5166'), 0, 0.31, 0));
      const yaw = new THREE.Group(); yaw.position.y = 0.68; head.add(yaw);
      yaw.add(mesh(G('sHouse', () => new THREE.BoxGeometry(0.36, 0.16, 0.22)), phong('#2f4053', { shininess: 50 })));
      const rec = new THREE.Group(); yaw.add(rec);
      rec.add(mesh(G('sBarrel', () => alongX(new THREE.CylinderGeometry(0.028, 0.028, 0.8, 8))), phong(metal, { shininess: 90 }), 0.5, 0, 0));
      rec.add(mesh(G('sBrake', () => new THREE.BoxGeometry(0.09, 0.07, 0.07)), phong('#2a2f36'), 0.9, 0, 0));
      yaw.add(mesh(G('sScope' + scopeLen, () => alongX(new THREE.CylinderGeometry(0.045, 0.045, scopeLen, 10))), phong('#1f262e', { shininess: 80 }), 0.02, 0.12, 0));
      const lens = new THREE.Mesh(G('sLens', () => new THREE.SphereGeometry(0.035, 8, 6)), phong('#8fdcff', { emissive: '#3aa0d0' }));
      lens.position.set(0.02 + scopeLen / 2, 0.12, 0); yaw.add(lens);
      v.tip.position.set(0.96, 0, 0); rec.add(v.tip);
      Object.assign(v, { yaw, recoil: rec, recoilDist: 0.1 });
    },
    Cannon(head, v, lv) {
      const iron = lv === 3 ? '#8a6a1c' : '#3f4249', ring = lv === 3 ? '#b8912a' : '#55595f';
      head.add(mesh(G('cDrum', () => new THREE.CylinderGeometry(0.34, 0.38, 0.14, 12)), phong('#2d2f34'), 0, 0.07, 0));
      const yaw = new THREE.Group(); yaw.position.y = 0.14; head.add(yaw);
      yaw.add(mesh(G('cDome', () => new THREE.SphereGeometry(0.29, 14, 8, 0, TAU, 0, Math.PI / 2)), phong(lv === 3 ? '#e08a2a' : '#c9661b', { shininess: 60 })));
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; yaw.add(mesh(G('rivet', () => new THREE.SphereGeometry(0.025, 6, 4)), phong('#f6c38f'), Math.cos(a) * 0.268, 0.1, Math.sin(a) * 0.268)); }
      const pitch = new THREE.Group(); pitch.position.y = 0.14; pitch.rotation.z = 0.28; yaw.add(pitch);
      const rec = new THREE.Group(); pitch.add(rec);
      rec.add(mesh(G('cBarrel', () => alongX(new THREE.CylinderGeometry(0.11, 0.13, 0.5, 12))), phong(iron, { shininess: 70 }), 0.3, 0, 0));
      rec.add(mesh(G('cBand', () => alongX(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 12))), phong(ring), 0.27, 0, 0));
      rec.add(mesh(G('cMuzzle', () => alongX(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12))), phong(ring), 0.52, 0, 0));
      v.tip.position.set(0.58, 0, 0); rec.add(v.tip);
      Object.assign(v, { yaw, recoil: rec, recoilDist: 0.09 });
    },
    Freeze(head, v, lv) {
      head.add(mesh(G('fBase', () => new THREE.CylinderGeometry(0.18, 0.25, 0.1, 6)), phong('#2d4a66'), 0, 0.05, 0));
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU + 0.5;
        const p = mesh(G('prong', () => new THREE.BoxGeometry(0.04, 0.34, 0.04)), phong('#9fc9ea', { shininess: 80 }), Math.cos(a) * 0.16, 0.24, Math.sin(a) * 0.16);
        p.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); head.add(p);
      }
      const crystal = new THREE.Group(); crystal.position.y = 0.64; head.add(crystal);
      const cm = mesh(G('crystal', () => new THREE.OctahedronGeometry(0.2, 0)), new THREE.MeshPhongMaterial({ color: '#cdeeff', emissive: '#2a6fb5', emissiveIntensity: 0.55, flatShading: true, shininess: 140, specular: 0xffffff, transparent: true, opacity: 0.92 }));
      cm.scale.set(1, 1.8 + 0.15 * (lv - 1), 1); crystal.add(cm);
      const orbit = new THREE.Group(); orbit.position.y = 0.5; head.add(orbit);
      for (let i = 0; i < 2 + lv; i++) {
        const a = i / (2 + lv) * TAU;
        const s = mesh(G('shard', () => new THREE.OctahedronGeometry(0.055, 0)), phong('#e6f6ff', { emissive: '#3a7fc0', emissiveIntensity: 0.5 }), Math.cos(a) * 0.33, 0, Math.sin(a) * 0.33);
        s.scale.y = 1.6; orbit.add(s);
      }
      v.glow = glowSprite('#9fd8ff', 1.1, 0.5); v.glow.position.y = 0.64; head.add(v.glow);
      v.tip.position.y = 0.64; head.add(v.tip);
      Object.assign(v, { spin: crystal, orbit });
    },
    Rapid(head, v, lv) {
      const metal = lv === 3 ? '#d9a72b' : '#59626d', n = lv + 2;
      head.add(mesh(G('rBase', () => new THREE.CylinderGeometry(0.2, 0.26, 0.12, 10)), phong('#7a1f47'), 0, 0.06, 0));
      const yaw = new THREE.Group(); yaw.position.y = 0.24; head.add(yaw);
      yaw.add(mesh(G('rHouse', () => new THREE.BoxGeometry(0.32, 0.22, 0.3)), phong('#e8508f', { shininess: 60 }), -0.02, 0, 0));
      yaw.add(mesh(G('rDrum', () => alongX(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 12))), phong('#4b5159'), -0.24, 0, 0));
      const rec = new THREE.Group(); yaw.add(rec);
      const spin = new THREE.Group(); spin.position.x = 0.14; rec.add(spin);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        spin.add(mesh(G('rBarrel', () => alongX(new THREE.CylinderGeometry(0.028, 0.028, 0.46, 8))), phong(metal, { shininess: 90 }), 0.24, Math.cos(a) * 0.075, Math.sin(a) * 0.075));
      }
      spin.add(mesh(G('rClamp', () => alongX(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 12))), phong('#23272d'), 0.14, 0, 0));
      spin.add(mesh(G('rClamp', () => alongX(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 12))), phong('#8a2a55'), 0.42, 0, 0));
      v.tip.position.set(0.62, 0, 0); rec.add(v.tip);
      Object.assign(v, { yaw, recoil: rec, spin, recoilDist: 0.035 });
    },
    Laser(head, v, lv) {
      const pyl = mesh(G('lPylon', () => new THREE.CylinderGeometry(0.1, 0.24, 0.75, 4)), phong(lv === 3 ? '#6c5ce7' : '#54489e', { shininess: 70 }), 0, 0.375, 0);
      pyl.rotation.y = Math.PI / 4; head.add(pyl);
      const orbit = new THREE.Group(); orbit.position.y = 0.42; head.add(orbit);
      for (let i = 0; i < 2 + lv; i++) {
        const a = i / (2 + lv) * TAU;
        const s = mesh(G('prism', () => new THREE.OctahedronGeometry(0.065, 0)), phong(lv === 3 ? '#ffe27a' : '#d7d2ff', { emissive: lv === 3 ? '#806000' : '#4b3fb0', emissiveIntensity: 0.6 }), Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
        s.scale.y = 1.7; orbit.add(s);
      }
      const yaw = new THREE.Group(); yaw.position.y = 0.82; head.add(yaw);
      yaw.add(mesh(G('lHead', () => new THREE.SphereGeometry(0.11, 10, 8)), phong('#3b3760', { shininess: 60 })));
      yaw.add(mesh(G('lTube', () => alongX(new THREE.CylinderGeometry(0.07, 0.09, 0.26, 10))), phong('#2f2b4d'), 0.14, 0, 0));
      const lens = new THREE.Mesh(G('lLens', () => new THREE.SphereGeometry(0.06, 10, 8)), phong('#f1eeff', { emissive: '#b0a8ff' }));
      lens.position.x = 0.28; yaw.add(lens);
      v.glow = glowSprite('#b9b0ff', 0.8, 0.45); v.glow.position.x = 0.28; yaw.add(v.glow);
      v.tip.position.set(0.3, 0, 0); yaw.add(v.tip);
      Object.assign(v, { yaw, orbit });
    },
    Tesla(head, v, lv) {
      head.add(mesh(G('tCol', () => new THREE.CylinderGeometry(0.1, 0.17, 0.72, 8)), phong('#3a414b'), 0, 0.36, 0));
      const turns = 3 + lv;
      for (let i = 0; i < turns; i++) {
        const r = 0.25 - i * (0.1 / turns);
        const tor = mesh(G('coil' + r.toFixed(3), () => new THREE.TorusGeometry(r, 0.035, 6, 20)), phong(i % 2 ? '#b8662c' : '#e39a5b', { shininess: 90, specular: 0x886644 }), 0, 0.22 + i * (0.42 / turns), 0);
        tor.rotation.x = Math.PI / 2; head.add(tor);
      }
      const sphere = new THREE.Mesh(G('tSphere', () => new THREE.SphereGeometry(0.15, 14, 10)), new THREE.MeshPhongMaterial({ color: lv === 3 ? '#f7d154' : '#19d3cf', emissive: lv === 3 ? '#8a6a10' : '#0a8a88', emissiveIntensity: 0.9, shininess: 120 }));
      sphere.position.y = 0.86; sphere.castShadow = true; head.add(sphere);
      v.glow = glowSprite('#40fff6', 1.1, 0.5); v.glow.position.y = 0.86; head.add(v.glow);
      v.tip.position.y = 0.86; head.add(v.tip);
      v.sphere = sphere;
    },
  };

  // Camera-facing strip through a list of points (lightning, laser)
  const _d = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
  class Ribbon {
    constructor(maxPts, color, width, opacity) {
      this.max = maxPts; this.width = this.baseWidth = width; this.baseOpacity = opacity;
      this.pos = new Float32Array(maxPts * 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      this.geo = g;
      this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.mesh = new THREE.Mesh(g, this.mat);
      this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5;
      scene.add(this.mesh);
    }
    set(pts, eye) {
      const n = Math.min(pts.length, this.max);
      if (n < 2) { this.mesh.visible = false; return; }
      for (let i = 0; i < n; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        _d.subVectors(b, a).normalize(); _c.subVectors(eye, p).normalize();
        _s.crossVectors(_d, _c).normalize().multiplyScalar(this.width / 2);
        const j = i * 6;
        this.pos[j] = p.x + _s.x; this.pos[j + 1] = p.y + _s.y; this.pos[j + 2] = p.z + _s.z;
        this.pos[j + 3] = p.x - _s.x; this.pos[j + 4] = p.y - _s.y; this.pos[j + 5] = p.z - _s.z;
      }
      this.geo.setDrawRange(0, (n - 1) * 6);
      this.geo.attributes.position.needsUpdate = true;
      this.mesh.visible = true;
    }
    hide() { this.mesh.visible = false; }
  }

  // Builds the model for tower `t` (or a stand-in with the same type/level for previews)
  function buildTowerModel(t) {
    const lv = t.level, gold = lv === 3;
    const root = new THREE.Group();
    root.add(mesh(G('ped', () => new THREE.CylinderGeometry(0.42, 0.47, 0.22, 10)), phong('#7b7f88', { shininess: 8 }), 0, 0.11, 0));
    const band = mesh(G('band', () => new THREE.TorusGeometry(0.34, 0.035, 6, 28)), phong(TYPE_COL[t.type], { emissive: TYPE_COL[t.type], emissiveIntensity: 0.25 }), 0, 0.225, 0);
    band.rotation.x = Math.PI / 2; root.add(band);
    if (lv >= 2) {
      const trim = mesh(G('trim', () => new THREE.TorusGeometry(0.445, 0.028, 6, 30)), phong(gold ? '#f1c40f' : '#cfd5dc', { shininess: 90, specular: 0xffffff }), 0, 0.222, 0);
      trim.rotation.x = Math.PI / 2; root.add(trim);
    }
    for (let i = 0; i < lv; i++) {
      root.add(mesh(G('gem', () => new THREE.OctahedronGeometry(0.038)), phong(gold ? '#ffd84a' : lv === 2 ? '#e6ebf0' : '#d9a066', { emissive: '#332200', shininess: 100 }), (i - (lv - 1) / 2) * 0.1, 0.12, 0.47));
    }
    const v = { t, root, level: lv, yaw: null, recoil: null, tip: new THREE.Object3D(), recoilDist: 0, yawAngle: -t.angle, extras: [] };
    const head = new THREE.Group(); head.position.y = 0.22; root.add(head);
    BUILD[t.type](head, v, lv);
    v.flash = glowSprite('#ffd08a', 0.5, 0); v.flash.material.map = STAR; v.tip.add(v.flash);
    return v;
  }

  const towerViews = new Map();
  function buildTower(t) {
    const v = buildTowerModel(t);
    v.root.position.set(toX(t.x), GRASS_Y, toZ(t.y));
    v.root.traverse(o => { o.userData.tower = t; });
    if (t.type === 'Laser') {
      v.beam = [new Ribbon(2, '#8f86ff', 0.3, 0.1), new Ribbon(2, '#a29bfe', 0.11, 0.4), new Ribbon(2, '#ffffff', 0.035, 0.9)];
      v.extras.push(...v.beam.map(b => b.mesh));
    }
    if (t.type === 'Tesla') {
      v.bolt = [new Ribbon(40, '#3ffcf4', 0.18, 0.45), new Ribbon(40, '#ffffff', 0.045, 1)];
      v.arc = [new Ribbon(8, '#3ffcf4', 0.1, 0.5), new Ribbon(8, '#ffffff', 0.03, 1)];
      v.hits = [0, 1, 2, 3].map(() => { const s = glowSprite('#7ffff9', 0.8, 0); s.visible = false; scene.add(s); return s; });
      v.boltPts = []; v.hitPts = []; v.arcPts = []; v.arcLife = 0;
      v.extras.push(...v.bolt.map(b => b.mesh), ...v.arc.map(b => b.mesh), ...v.hits);
    }
    scene.add(v.root);
    towerViews.set(t, v);
    return v;
  }
  function removeTower(v) {
    scene.remove(v.root); disposeTree(v.root);
    for (const x of v.extras) { scene.remove(x); disposeTree(x); }
  }

  // ─── Enemies ───────────────────────────────────────────────────────────────
  const hitState = new WeakMap();
  function trackHits(list, dt) {
    for (const e of list) {
      const h = hitState.get(e);
      if (!h) { hitState.set(e, { hp: e.hp, flash: 0 }); continue; }
      h.flash = h.hp - e.hp >= 4 ? 0.09 : Math.max(0, h.flash - dt);
      h.hp = e.hp;
    }
  }
  const MOD_COL = { Armored: '#bdc3c7', Haste: '#e74c3c', Swarm: '#9b59b6' };
  const enemyViews = new Map();
  function buildEnemy(e) {
    // Each enemy owns its materials (they're tinted on hit / slow), one per distinct look
    const mats = [], own = new Map();
    const M = (hex, opts = {}) => {
      const key = hex + JSON.stringify(opts);
      if (!own.has(key)) {
        const m = new THREE.MeshPhongMaterial(Object.assign({ color: hex, flatShading: true, shininess: 35 }, opts));
        m.userData.baseEm = m.emissive.clone(); mats.push(m); own.set(key, m);
      }
      return own.get(key);
    };
    const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
    // animT: the enemy's own animation clock, which runs slower while it's slowed
    const v = { e, group, body, mats, parts: {}, barH: 0.8, yaw: -e.moveAngle, phase: Math.random() * 10, animT: 0, frost: 0 };
    const r = e.radius / T;
    switch (e.type) {
      case 'Scout': {
        const b = mesh(G('scoutBody', () => new THREE.IcosahedronGeometry(r, 1)), M('#e74c3c', { shininess: 60 }), 0, r * 0.95, 0);
        b.scale.set(1.25, 0.95, 0.95); body.add(b);
        for (const s of [-1, 1]) {
          body.add(mesh(G('eye', () => new THREE.SphereGeometry(r * 0.22, 8, 6)), M('#ffffff', { emissive: '#444444' }), r * 0.95, r * 1.15, s * r * 0.38));
          body.add(mesh(G('pupil', () => new THREE.SphereGeometry(r * 0.11, 6, 4)), M('#111111'), r * 1.14, r * 1.15, s * r * 0.38));
        }
        v.parts.feet = [-1, 1].map(s => { const f = mesh(G('foot', () => new THREE.BoxGeometry(r * 0.45, r * 0.18, r * 0.26)), M('#6e1d15'), 0, r * 0.1, s * r * 0.45); body.add(f); return f; });
        v.barH = 0.72; break;
      }
      case 'Soldier': {
        v.parts.legs = [-1, 1].map(s => { const l = mesh(G('leg', () => new THREE.BoxGeometry(0.08, 0.2, 0.08).translate(0, -0.1, 0)), M('#5c1a14'), 0, 0.2, s * 0.08); body.add(l); return l; });
        body.add(mesh(G('torso', () => new THREE.CylinderGeometry(r * 0.55, r * 0.7, r * 1.1, 8)), M('#c0392b'), 0, 0.2 + r * 0.55, 0));
        const headY = 0.2 + r * 1.1 + r * 0.3;
        body.add(mesh(G('head', () => new THREE.SphereGeometry(r * 0.36, 8, 6)), M('#e0b48a'), 0, headY, 0));
        body.add(mesh(G('helmet', () => new THREE.SphereGeometry(r * 0.42, 10, 6, 0, TAU, 0, Math.PI / 2)), M('#8e969e', { shininess: 80 }), 0, headY + 0.02, 0));
        body.add(mesh(G('rim', () => new THREE.BoxGeometry(0.05, r * 1.55, r * 1.35)), M('#c9ced3', { shininess: 80 }), r * 0.72, 0.2 + r * 0.6, 0));
        body.add(mesh(G('shield', () => new THREE.BoxGeometry(0.06, r * 1.4, r * 1.2)), M('#b03225'), r * 0.76, 0.2 + r * 0.6, 0));
        body.add(mesh(G('shieldBoss', () => new THREE.SphereGeometry(r * 0.2, 8, 6)), M('#c9ced3', { shininess: 90 }), r * 0.8, 0.2 + r * 0.6, 0));
        v.barH = 1.0; break;
      }
      case 'Tank': {
        body.add(mesh(G('hull', () => new THREE.BoxGeometry(0.72, 0.18, 0.46)), M('#7f8c8d'), 0, 0.19, 0));
        for (const s of [-1, 1]) body.add(mesh(G('tread', () => new THREE.BoxGeometry(0.8, 0.16, 0.13)), M('#2b2f33'), 0, 0.08, s * 0.28));
        body.add(mesh(G('turret', () => new THREE.CylinderGeometry(0.17, 0.2, 0.13, 10)), M('#95a5a6', { shininess: 60 }), -0.04, 0.345, 0));
        body.add(mesh(G('tBarrel', () => alongX(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8))), M('#4d555a'), 0.22, 0.35, 0));
        body.add(mesh(G('tHatch', () => new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8)), M('#5d676a'), -0.08, 0.42, 0.04));
        v.barH = 0.72; break;
      }
      case 'Speeder': {
        const hull = mesh(G('spBody', () => alongX(new THREE.ConeGeometry(r * 0.9, r * 3.2, 8))), M('#f39c12', { shininess: 80 }), 0, 0.22, 0);
        hull.scale.z = 0.7; body.add(hull);
        body.add(mesh(G('wing', () => new THREE.BoxGeometry(0.14, 0.02, 0.3)), M('#b35a07'), -0.18, 0.22, 0));
        body.add(mesh(G('fin', () => new THREE.BoxGeometry(0.12, 0.12, 0.02)), M('#b35a07'), -0.2, 0.3, 0));
        const cp = mesh(G('cockpit', () => new THREE.SphereGeometry(r * 0.35, 8, 6)), M('#fff3c4', { emissive: '#554400', shininess: 100 }), 0.06, 0.27, 0);
        cp.scale.set(1.6, 0.7, 0.9); body.add(cp);
        v.parts.engine = glowSprite('#ffae42', 0.45, 0.8); v.parts.engine.position.set(-0.33, 0.22, 0); body.add(v.parts.engine);
        v.barH = 0.6; break;
      }
      case 'Healer': {
        const cross = new THREE.Group(); cross.position.y = 0.55; body.add(cross);
        const gm = M('#2ecc71', { emissive: '#0b5a30', shininess: 70 });
        cross.add(mesh(G('crossH', () => new THREE.BoxGeometry(0.5, 0.15, 0.15)), gm));
        cross.add(mesh(G('crossV', () => new THREE.BoxGeometry(0.15, 0.5, 0.15)), gm));
        const cg = glowSprite('#7dffb2', 0.9, 0.35); cg.position.y = 0.55; body.add(cg);
        const aura = new THREE.Mesh(G('auraRing', () => new THREE.RingGeometry(2.38, 2.5, 64).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#4dffa0', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
        const disc = new THREE.Mesh(G('auraDisc', () => new THREE.CircleGeometry(2.5, 48).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#2ecc71', transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
        aura.position.y = disc.position.y = 0.2;
        group.add(aura, disc);
        Object.assign(v.parts, { cross, aura, disc });
        v.barH = 1.05; break;
      }
      case 'Boss': {
        body.add(mesh(G('bossBody', () => new THREE.IcosahedronGeometry(r, 1)), M('#8e44ad', { shininess: 50 }), 0, 0.55, 0));
        const spikes = new THREE.Group(); spikes.position.y = 0.55; body.add(spikes);
        const sm = M('#4a1f63');
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU, tilt = i % 2 ? 0.45 : -0.15;
          const sp = mesh(G('spike', () => new THREE.ConeGeometry(0.07, 0.26, 5).translate(0, 0.13, 0)), sm, Math.cos(a) * r * 0.9, Math.sin(tilt) * r * 0.6, Math.sin(a) * r * 0.9);
          spikes.add(sp);
          // Point the cone outward: lookAt aims +Z (world space, group is still at the origin), then tip +Y onto it
          sp.lookAt(sp.position.x + Math.cos(a), 0.55 + sp.position.y + Math.sin(tilt), sp.position.z + Math.sin(a));
          sp.rotateX(Math.PI / 2);
        }
        for (const s of [-1, 1]) {
          const eye = mesh(G('bossEye', () => new THREE.SphereGeometry(r * 0.13, 8, 6)), M('#fff4b0', { emissive: '#ffcc33' }), r * 0.86, 0.62, s * r * 0.3);
          eye.scale.set(0.6, 0.5, 1); eye.rotation.x = s * 0.4; body.add(eye);
        }
        const crownY = 0.55 + r * 0.82;
        body.add(mesh(G('crown', () => new THREE.CylinderGeometry(r * 0.5, r * 0.55, 0.12, 10, 1, true)), M('#f1c40f', { shininess: 110, specular: 0xffffff, side: THREE.DoubleSide }), 0, crownY, 0));
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * TAU;
          body.add(mesh(G('crownSpike', () => new THREE.ConeGeometry(0.05, 0.14, 4)), M('#f1c40f', { shininess: 110 }), Math.cos(a) * r * 0.5, crownY + 0.13, Math.sin(a) * r * 0.5));
        }
        body.add(mesh(G('crownGem', () => new THREE.OctahedronGeometry(0.045)), M('#e74c3c', { emissive: '#551111', shininess: 120 }), r * 0.52, crownY, 0));
        v.parts.spikes = spikes;
        v.parts.glow = glowSprite('#b35cff', 2.4, 0.45); v.parts.glow.position.y = 0.55; body.add(v.parts.glow);
        v.barH = 1.5; break;
      }
    }
    if (e.waveMod && MOD_COL[e.waveMod]) {
      v.parts.modRing = new THREE.Mesh(G('modRing', () => new THREE.RingGeometry(0.34, 0.42, 32).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: MOD_COL[e.waveMod], transparent: true, opacity: 0.7, depthWrite: false }));
      v.parts.modRing.position.y = 0.02; v.parts.modRing.scale.setScalar(Math.max(1, r / 0.3));
      group.add(v.parts.modRing);
    }
    scene.add(group);
    enemyViews.set(e, v);
    return v;
  }
  function removeEnemy(v) { scene.remove(v.group); disposeTree(v.group); }
  const ANIM = {
    Scout(v, t) {
      v.body.position.y = Math.abs(Math.sin(t * 16 + v.phase)) * 0.07;
      v.parts.feet.forEach((f, i) => { f.position.x = Math.sin(t * 16 + v.phase + i * Math.PI) * 0.06; });
    },
    Soldier(v, t) {
      v.body.position.y = Math.abs(Math.sin(t * 9 + v.phase)) * 0.03;
      v.parts.legs.forEach((l, i) => { l.rotation.z = Math.sin(t * 9 + v.phase + i * Math.PI) * 0.5; });
    },
    Tank(v, t) { v.body.position.y = Math.sin(t * 40 + v.phase) * 0.004; },
    Speeder(v, t) {
      v.body.position.y = 0.05 + Math.sin(t * 7 + v.phase) * 0.025;
      v.parts.engine.material.opacity = 0.6 + 0.3 * Math.sin(t * 40);
    },
    Healer(v, t, dt) {
      v.body.position.y = Math.sin(t * 2 + v.phase) * 0.06;
      v.parts.cross.rotation.y += dt * 1.5;
      const p = 0.5 + 0.5 * Math.sin(t * 2.5);
      v.parts.aura.material.opacity = 0.15 + 0.15 * p;
      v.parts.disc.material.opacity = 0.035 + 0.03 * p;
    },
    Boss(v, t, dt) {
      v.body.position.y = 0.05 + Math.sin(t * 1.5 + v.phase) * 0.05;
      v.parts.spikes.rotation.y += dt * 0.5;
      v.parts.glow.material.opacity = 0.35 + 0.15 * Math.sin(t * 1.8);
    },
  };

  // ─── Projectiles ───────────────────────────────────────────────────────────
  const projViews = new Map();
  const _tmp = new THREE.Vector3();
  function buildProjectile(p) {
    const g = new THREE.Group();
    let core, glow;
    switch (p.source) {
      case 'Cannon':
        core = mesh(G('shell', () => new THREE.SphereGeometry(0.09, 10, 8)), phong('#2b2b30', { shininess: 80 }));
        glow = glowSprite('#ff9a3c', 0.32, 0.8); glow.position.y = 0.08; break;
      case 'Sniper':
        core = new THREE.Mesh(G('tracer', () => alongX(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6))), phong('#ffffff', { emissive: '#ffffff' }));
        glow = glowSprite('#ffffff', 0.35, 0.7); break;
      case 'Freeze':
        core = new THREE.Mesh(G('ice', () => new THREE.OctahedronGeometry(0.06)), phong('#dff4ff', { emissive: '#9fd8ff' }));
        core.scale.set(0.8, 1.6, 0.8);   // a long shard rather than a bead
        glow = glowSprite('#9fd8ff', 0.5, 0.8); break;
      case 'Rapid':
        core = new THREE.Mesh(G('rBullet', () => new THREE.SphereGeometry(0.035, 6, 4)), phong('#ffd1e6', { emissive: '#ff8fc0' }));
        glow = glowSprite('#ff6fae', 0.3, 0.8); break;
      default:
        core = new THREE.Mesh(G('bullet', () => new THREE.SphereGeometry(0.045, 8, 6)), phong('#e6f6ff', { emissive: '#9fd8ff' }));
        glow = glowSprite('#5dade2', 0.45, 0.8);
    }
    g.add(core, glow);
    const tv = towerViews.get(p.sourceTower);
    let h0 = 0.8;
    if (tv) { tv.tip.getWorldPosition(_tmp); h0 = _tmp.y; }
    const v = { g, core, sx: p.x, sy: p.y, h0, lx: p.x, ly: p.y, smokeT: 0 };
    if (p.source === 'Sniper') {           // tracer streak from the muzzle to the round
      v.trail = new Ribbon(2, '#fff4d0', 0.045, 0.6);
      v.start = tv ? _tmp.clone() : new THREE.Vector3(toX(p.x), h0, toZ(p.y));
    }
    scene.add(g); projViews.set(p, v);
    return v;
  }
  // Sniper streaks fading out after their round lands
  const fadingTrails = [];
  function fadeTrails(dt) {
    for (let i = fadingTrails.length - 1; i >= 0; i--) {
      const ft = fadingTrails[i];
      ft.life -= dt;
      if (ft.life <= 0) { scene.remove(ft.r.mesh); ft.r.geo.dispose(); ft.r.mat.dispose(); fadingTrails.splice(i, 1); }
      else ft.r.mat.opacity = ft.r.baseOpacity * (ft.life / 0.2);
    }
  }
  // A bullet landing on its target (Basic, Rapid, Sniper)
  const HIT_COL = { Basic: ['#9fd8ff', '#ffffff'], Rapid: ['#ff8fc0', '#ffd1e6'], Sniper: ['#fff4d0', '#ffffff'] };
  function bulletHit(p, pos) {
    const { x, y, z } = pos, cols = HIT_COL[p.source], sn = p.source === 'Sniper';
    flash(x, y, z, sn ? 0.9 : 0.4, sn ? 0.14 : 0.1, cols[0], sn ? 1 : 0.8);
    for (let i = 0; i < (sn ? 14 : p.source === 'Rapid' ? 3 : 6); i++) {
      const sp = sn ? 3 : 1.6;
      sparks.emit(x, y, z, rand(-sp, sp), rand(-0.2, sp * 0.7), rand(-sp, sp), pick(cols), rand(0.15, 0.3), 3);
    }
  }
  // A Freeze shot breaking: on its target, or in mid-air if the target died first
  function shatter(pos) {
    const { x, y, z } = pos, ground = Math.max(0, groundAt(x, z));
    flash(x, y, z, 0.8, 0.18, '#cfefff', 0.9);
    for (let i = 0; i < 8; i++) debris.emit(x, y, z, rand(-1.1, 1.1), rand(0.4, 1.6), rand(-1.1, 1.1), pick(['#eaf8ff', '#bfe8ff', '#8fcfff']), rand(0.035, 0.065), rand(0.5, 0.8));
    for (let i = 0; i < 14; i++) sparks.emit(x, y, z, rand(-1.4, 1.4), rand(-0.2, 1.2), rand(-1.4, 1.4), i % 2 ? '#ffffff' : '#9fd8ff', rand(0.35, 0.6), 1.5);
    ring(x, ground + 0.03, z, 0.6, 0.35, '#bfe8ff', 0.7);
  }

  // ─── Particle systems ──────────────────────────────────────────────────────
  const _col = new THREE.Color();
  class Sparks {
    constructor(max, size) {
      this.max = max; this.i = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -99;
      this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1); this.grav = new Float32Array(max);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
      this.geo = g;
      this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.points.frustumCulled = false; this.points.renderOrder = 6;
      scene.add(this.points);
    }
    emit(x, y, z, vx, vy, vz, hex, life, grav = 6) {
      const k = this.i, j = k * 3; this.i = (this.i + 1) % this.max;
      this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
      this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
      _col.set(hex); this.base[j] = _col.r; this.base[j + 1] = _col.g; this.base[j + 2] = _col.b;
      this.life[k] = this.maxLife[k] = life; this.grav[k] = grav;
    }
    update(dt) {
      if (dt === 0) return;
      const drag = Math.exp(-1.6 * dt);
      for (let k = 0; k < this.max; k++) {
        if (this.life[k] <= 0) continue;
        const j = k * 3;
        this.life[k] -= dt;
        if (this.life[k] <= 0) { this.pos[j + 1] = -99; this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
        this.vel[j] *= drag; this.vel[j + 2] *= drag; this.vel[j + 1] -= this.grav[k] * dt;
        this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
        if (this.vel[j + 1] < 0) {
          const fl = groundAt(this.pos[j], this.pos[j + 2]) + 0.02;
          if (this.pos[j + 1] < fl) { this.pos[j + 1] = fl; this.vel[j + 1] *= -0.35; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6; }
        }
        const a = this.life[k] / this.maxLife[k];
        this.col[j] = this.base[j] * a; this.col[j + 1] = this.base[j + 1] * a; this.col[j + 2] = this.base[j + 2] * a;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
  const _dummy = new THREE.Object3D();
  class Debris {
    constructor(max) {
      this.max = max; this.i = 0;
      this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), max);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.castShadow = true; this.mesh.frustumCulled = false;
      this.p = Array.from({ length: max }, () => ({ life: 0 }));
      _dummy.scale.set(0, 0, 0); _dummy.updateMatrix();
      for (let k = 0; k < max; k++) { this.mesh.setMatrixAt(k, _dummy.matrix); if (this.mesh.setColorAt) this.mesh.setColorAt(k, _col.set('#ffffff')); }
      scene.add(this.mesh);
    }
    emit(x, y, z, vx, vy, vz, hex, size, life) {
      const k = this.i; this.i = (this.i + 1) % this.max;
      Object.assign(this.p[k], { x, y, z, vx, vy, vz, size, life, rx: Math.random() * 3, ry: Math.random() * 3, rz: 0, wx: rand(-8, 8), wy: rand(-8, 8), wz: rand(-8, 8) });
      if (this.mesh.setColorAt) { this.mesh.setColorAt(k, _col.set(hex)); this.mesh.instanceColor.needsUpdate = true; }
    }
    update(dt) {
      if (dt === 0) return;
      for (let k = 0; k < this.max; k++) {
        const p = this.p[k];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { _dummy.scale.set(0, 0, 0); _dummy.updateMatrix(); this.mesh.setMatrixAt(k, _dummy.matrix); continue; }
        p.vy -= 9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const fl = groundAt(p.x, p.z) + p.size / 2;
        if (p.y < fl) { p.y = fl; p.vy *= -0.3; p.vx *= 0.55; p.vz *= 0.55; p.wx *= 0.5; p.wy *= 0.5; p.wz *= 0.5; }
        p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
        const s = p.size * Math.min(1, p.life / 0.35);
        _dummy.position.set(p.x, p.y, p.z); _dummy.rotation.set(p.rx, p.ry, p.rz); _dummy.scale.set(s, s, s); _dummy.updateMatrix();
        this.mesh.setMatrixAt(k, _dummy.matrix);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  // Pool of sprites or meshes animated by a callback (smoke, flashes, rings, scorch)
  class Pool {
    constructor(n, make, step) {
      this.items = Array.from({ length: n }, () => { const o = make(); o.visible = false; scene.add(o); return { o, life: 0, max: 1, d: {} }; });
      this.i = 0; this.step = step;
    }
    emit(life, init) {
      const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
      it.life = it.max = life; it.o.visible = true; init(it.o, it.d);
    }
    update(dt) {
      if (dt === 0) return;
      for (const it of this.items) {
        if (it.life <= 0) continue;
        it.life -= dt;
        if (it.life <= 0) { it.o.visible = false; continue; }
        this.step(it.o, 1 - it.life / it.max, it.d, dt);
      }
    }
  }
  const sparks = new Sparks(1600, 0.11);
  const debris = new Debris(420);
  const smoke = new Pool(70,
    () => new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: '#8b8b8b', transparent: true, depthWrite: false, opacity: 0 })),
    (o, f, d, dt) => {
      o.position.x += d.vx * dt; o.position.y += d.rise * dt; o.position.z += d.vz * dt;
      d.vx *= 1 - 2.5 * dt; d.vz *= 1 - 2.5 * dt;   // rolling dust slows down
      o.scale.setScalar(d.s0 + d.grow * f); o.material.opacity = d.a * (1 - f);
    });
  const flashes = new Pool(24,
    () => new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    (o, f, d) => { o.scale.setScalar(d.s * (0.6 + 0.6 * f)); o.material.opacity = d.a * (1 - f) * (1 - f); });
  const rings = new Pool(20,
    () => new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
    (o, f, d) => { const s = d.r * (0.2 + 0.8 * (1 - Math.pow(1 - f, 3))); o.scale.set(s, 1, s); o.material.opacity = d.a * (1 - f); });
  const decals = new Pool(20,
    () => new THREE.Mesh(new THREE.CircleGeometry(0.45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: SCORCH, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })),
    (o, f) => { o.material.opacity = 1 - f * f; });
  // Laser burn marks: start glowing orange, cool to a dark scorch, then fade
  const _hot = new THREE.Color('#ffa040'), _cold = new THREE.Color('#2a1a10');
  const burns = new Pool(48,
    () => new THREE.Mesh(new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: SOFT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })),
    (o, f) => {
      o.material.color.copy(_hot).lerp(_cold, Math.min(1, f * 4));
      o.material.opacity = f < 0.6 ? 0.9 : 0.9 * (1 - (f - 0.6) / 0.4);
    });

  function puff(x, y, z, s, life, hex = '#8b8b8b', a = 0.5, vx = 0, vz = 0, rise = 0.5) {
    smoke.emit(life, (o, d) => { o.position.set(x, y, z); o.material.color.set(hex); Object.assign(d, { s0: s, grow: s * 1.6, rise, a, vx, vz }); });
  }
  function flash(x, y, z, s, life, hex = '#ffd9a0', a = 1) {
    flashes.emit(life, (o, d) => { o.position.set(x, y, z); o.material.color.set(hex); Object.assign(d, { s, a }); });
  }
  function ring(x, y, z, r, life, hex, a = 0.8) {
    rings.emit(life, (o, d) => { o.position.set(x, y, z); o.material.color.set(hex); o.scale.set(0.01, 1, 0.01); Object.assign(d, { r, a }); });
  }

  // Ambient particles over the board, set by the map's theme: fireflies (meadow), falling
  // leaves (autumn), drifting dust (desert), snow, or rising embers (volcanic).
  // Positions are a pure function of time, so pausing freezes them.
  const ambient = (() => {
    const MAX = 240, pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 0.13, map: DOT, vertexColors: true, transparent: true, depthWrite: false });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; scene.add(pts);
    let mode = 'firefly', seeds = [];
    const wrap = (v, h) => ((v % h) + h) % h;
    return {
      setTheme(a) {
        const rng = mulberry32(11), n = Math.min(MAX, a.count);
        mode = a.mode;
        seeds = Array.from({ length: n }, () => ({ x: rng() * 22 - 11, z: rng() * 16 - 8, y: rng(), p: rng() * TAU,
                                                   s: 0.3 + rng() * 0.5, c: a.colors[Math.floor(rng() * a.colors.length)] }));
        mat.size = a.size; mat.opacity = a.opacity;
        mat.blending = a.additive ? THREE.AdditiveBlending : THREE.NormalBlending; mat.needsUpdate = true;
        g.setDrawRange(0, n);
      },
      update(t) {
        seeds.forEach((s, i) => {
          let x = s.x, y, z = s.z, a = 1;   // a: brightness (additive modes fade by darkening)
          if (mode === 'snow') {
            y = 4 - wrap(t * (0.5 + s.s * 0.6) + s.y * 4, 4);
            x += Math.sin(t * 0.8 * s.s + s.p) * 0.4; z += Math.cos(t * 0.6 * s.s + s.p) * 0.3;
          } else if (mode === 'leaf') {
            y = 3 - wrap(t * (0.25 + s.s * 0.3) + s.y * 3, 3);
            x += Math.sin(t * 1.5 * s.s + s.p) * 0.6; z += Math.cos(t * 1.1 * s.s + s.p) * 0.4;
          } else if (mode === 'ember') {
            y = wrap(t * (0.4 + s.s * 0.6) + s.y * 3, 3);
            x += Math.sin(t * 2 * s.s + s.p) * 0.25; z += Math.cos(t * 1.7 * s.s + s.p) * 0.25;
            a = (1 - y / 3) * (0.6 + 0.4 * Math.sin(t * 9 + s.p * 5));
          } else if (mode === 'dust') {
            y = 0.2 + s.y * 0.8 + Math.sin(t * s.s + s.p) * 0.1;
            x = wrap(s.x + 11 + t * (0.6 + s.s), 22) - 11; z += Math.sin(t * 0.7 + s.p) * 0.4;
          } else {                          // fireflies
            y = 0.4 + s.y * 1.1 + Math.sin(t * s.s * 1.7 + s.p) * 0.15;
            x += Math.sin(t * s.s + s.p) * 0.6; z += Math.cos(t * s.s * 0.8 + s.p) * 0.6;
            a = Math.max(0, Math.sin(t * 2.2 + s.p * 3)) * 0.9;
          }
          const j = i * 3;
          pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
          col[j] = s.c[0] * a; col[j + 1] = s.c[1] * a; col[j + 2] = s.c[2] * a;
        });
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      },
    };
  })();

  // ─── Event effects (called from game.js) ───────────────────────────────────
  const DEATH = {
    Scout:   { cols: ['#e74c3c', '#ff7675', '#c0392b'], n: 10, spark: '#ffb199' },
    Soldier: { cols: ['#c0392b', '#922b21', '#9aa1a8'], n: 14, spark: '#ff9f80' },
    Tank:    { cols: ['#7f8c8d', '#4d555a', '#2b2f33'], n: 20, spark: '#ffd28a' },
    Speeder: { cols: ['#f39c12', '#b35a07', '#fdcb6e'], n: 10, spark: '#ffe08a' },
    Healer:  { cols: ['#2ecc71', '#0b5a30', '#55efc4'], n: 12, spark: '#9dffc8' },
    Boss:    { cols: ['#8e44ad', '#4a1f63', '#f1c40f'], n: 46, spark: '#e9b3ff' },
  };
  function onDeath(e) {
    const x = toX(e.x), z = toZ(e.y), d = DEATH[e.type] || DEATH.Scout, big = e.type === 'Boss', k = big ? 1.7 : 1, y = big ? 0.6 : 0.3;
    for (let i = 0; i < d.n; i++) debris.emit(x, y, z, rand(-1.6, 1.6) * k, rand(1.5, 3.4) * k, rand(-1.6, 1.6) * k, pick(d.cols), rand(0.05, 0.1) * k, rand(0.9, 1.6));
    for (let i = 0; i < (big ? 90 : 16); i++) sparks.emit(x, y, z, rand(-2.4, 2.4) * k, rand(0.5, 3.4) * k, rand(-2.4, 2.4) * k, i % 3 ? d.spark : '#ffffff', rand(0.3, 0.7), 6);
    for (let i = 0; i < (big ? 8 : 2); i++) puff(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), rand(0.3, 0.5) * k, rand(0.6, 1.1));
    ring(x, 0.2, z, big ? 3.2 : 0.9, big ? 0.8 : 0.35, d.spark);
    flash(x, y, z, big ? 3.2 : 1.0, big ? 0.35 : 0.2);
    if (e.type === 'Healer') for (let i = 0; i < 10; i++) sparks.emit(x + rand(-0.3, 0.3), 0.4, z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.6, 1.2), rand(-0.3, 0.3), '#7dffb2', rand(0.8, 1.2), -0.5);
    if (big) {
      ring(x, 0.25, z, 5, 1.1, '#f1c40f', 0.6);
      for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; sparks.emit(x, 0.5, z, Math.cos(a) * 4.5, 0.4, Math.sin(a) * 4.5, '#f1c40f', 0.9, 1); }
    }
  }
  function onEscape(e) {
    const x = toX(e.x), z = toZ(e.y);
    flash(x, 0.4, z, 0.9, 0.25, '#ff6b5b', 0.8);
    for (let i = 0; i < 8; i++) sparks.emit(x, 0.3, z, rand(-0.8, 0.8), rand(0.5, 1.5), rand(-0.8, 0.8), '#ff8a7a', 0.5, 3);
  }
  function onSpawn(e) {
    const x = toX(e.x), z = toZ(e.y);
    for (let i = 0; i < 14; i++) sparks.emit(x + rand(-0.2, 0.2), rand(0.2, 0.8), z + rand(-0.3, 0.3), rand(-0.8, 0.8), rand(0.2, 1.2), rand(-0.8, 0.8), '#b07cff', rand(0.4, 0.7), 1);
    ring(x, 0.05, z, 0.8, 0.45, '#a36bff', 0.7);
  }
  function onExplosion(x2, y2) {
    const x = toX(x2), z = toZ(y2), g = groundAt(x, z);
    flash(x, 0.35, z, 2.0, 0.22, '#ffcf8a');
    ring(x, 0.2, z, 1.1, 0.4, '#ffcf8a', 0.9);
    for (let i = 0; i < 22; i++) sparks.emit(x, 0.3, z, rand(-2.8, 2.8), rand(1, 4), rand(-2.8, 2.8), pick(['#ffb347', '#ffd27a', '#ff7b3a', '#ffffff']), rand(0.3, 0.6), 7);
    // Dirt clumps that land and lie about for ~2s before shrinking away
    for (let i = 0; i < 14; i++) debris.emit(x, 0.15, z, rand(-1.6, 1.6), rand(1.5, 3.2), rand(-1.6, 1.6), pick(['#6b4a2b', '#8a6a3c', '#4a3520']), rand(0.04, 0.09), rand(1.8, 2.5));
    for (let i = 0; i < 3; i++) puff(x + rand(-0.2, 0.2), 0.3, z + rand(-0.2, 0.2), rand(0.35, 0.55), rand(0.8, 1.2), '#6f6f6f', 0.55);
    // Ring of dust rolling outward along the ground
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU + rand(-0.2, 0.2), sp = rand(1.4, 2.0);
      puff(x + Math.cos(a) * 0.25, Math.max(0, g) + 0.12, z + Math.sin(a) * 0.25, rand(0.22, 0.32), rand(0.7, 1.0), '#a08a64', 0.45, Math.cos(a) * sp, Math.sin(a) * sp, 0.12);
    }
    decals.emit(9, (o) => { o.position.set(x, g + 0.006, z); o.rotation.y = Math.random() * TAU; o.material.opacity = 1; });
    // Enemies caught in the blast hop
    const reach = TOWER_DEFS.Cannon.aoe * 1.1;
    for (const v of enemyViews.values()) {
      if (Math.hypot(v.group.position.x - x, v.group.position.z - z) <= reach) v.hop = 1;
    }
  }
  function onPlace(t) {
    const x = toX(t.x), z = toZ(t.y);
    ring(x, GRASS_Y + 0.02, z, 0.8, 0.45, '#f1c40f', 0.9);
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; sparks.emit(x + Math.cos(a) * 0.3, GRASS_Y + 0.15, z + Math.sin(a) * 0.3, Math.cos(a) * 1.4, rand(0.8, 1.8), Math.sin(a) * 1.4, '#f1c40f', rand(0.35, 0.6), 5); }
    for (let i = 0; i < 4; i++) puff(x + rand(-0.3, 0.3), GRASS_Y + 0.1, z + rand(-0.3, 0.3), 0.25, 0.7, '#a08a64', 0.4);
  }
  function onUpgrade(t) {
    const x = toX(t.x), z = toZ(t.y);
    ring(x, GRASS_Y + 0.02, z, 1.0, 0.6, '#ffd84a', 0.9);
    for (let i = 0; i < 26; i++) sparks.emit(x + rand(-0.35, 0.35), GRASS_Y + rand(0.2, 0.9), z + rand(-0.35, 0.35), rand(-0.3, 0.3), rand(0.8, 1.8), rand(-0.3, 0.3), i % 2 ? '#ffd84a' : '#ffffff', rand(0.6, 1.0), -0.5);
    flash(x, 0.8, z, 1.6, 0.3, '#ffe08a');
  }
  function onSell(t) {
    const x = toX(t.x), z = toZ(t.y);
    for (let i = 0; i < 12; i++) debris.emit(x, 0.4, z, rand(-1.2, 1.2), rand(1, 2.5), rand(-1.2, 1.2), pick(['#7b7f88', '#5d6670', TYPE_COL[t.type]]), rand(0.05, 0.09), rand(0.8, 1.2));
    for (let i = 0; i < 5; i++) puff(x + rand(-0.3, 0.3), 0.3, z + rand(-0.3, 0.3), 0.35, 0.9, '#9a9a9a', 0.5);
    for (let i = 0; i < 10; i++) sparks.emit(x, 0.4, z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), '#f1c40f', 0.6, 4);
  }

  // ─── Placement preview, range rings ────────────────────────────────────────
  function makeRange(fillHex, fillOpacity, ringHex, ringOpacity) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: fillHex, transparent: true, opacity: fillOpacity, depthWrite: false })));
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ringHex, transparent: true, opacity: ringOpacity, depthWrite: false })));
    g.children.forEach(m => { m.renderOrder = 3; });
    g.visible = false; scene.add(g);
    return g;
  }
  const selRange = makeRange('#ffffff', 0.07, '#ffffff', 0.55);
  const hoverRange = makeRange('#ffffff', 0.04, '#ffffff', 0.3);
  const placeRange = makeRange('#3498db', 0.1, '#74b9ff', 0.6);
  const tileMark = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3498db', transparent: true, opacity: 0.35, depthWrite: false }));
  tileMark.renderOrder = 3; tileMark.visible = false; scene.add(tileMark);
  let ghost = null, ghostType = null;
  function setRange(g, t, x, z, rangePx) {
    g.position.set(x, GRASS_Y + 0.015, z);
    g.scale.set(rangePx / T, 1, rangePx / T);
    g.visible = true;
  }
  function updatePreview(state) {
    selRange.visible = hoverRange.visible = placeRange.visible = tileMark.visible = false;
    if (ghost) ghost.root.visible = false;
    const inGame = state.phase !== 'menu' && state.phase !== 'gameover' && state.phase !== 'victory';
    if (!inGame) return;
    const col = state.mouseCol, row = state.mouseRow;
    const onBoard = col >= 0 && col < COLS && row >= 0 && row < ROWS;
    const sel = state.selectedTower;
    if (sel) setRange(selRange, sel, toX(sel.x), toZ(sel.y), sel.range);

    if (state.selectedTowerType) {
      if (!onBoard) return;
      const type = state.selectedTowerType, def = TOWER_DEFS[type];
      const canPlace = canPlaceTower(col, row, type);   // game.js
      const x = tileX(col), z = tileZ(row);
      tileMark.position.set(x, (isPathTile(col, row) ? 0 : GRASS_Y) + 0.012, z);
      tileMark.material.color.set(canPlace ? '#3498db' : '#e74c3c');
      tileMark.visible = true;
      placeRange.children[0].material.color.set(canPlace ? '#3498db' : '#e74c3c');
      placeRange.children[1].material.color.set(canPlace ? '#74b9ff' : '#ff7b6b');
      setRange(placeRange, null, x, z, def.range * UPGRADE_MULTS[0].range * T);
      if (canPlace) {
        if (ghostType !== type) {
          if (ghost) { scene.remove(ghost.root); disposeTree(ghost.root); }
          const stand = { type, level: 1, angle: -Math.PI / 4 };
          ghost = buildTowerModel(stand); ghostType = type;
          if (ghost.yaw) ghost.yaw.rotation.y = ghost.yawAngle;
          ghost.root.traverse(o => {
            if (!o.material) return;
            o.material = o.material.clone();
            o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity, 0.55); o.material.depthWrite = false;
            o.castShadow = false;
          });
          scene.add(ghost.root);
        }
        ghost.root.position.set(x, GRASS_Y, z);
        ghost.root.visible = true;
      }
      return;
    }
    const hovered = onBoard && state.towers.find(t => t.col === col && t.row === row);
    if (hovered && hovered !== sel) setRange(hoverRange, hovered, toX(hovered.x), toZ(hovered.y), hovered.range);
  }

  // ─── Per-frame sync from game state to scene ───────────────────────────────
  function syncTowers(state, dt, time) {
    const alive = new Set(state.towers);
    for (const [t, v] of towerViews) if (!alive.has(t)) { removeTower(v); towerViews.delete(t); }
    const kYaw = 1 - Math.exp(-dt * 18);
    for (const t of state.towers) {
      let v = towerViews.get(t);
      if (v && v.level !== t.level) { removeTower(v); towerViews.delete(t); v = null; }
      if (!v) v = buildTower(t);
      // Placement bounce: 0 → 1.25 → 1 over 0.38s (placementAnim is ticked in Tower.tickVisuals)
      let s = 1;
      if (t.placementAnim > 0) { const p = 1 - t.placementAnim / 0.38; s = p < 0.6 ? (p / 0.6) * 1.25 : 1.25 - ((p - 0.6) / 0.4) * 0.25; }
      v.root.scale.setScalar(Math.max(0.001, s));
      if (v.yaw) { v.yawAngle = lerpAngle(v.yawAngle, -t.angle, kYaw); v.yaw.rotation.y = v.yawAngle; }
      if (v.recoil) v.recoil.position.x = -(t.recoilAnim / 0.12) * v.recoilDist;
      const f = Math.max(0, t.flashTimer / 0.08);
      // flashTimer jumps back up whenever the tower fires
      const fired = t.flashTimer > (v.prevFlash || 0) + 0.01;
      v.prevFlash = t.flashTimer;
      if (fired) onFire(t, v, state);
      if (t.type === 'Freeze') {
        v.spin.rotation.y = t.spinAngle; v.spin.position.y = 0.64 + Math.sin(time * 2) * 0.04;
        v.spin.scale.setScalar(1 + 0.3 * f);                     // crystal pulses on each shot
        v.orbit.rotation.y = -t.spinAngle * 1.5;
        v.glow.material.opacity = 0.45 + 0.4 * f;
      } else if (t.type === 'Rapid') {
        v.spin.rotation.x = t.spinAngle * 2.5;
      } else if (t.type === 'Laser') {
        v.orbit.rotation.y = t.spinAngle;
        v.glow.material.opacity = t.beamActive ? 0.9 : 0.35 + 0.15 * Math.sin(time * 3);
        v.glow.scale.setScalar(t.beamActive ? 1.1 : 0.7);
      } else if (t.type === 'Tesla') {
        const pulse = 0.6 + 0.4 * Math.sin(t.spinAngle * 4);
        v.glow.material.opacity = 0.35 + 0.3 * pulse + 0.5 * f;
        v.glow.scale.setScalar(1 + 0.8 * f);
        v.sphere.material.emissiveIntensity = 0.7 + 0.3 * pulse + f;
      }
      const barrel = t.type !== 'Freeze' && t.type !== 'Tesla' && t.type !== 'Laser';
      v.flash.material.opacity = barrel ? f : 0;
      v.flash.scale.setScalar(({ Cannon: 0.9, Sniper: 0.85 }[t.type] || 0.55) * (0.6 + 0.6 * f));
    }
  }
  // One shot from tower t (detected from its flashTimer), for effects at the muzzle
  function onFire(t, v, state) {
    v.tip.getWorldPosition(_tmp);
    const { x, y, z } = _tmp, dx = Math.cos(t.angle), dz = Math.sin(t.angle);
    v.flash.material.rotation = rand(0, TAU);                    // each star flash looks different
    if (t.type === 'Freeze') {
      ring(x, y, z, 0.75, 0.35, '#bfe8ff', 0.8);
      for (let i = 0; i < 6; i++) sparks.emit(x, y, z, rand(-0.8, 0.8), rand(-0.2, 0.6), rand(-0.8, 0.8), '#e6f8ff', rand(0.3, 0.5), 0.5);
    } else if (t.type === 'Cannon' || t.type === 'Sniper') {
      // Muzzle smoke drifting forward
      const big = t.type === 'Cannon';
      puff(x + dx * 0.1, y, z + dz * 0.1, big ? 0.22 : 0.13, big ? 0.9 : 0.6, '#bdbdbd', big ? 0.45 : 0.35, dx * 0.6, dz * 0.6, 0.3);
    } else if (t.type === 'Basic' || t.type === 'Rapid') {
      // Brass casing popped out of the turret's side, behind the muzzle
      const side = Math.random() < 0.5 ? 1 : -1, back = t.type === 'Rapid' ? 0.4 : 0.35;
      debris.emit(x - dx * back, y, z - dz * back, -dz * side * rand(0.8, 1.3) - dx * 0.3, rand(1.2, 1.8), dx * side * rand(0.8, 1.3) - dz * 0.3,
        pick(['#d4a64a', '#e8c06a']), rand(0.022, 0.03), rand(0.7, 1.0));
    } else if (t.type === 'Tesla') {
      // Every enemy the bolt reached jitters with static for a moment
      for (const p of t.chainPoints.slice(1)) {
        for (const e of state.enemies) {
          if (Math.abs(e.x - p.x) < 14 && Math.abs(e.y - p.y) < 14) { const ev = enemyViews.get(e); if (ev) ev.zap = 0.3; }
        }
      }
    }
  }
  function syncEnemies(state, dt, time) {
    const alive = new Set(state.enemies);
    for (const [e, v] of enemyViews) if (!alive.has(e)) { removeEnemy(v); enemyViews.delete(e); }
    trackHits(state.enemies, dt);
    const kYaw = 1 - Math.exp(-dt * 10);
    for (const e of state.enemies) {
      const v = enemyViews.get(e) || buildEnemy(e);
      const x = toX(e.x - Math.sin(e.moveAngle) * e.wobble), z = toZ(e.y + Math.cos(e.moveAngle) * e.wobble);
      v.group.position.set(x, 0, z);
      v.yaw = lerpAngle(v.yaw, -e.moveAngle, kYaw);
      v.group.rotation.y = v.yaw;
      // Walk / hover cycles run at the enemy's current speed, so slowed enemies visibly trudge
      const adt = dt * (e.slowFactor || 1);
      v.animT += adt;
      ANIM[e.type](v, v.animT, adt);
      // Hop from a Cannon blast (onExplosion sets hop = 1)
      if (v.hop > 0) {
        v.hop = Math.max(0, v.hop - dt * 4);
        v.body.position.y += Math.sin(Math.PI * (1 - v.hop)) * 0.18;
      }
      // Static from a Tesla hit (onFire sets zap): jitter, plus flicker and sparks below
      let zf = 0;
      if (v.zap > 0) {
        v.zap -= dt;
        if (dt > 0) v.body.position.set(rand(-0.03, 0.03), v.body.position.y, rand(-0.03, 0.03));
        zf = Math.random() < 0.5 ? 0.7 : 0.25;
        if (dt > 0 && Math.random() < 0.6) sparks.emit(x + rand(-0.2, 0.2), rand(0.15, 0.7), z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(-0.3, 0.6), rand(-0.6, 0.6), pick(['#7ffff9', '#ffffff']), rand(0.08, 0.15), 0);
        if (v.zap <= 0) { v.body.position.x = 0; v.body.position.z = 0; }
      }
      if (v.parts.modRing && e.waveMod === 'Haste') v.parts.modRing.material.opacity = 0.45 + 0.4 * Math.sin(time * 10);
      const h = hitState.get(e), f = h ? h.flash / 0.09 : 0, slowed = e.slowTimer > 0;
      for (const m of v.mats) {
        const b = m.userData.baseEm;
        m.emissive.setRGB(b.r + (slowed ? 0.12 : 0) + f + zf * 0.6, b.g + (slowed ? 0.26 : 0) + f + zf * 0.85, b.b + (slowed ? 0.45 : 0) + f + zf);
      }
      // Frost patch: forms quickly when the slow starts, melts over the slow's last 0.4s
      const frostGoal = slowed ? Math.min(1, e.slowTimer / 0.4) : 0;
      v.frost += (frostGoal - v.frost) * Math.min(1, dt * (frostGoal > v.frost ? 10 : 6));
      if (v.frost > 0.01 && !v.parts.frost) {
        const m = new THREE.Mesh(G('frostPatch', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
          new THREE.MeshBasicMaterial({ map: FROST, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.position.y = 0.025; m.renderOrder = 2;
        v.parts.frost = m; v.group.add(m);
      }
      if (v.parts.frost) {
        const fp = v.parts.frost, size = Math.max(1.05, e.radius / T * 4);   // wider than the body so it shows around it
        fp.visible = v.frost > 0.01;
        fp.material.opacity = v.frost;
        fp.scale.setScalar(size * (0.7 + 0.3 * v.frost));
      }
      if (dt > 0) {
        if (e.type === 'Speeder' && Math.random() < 0.6) {
          const bx = x - Math.cos(e.moveAngle) * 0.35, bz = z - Math.sin(e.moveAngle) * 0.35;
          sparks.emit(bx, 0.27, bz, rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2), '#ffb04a', 0.3, 0);
        }
        // Snowflakes drifting down off slowed enemies
        if (slowed && Math.random() < 0.18) sparks.emit(x + rand(-0.25, 0.25), rand(0.6, 1.0), z + rand(-0.25, 0.25), rand(-0.1, 0.1), 0, rand(-0.1, 0.1), '#eaf6ff', rand(0.6, 0.9), 1.2);
        if (e.type === 'Healer' && Math.random() < 0.12) sparks.emit(x + rand(-0.4, 0.4), 0.3, z + rand(-0.4, 0.4), 0, 0.8, 0, '#7dffb2', 0.9, 0);
      }
    }
  }
  function syncProjectiles(state, dt) {
    const alive = new Set(state.projectiles);
    for (const [p, v] of projViews) if (!alive.has(p)) {
      // Did it reach its target, or just stop because the target died first?
      const hit = Math.hypot(p.x - p.target.x, p.y - p.target.y) < 24;
      if (p.source === 'Freeze') shatter(v.g.position);
      else if (HIT_COL[p.source] && hit) bulletHit(p, v.g.position);
      if (v.trail) fadingTrails.push({ r: v.trail, life: 0.2 });
      scene.remove(v.g); disposeTree(v.g); projViews.delete(p);
    }
    fadeTrails(dt);
    for (const p of state.projectiles) {
      const v = projViews.get(p) || buildProjectile(p);
      const tx = p.target.alive ? p.target.x : p.x, ty = p.target.alive ? p.target.y : p.y;
      const traveled = Math.hypot(p.x - v.sx, p.y - v.sy), remaining = Math.hypot(tx - p.x, ty - p.y);
      const f = traveled / (traveled + remaining + 1e-6);
      const y = v.h0 + (0.32 - v.h0) * f + (p.source === 'Cannon' ? Math.sin(f * Math.PI) * 1.1 : 0);
      v.g.position.set(toX(p.x), y, toZ(p.y));
      if (p.x !== v.lx || p.y !== v.ly) v.g.rotation.y = -Math.atan2(p.y - v.ly, p.x - v.lx);
      v.lx = p.x; v.ly = p.y;
      if (p.source === 'Cannon' && dt > 0 && (v.smokeT -= dt) <= 0) { v.smokeT = 0.05; puff(v.g.position.x, y, v.g.position.z, 0.12, 0.5, '#9a9a9a', 0.35); }
      if (v.trail) v.trail.set([v.start, v.g.position], camera.position);
      if (p.source === 'Freeze' && dt > 0) {
        v.core.rotation.x += dt * 14; v.core.rotation.z += dt * 9;   // tumbling shard
        if ((v.smokeT -= dt) <= 0) {                                  // frost-mist trail
          v.smokeT = 0.025;
          const { x: gx, z: gz } = v.g.position;
          sparks.emit(gx + rand(-0.04, 0.04), y + rand(-0.04, 0.04), gz + rand(-0.04, 0.04), rand(-0.15, 0.15), rand(-0.1, 0.1), rand(-0.15, 0.15), pick(['#dff4ff', '#9fd8ff']), rand(0.25, 0.4), 0.3);
          if (Math.random() < 0.3) puff(gx, y, gz, 0.07, 0.35, '#dff4ff', 0.25);
        }
      }
    }
  }
  const _A = new THREE.Vector3(), _B = new THREE.Vector3();
  function jagged(points, amount) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], segs = 7;
      for (let s = 0; s < segs; s++) {
        const p = new THREE.Vector3().lerpVectors(a, b, s / segs);
        if (s > 0) p.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(amount));
        out.push(p);
      }
    }
    out.push(points[points.length - 1].clone());
    return out;
  }
  function updateBeams(dt, time) {
    const eye = camera.position, live = dt > 0;
    for (const v of towerViews.values()) {
      const t = v.t;
      if (t.type === 'Laser') {
        if (!t.beamActive) { v.beam.forEach(b => b.hide()); continue; }
        v.tip.getWorldPosition(_A);
        const range = t.range / T;
        _B.set(toX(t.x) + Math.cos(t.angle) * range, 0.32, toZ(t.y) + Math.sin(t.angle) * range);
        const fl = 1 + 0.2 * Math.sin(time * 47) + 0.1 * Math.sin(time * 91);
        v.beam.forEach((b, i) => { b.width = b.baseWidth * (i < 2 ? fl : 1); b.set([_A, _B], eye); });
        if (live && Math.random() < 0.7) {
          const f = Math.random() * 0.9;
          sparks.emit(_A.x + (_B.x - _A.x) * f, _A.y + (_B.y - _A.y) * f, _A.z + (_B.z - _A.z) * f, rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5), '#d6d0ff', 0.3, 2);
        }
        // Burn marks on the ground under the beam's far part
        if (live && (v.burnT = (v.burnT || 0) - dt) <= 0) {
          v.burnT = 0.07;
          const f = rand(0.35, 1), bx = _A.x + (_B.x - _A.x) * f, bz = _A.z + (_B.z - _A.z) * f, gy = groundAt(bx, bz);
          if (gy > -1) burns.emit(4, (o) => { o.position.set(bx, gy + 0.008, bz); o.rotation.y = rand(0, TAU); o.scale.setScalar(rand(0.8, 1.4)); });
        }
      }
      if (t.type === 'Tesla') {
        const on = t.chainTimer > 0 && t.chainPoints.length >= 2;
        v.tip.getWorldPosition(_A);
        if (on) {
          if (live || !v.boltPts.length) {
            const pts = [_A.clone(), ...t.chainPoints.slice(1).map(p => new THREE.Vector3(toX(p.x), 0.35, toZ(p.y)))];
            v.boltPts = jagged(pts, 0.1);
            v.hitPts = pts.slice(1);
          }
          const a = Math.min(1, t.chainTimer / 0.06);
          v.bolt.forEach(b => { b.mat.opacity = b.baseOpacity * a; b.set(v.boltPts, eye); });
          v.hits.forEach((s, i) => {
            const p = v.hitPts[i];
            s.visible = !!p;
            if (p) { s.position.copy(p); s.material.opacity = 0.8 * a; }
          });
        } else {
          v.bolt.forEach(b => b.hide());
          v.hits.forEach(s => { s.visible = false; });
        }
        // Idle arcs from the sphere down to the coil
        if (live && !on && Math.random() < 0.25) {
          const ang = Math.random() * TAU;
          const end = new THREE.Vector3(_A.x + Math.cos(ang) * 0.24, _A.y - 0.3, _A.z + Math.sin(ang) * 0.24);
          v.arcPts = jagged([_A.clone(), end], 0.05); v.arcLife = 0.07;
        }
        if (v.arcLife > 0) { v.arc.forEach(b => b.set(v.arcPts, eye)); v.arcLife -= dt; }
        else v.arc.forEach(b => b.hide());
      }
    }
  }

  // ─── Camera: fixed angle by default, right-drag to orbit, wheel to zoom ────
  // The game area is always letterboxed to 1280×896, so one framing fits every window.
  // r is just far enough back to keep the island's front corners — and a portal or castle
  // standing there — inside the view.
  const HOME = { tx: 0, ty: 0, tz: 0.6, r: 34.5, th: 0, ph: 0.8 };
  const cam = Object.assign({}, HOME), goal = Object.assign({}, HOME);
  function resetCamera() {
    Object.assign(goal, HOME, { th: Math.round(cam.th / TAU) * TAU });
  }
  function orbit(dx, dy) {
    goal.th -= dx * 0.006;
    goal.ph = Math.min(1.25, Math.max(0.1, goal.ph - dy * 0.005));
  }
  // factor < 1 moves the camera closer (pinch passes the ratio of finger spreads)
  function zoomBy(factor) {
    goal.r = Math.min(40, Math.max(9, goal.r * factor));
  }
  function zoom(deltaY) { zoomBy(Math.exp(deltaY * 0.0012)); }
  function updateCamera(rawDt, state) {
    if (state.phase === 'menu' && !reduceMotion) goal.th += rawDt * 0.05;   // slow turntable behind the menu
    const k = 1 - Math.exp(-rawDt * 3.2);
    for (const key of ['tx', 'ty', 'tz', 'r', 'th', 'ph']) cam[key] += (goal[key] - cam[key]) * k;
    const sp = Math.sin(cam.ph);
    camera.position.set(cam.tx + cam.r * sp * Math.sin(cam.th), cam.ty + cam.r * Math.cos(cam.ph), cam.tz + cam.r * sp * Math.cos(cam.th));
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    // Screen shake (state.shake is in game pixels)
    if (state.shake && (state.shake.x || state.shake.y)) camera.translateX(state.shake.x / T * 0.5).translateY(state.shake.y / T * 0.5);
  }

  // ─── Picking and projection ────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  function pickTile(clientX, clientY) {
    if (!grassMesh) return null;
    const r = canvas3d.getBoundingClientRect();
    if (!r.width || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    _ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    const targets = [grassMesh, roadMesh];
    for (const v of towerViews.values()) targets.push(v.root);
    // Skip glow sprites: Three.js hits them even where they're transparent (or at opacity 0),
    // which would make empty tiles next to a tower select the tower
    const hit = raycaster.intersectObjects(targets, true).find(h => !h.object.isSprite);
    if (!hit) return null;
    const t = hit.object.userData.tower;
    if (t) return { col: t.col, row: t.row };
    return { col: Math.floor(hit.point.x + COLS / 2), row: Math.floor(hit.point.z + ROWS / 2) };
  }
  const _p = new THREE.Vector3();
  // World point above game pixel (x, y) at height h (tiles) → logical canvas pixel
  function project(x, y, h) {
    _p.set(toX(x), h, toZ(y)).project(camera);
    return [(_p.x + 1) / 2 * GAME_W, (1 - _p.y) / 2 * CANVAS_H, _p.z];
  }

  // HP bars and damage numbers, drawn on the 2D overlay at projected positions
  const numY0 = new WeakMap();
  function drawOverlay(ctx, state) {
    ctx.save();
    for (const e of state.enemies) {
      const boss = e.type === 'Boss';
      if (!boss && e.displayHp >= e.maxHp - 0.5) continue;
      const v = enemyViews.get(e);
      const [sx, sy, sz] = project(e.x, e.y, (v ? v.barH + v.body.position.y : 0.8));
      if (sz > 1) continue;
      const bw = boss ? 60 : 30, bh = boss ? 6 : 4, bx = sx - bw / 2, by = sy - bh / 2;
      const pct = Math.min(1, Math.max(0, e.displayHp / e.maxHp));
      roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, (bh + 2) / 2);
      ctx.fillStyle = 'rgba(8,10,18,0.82)'; ctx.fill();
      if (boss) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(241,196,15,0.7)'; ctx.stroke(); }
      if (pct > 0) {
        ctx.fillStyle = pct > 0.5 ? '#44d17a' : pct > 0.25 ? '#f5b041' : '#ec5f4f';
        roundRect(ctx, bx, by, Math.max(bh, bw * pct), bh, bh / 2); ctx.fill();
      }
    }
    ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.font = 'bold 15px Arial';
    for (const ft of state.floatingTexts) {
      if (!numY0.has(ft)) numY0.set(ft, ft.y);
      const y0 = numY0.get(ft);
      const [sx, sy, sz] = project(ft.x, y0, 0.85 + (y0 - ft.y) / T * 0.9);
      if (sz > 1) continue;
      const pop = ft.life > 0.85 ? 1 + (ft.life - 0.85) * 2.2 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life * 1.4));
      ctx.translate(sx, sy); ctx.scale(pop, pop);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(15,10,20,0.85)'; ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color; ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ─── Frame ─────────────────────────────────────────────────────────────────
  let time = 0, lastPhase = null;
  function render(state, rawDt) {
    if (PATH_WAYPOINTS_TILES !== builtFor) buildMap();
    const dt = state.paused ? 0 : rawDt * (state.speed || 1);
    time += dt;
    if (state.phase !== lastPhase) {
      if (lastPhase === 'menu' || lastPhase === null) resetCamera();
      lastPhase = state.phase;
    }
    updateCamera(rawDt, state);
    syncTowers(state, dt, time);
    syncEnemies(state, dt, time);
    syncProjectiles(state, dt);
    updatePreview(state);
    updateBeams(dt, time);   // tip.getWorldPosition updates its own ancestors; render() updates the rest
    sparks.update(dt); debris.update(dt); smoke.update(dt); flashes.update(dt); rings.update(dt); decals.update(dt); burns.update(dt);
    ambient.update(time);
    applyFade(portal); applyFade(gate);
    portal.glow.material.opacity = (0.45 + 0.15 * Math.sin(time * 3)) * portal.fade;
    gate.torches.forEach((tg, i) => { tg.material.opacity = (0.55 + 0.2 * Math.sin(time * 13 + i * 2) + 0.1 * Math.sin(time * 29)) * gate.fade; });
    if (dt > 0) {
      portal.swirl.rotation.z -= dt * 1.8;
      if (Math.random() < 0.3) {
        const p = portal.group.position;
        sparks.emit(p.x + rand(-0.1, 0.1), rand(0.3, 1.5), p.z + rand(-0.4, 0.4), START_DIR.c * rand(0.2, 0.6), rand(0.1, 0.4), START_DIR.r * rand(0.2, 0.6) + rand(-0.1, 0.1), '#b07cff', 0.8, 0);
      }
      gate.flags.forEach((fl, i) => { fl.rotation.y = Math.sin(time * 3 + i) * 0.35; });
    }
    renderer.render(scene, camera);
  }
  // Cap the drawing buffer so large HiDPI screens (e.g. 5K, ~10M px) don't make the GPU
  // shade far more pixels than it needs every frame
  const MAX_PIXELS = 4e6;
  function resize(cssW, cssH, dpr) {
    renderer.setPixelRatio(Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssW * cssH))));
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH; camera.updateProjectionMatrix();
  }

  return {
    ok: true, render, resize, drawOverlay, pickTile, project, orbit, zoom, zoomBy, resetCamera,
    onSpawn, onDeath, onEscape, onExplosion, onPlace, onUpgrade, onSell,
  };
})();
