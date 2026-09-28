// ─── Difficulty settings ──────────────────────────────────────────────────────
const DIFF_SETTINGS = {
  Beginner: { gold: 200, lives: 25, hpMult: 0.8, regenPerWave: 2 },
  Normal:   { gold: 150, lives: 20, hpMult: 1.0, regenPerWave: 1 },
  Veteran:  { gold: 100, lives: 15, hpMult: 1.2, regenPerWave: 0 },
};
let selectedDifficulty = 'Normal';
let selectedEndless    = false;

const ENDLESS_HP_SCALE = 0.12; // +12% HP per tier beyond wave 20

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');
const scene3d = document.getElementById('scene3d');
let renderScale = 1;   // backing-store pixels per logical canvas pixel

// ─── Fit canvases to the window, drawn at the screen's pixel density ─────────
function fitCanvas() {
  const scale = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
  const dpr   = Math.min(window.devicePixelRatio || 1, 2);
  const cssW  = CANVAS_W * scale, cssH = CANVAS_H * scale;
  const left  = Math.max(0, (window.innerWidth  - cssW) / 2);
  const top   = Math.max(0, (window.innerHeight - cssH) / 2);
  Object.assign(canvas.style, { width: `${cssW}px`, height: `${cssH}px`, left: `${left}px`, top: `${top}px` });
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  renderScale   = canvas.width / CANVAS_W;

  // The 3D view covers the game area; the sidebar is drawn on the 2D canvas
  const gameW = COLS * TILE_SIZE * scale;
  Object.assign(scene3d.style, { width: `${gameW}px`, height: `${cssH}px`, left: `${left}px`, top: `${top}px` });
  Render3D.resize(gameW, cssH, dpr);
}
window.addEventListener('resize', fitCanvas);
// devicePixelRatio can also change without a resize, e.g. when the window moves to another monitor
(function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener('change', () => { fitCanvas(); watchPixelRatio(); }, { once: true });
})();
fitCanvas();

// ─── Game state factory ───────────────────────────────────────────────────────
function makeState(mapIndex = 0) {
  const diff = DIFF_SETTINGS[selectedDifficulty] || DIFF_SETTINGS.Normal;
  return {
    gold:              diff.gold,
    lives:             diff.lives,
    maxLives:          diff.lives,
    hpMult:            diff.hpMult,
    regenPerWave:      diff.regenPerWave,
    difficulty:        selectedDifficulty,
    waveIndex:         0,
    phase:             'menu',
    speed:             1,
    mapIndex:          mapIndex,
    towers:            [],
    enemies:           [],
    projectiles:       [],
    floatingTexts:     [],
    particles:         [],
    selectedTowerType: null,
    selectedTower:     null,
    spawnQueue:        [],
    spawnTimer:        0,
    waveTotal:         0,
    waveModifier:      null,
    killCount:         0,
    banner:            null,
    bannerTimer:       0,
    mouseCol:          -1,
    mouseRow:          -1,
    menuHover:         -1,
    scoreSaved:        false,
    paused:            false,
    countdown:         0,
    sellConfirm:       false,
    sellConfirmTimer:  0,
    // stats tracking
    stats:             { Basic: 0, Sniper: 0, Cannon: 0, Freeze: 0, Rapid: 0, Laser: 0, Tesla: 0 },
    livesLost:         0,
    waveLifeLoss:      [],
    _curWaveLifeLoss:  0,
    shake:            { x: 0, y: 0, timer: 0, duration: 0.3, intensity: 0 },
    flashTimer:       0,
    showFPS:          false,
    showHotkeys:      false,
    endlessMode:      selectedEndless,
  };
}

let state = makeState(0);

// ─── Damage tracker (called from Enemy.takeDamage) ────────────────────────────
function _onDamage(dmg, source) {
  if (source && state.stats) {
    state.stats[source] = (state.stats[source] || 0) + dmg;
  }
}

// ─── Save / Resume ────────────────────────────────────────────────────────────
function saveGame() {
  if (state.phase !== 'build' && state.phase !== 'countdown') return;
  const data = {
    mapIndex:   state.mapIndex,
    difficulty: state.difficulty,
    gold:       state.gold,
    lives:      state.lives,
    maxLives:   state.maxLives,
    waveIndex:  state.waveIndex,
    towers:     state.towers.map(t => ({
      type: t.type, col: t.col, row: t.row,
      level: t.level, priority: t.priority, invested: t.invested,
    })),
  };
  localStorage.setItem('td_save', JSON.stringify(data));
}

function loadSave() {
  try { return JSON.parse(localStorage.getItem('td_save') || 'null'); }
  catch { return null; }
}

function hasSave() { return !!loadSave(); }

function clearSave() { localStorage.removeItem('td_save'); }

function triggerShake(intensity, duration) {
  if (intensity >= state.shake.intensity || state.shake.timer < 0.05) {
    state.shake.intensity = intensity;
    state.shake.duration  = duration;
    state.shake.timer     = duration;
  }
}

function triggerFlash() {
  state.flashTimer = 0.4;
}

function resumeGame() {
  const save = loadSave();
  if (!save) return;
  selectedDifficulty = save.difficulty || 'Normal';
  setMap(save.mapIndex);
  state             = makeState(save.mapIndex);
  state.phase       = 'build';
  state.gold        = save.gold;
  state.lives       = save.lives;
  state.maxLives    = save.maxLives;
  state.waveIndex   = save.waveIndex;
  for (const t of save.towers) {
    const tower    = new Tower(t.type, t.col, t.row);
    tower.level    = t.level;
    tower.invested = t.invested;
    tower.priority = t.priority;
    state.towers.push(tower);
  }
  Audio.startMusic();
}

// ─── Input helpers ────────────────────────────────────────────────────────────
function canvasXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return [
    (clientX - r.left) * (CANVAS_W / r.width),
    (clientY - r.top)  * (CANVAS_H / r.height),
  ];
}

// Tile under the pointer, found by raycasting into the 3D scene (null outside the map)
function tileAt(clientX, clientY) {
  const [mx] = canvasXY(clientX, clientY);
  if (mx >= UI_X || state.phase === 'menu') return null;
  return Render3D.pickTile(clientX, clientY);
}

// Hovered tile. Re-picked every frame (from draw) as well as on pointer moves, because
// the camera keeps moving after a zoom or orbit while the pointer stays still.
let pointer = null;   // last pointer position over the canvas (client px), or null
function updateHoverTile() {
  const tile = pointer ? tileAt(pointer.x, pointer.y) : null;
  state.mouseCol = tile ? tile.col : -1;
  state.mouseRow = tile ? tile.row : -1;
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'p' || e.key === 'P') {
    if (state.phase === 'fight' || state.phase === 'build' ||
        state.phase === 'countdown') togglePause();
  }

  if (e.key === 'Escape') {
    state.selectedTowerType = null;
    state.selectedTower     = null;
    state.showHotkeys       = false;
  }

  // ? — toggle hotkey cheatsheet
  if (e.key === '?' || e.key === '/') {
    state.showHotkeys = !state.showHotkeys;
  }

  // F — toggle FPS counter
  if (e.key === 'f' || e.key === 'F') {
    state.showFPS = !state.showFPS;
  }

  // C — reset the camera
  if (e.key === 'c' || e.key === 'C') Render3D.resetCamera();

  // Space — start wave / skip countdown
  if (e.key === ' ') {
    e.preventDefault();
    if (state.phase === 'build' || state.phase === 'countdown') startWave();
  }

  // 1–6 — select tower type
  if (e.key >= '1' && e.key <= '7') {
    const types = Object.keys(TOWER_DEFS);
    const idx   = parseInt(e.key) - 1;
    if (idx < types.length) {
      const type = types[idx];
      state.selectedTowerType = state.selectedTowerType === type ? null : type;
      state.selectedTower     = null;
    }
  }

  // U — upgrade selected tower
  if ((e.key === 'u' || e.key === 'U') && state.selectedTower) {
    const t = state.selectedTower;
    if (t.level < 3) {
      const cost = t.upgradeCost;
      if (state.gold >= cost) {
        state.gold -= t.upgrade();
        Audio.upgrade();
        Render3D.onUpgrade(t);
      }
    }
  }
});

// ─── Hover (mouse / pen): hovered tile, menu hover, cursor ────────────────────
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;   // touch has no hover; presses handle it below
  const [mx, my] = canvasXY(e.clientX, e.clientY);
  pointer = { x: e.clientX, y: e.clientY };
  updateHoverTile();

  if (state.phase === 'menu') {
    const hit = menuHitAt(mx, my);
    state.menuHover      = hit && hit.kind === 'map' ? hit.index : -1;
    canvas.style.cursor = hit ? 'pointer' : 'default';
  }
  else if (mx >= UI_X)               canvas.style.cursor = 'pointer';
  else if (state.selectedTowerType)  canvas.style.cursor = 'crosshair';
  else                               canvas.style.cursor = 'default';
});

canvas.addEventListener('pointerleave', e => {
  if (e.pointerType !== 'touch') { pointer = null; updateHoverTile(); }
});

// ─── Presses (mouse, touch, pen), one set of Pointer Events ──────────────────
// A primary press (left click, tap) calls handleClick on release, at the point where it
// started, if it stayed within SLOP. Right-drag (mouse) or one-finger drag (touch, pen)
// orbits the camera; with a second finger down, the fingers pinch to zoom. A right-click,
// or a Ctrl-click on a Mac, without dragging cancels placement / selection.
// Pointer-downs are tracked on window so a finger landing on the letterbox still counts;
// presses on the canvas are captured so their release is never missed.
const SLOP = { mouse: 4, touch: 10, pen: 10 };   // px a press may drift and still be a click
const fingers = new Map();   // pointerId → { x, y } for every pointer currently down
let press = null;            // the gesture in progress, from the first pointer down to the last up

function cancelSelection() {
  state.selectedTowerType = null;
  state.selectedTower     = null;
}

// Distance between the first two pointers down (0 with fewer than two)
function fingerSpread() {
  const [a, b] = fingers.values();
  return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

window.addEventListener('pointerdown', e => {
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (press) {                         // another finger joined: never a click, pinch from here on
    press.multi  = true;
    press.spread = fingerSpread();
    pointer = null;
    return;
  }
  const onCanvas = e.target === canvas;
  if (onCanvas) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}   // throws if the pointer is already gone
  }
  const [mx] = canvasXY(e.clientX, e.clientY);
  press = {
    id: e.pointerId, type: e.pointerType, onCanvas,
    x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: 0,
    secondary: e.button === 2, multi: false, spread: 0,
    camera: onCanvas && mx < UI_X && state.phase !== 'menu',
  };
  // A finger resting on the map previews placement under it
  if (e.pointerType !== 'mouse' && onCanvas) pointer = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointermove', e => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = press;
  if (!g) return;
  // Mouse button released where we never saw it (e.g. after switching apps mid-drag)
  if (e.pointerType === 'mouse' && e.buttons === 0) { fingers.delete(e.pointerId); press = null; return; }

  if (fingers.size > 1) {              // pinch: zoom by the change in finger spread
    const s = fingerSpread();
    if (g.camera && g.spread && s) Render3D.zoomBy(g.spread / s);
    g.spread = s;
    if (e.pointerId === g.id) { g.x = e.clientX; g.y = e.clientY; }
    return;
  }
  if (e.pointerId !== g.id) return;
  const dx = e.clientX - g.x, dy = e.clientY - g.y;
  g.x = e.clientX; g.y = e.clientY;
  g.moved += Math.abs(dx) + Math.abs(dy);
  if (g.moved <= SLOP[g.type]) return;
  if (g.type !== 'mouse') pointer = null;          // a drag now, not a placement
  // Mouse orbits with the right button only; left stays for clicking
  if (g.camera && (g.type !== 'mouse' || g.secondary)) Render3D.orbit(dx, dy);
});

function endPress(e, cancelled) {
  if (!fingers.delete(e.pointerId)) return;
  const g = press;
  if (!g) return;
  if (fingers.size) {                  // fingers remain: carry on from one of them
    if (e.pointerId === g.id) {
      const [id, f] = fingers.entries().next().value;
      Object.assign(g, { id, x: f.x, y: f.y });
    }
    g.spread = fingerSpread();
    return;
  }
  press = null;
  if (g.type !== 'mouse') pointer = null;
  if (cancelled) return;
  Audio.init();   // pointerup is a user gesture phones accept for starting audio
  if (g.moved > SLOP[g.type]) return;             // it was a drag
  if (g.secondary) { cancelSelection(); return; }
  if (g.multi || !g.onCanvas) return;
  // Resolve where the placement preview was: under the finger where it landed (touch, pen),
  // or under the cursor (mouse, whose preview follows it)
  const x = g.type === 'mouse' ? e.clientX : g.startX, y = g.type === 'mouse' ? e.clientY : g.startY;
  const [mx, my] = canvasXY(x, y);
  handleClick(mx, my, tileAt(x, y));
}
window.addEventListener('pointerup',     e => endPress(e, false));
window.addEventListener('pointercancel', e => endPress(e, true));

// Suppress the browser menu everywhere (Windows fires it where the button is released,
// which can be the letterbox). On a Mac, Ctrl-click fires it mid-press: treat that press
// as a right-click. A touch long-press also fires it, and must stay a normal press.
window.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (press && press.type === 'mouse') press.secondary = true;
});

// Stops iOS long-press callouts and the synthetic mouse events / click after a tap
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

canvas.addEventListener('wheel', e => {
  const [mx] = canvasXY(e.clientX, e.clientY);
  if (mx >= UI_X || state.phase === 'menu') return;
  e.preventDefault();
  // deltaY can be in lines or pages rather than pixels, depending on browser and device
  Render3D.zoom(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1));
}, { passive: false });

// ─── Click handler ────────────────────────────────────────────────────────────
// (mx, my) are canvas coordinates for the menu, overlays and sidebar;
// `tile` is the map tile under the pointer, or null.
function handleClick(mx, my, tile) {
  // Menu: resume, difficulty, endless toggle, map cards (layout shared with drawing in ui.js)
  if (state.phase === 'menu') {
    const hit = menuHitAt(mx, my);
    if (!hit) return;
    if (hit.kind === 'resume') resumeGame();
    else if (hit.kind === 'difficulty') { selectedDifficulty = hit.value; state.difficulty = selectedDifficulty; }
    else if (hit.kind === 'endless') { selectedEndless = !selectedEndless; state.endlessMode = selectedEndless; }
    else selectMap(hit.index);
    return;
  }

  // Game-over / victory overlays
  if (state.phase === 'gameover' || state.phase === 'victory') {
    const halfW = (COLS * TILE_SIZE) / 2;
    const cy    = CANVAS_H / 2;
    if (mx >= halfW - 170 && mx <= halfW - 15 && my >= cy + 110 && my <= cy + 154) {
      restartCurrentMap();
    }
    if (mx >= halfW + 15 && mx <= halfW + 170 && my >= cy + 110 && my <= cy + 154) {
      goToMenu();
    }
    return;
  }

  // Sidebar
  if (mx >= UI_X) {
    handleSidebarClick(mx, my);
    return;
  }

  // Game grid
  const col = tile ? tile.col : -1;
  const row = tile ? tile.row : -1;

  const hit = state.towers.find(t => t.col === col && t.row === row);
  if (hit) {
    if (state.selectedTower !== hit) {
      state.sellConfirm      = false;
      state.sellConfirmTimer = 0;
    }
    state.selectedTower     = hit;
    state.selectedTowerType = null;
    return;
  }

  if (state.selectedTowerType) { placeTower(col, row); return; }

  // Deselect
  state.selectedTower    = null;
  state.sellConfirm      = false;
  state.sellConfirmTimer = 0;
}

// ─── Sidebar clicks ───────────────────────────────────────────────────────────
function handleSidebarClick(mx, my) {
  // Tower type selection
  const types = Object.keys(TOWER_DEFS);
  for (let i = 0; i < types.length; i++) {
    const ty = TOWER_BTNS_Y + i * TOWER_BTN_H;
    if (mx >= UI_X + 8 && mx <= UI_X + UI_WIDTH - 8 && my >= ty + 2 && my <= ty + TOWER_BTN_H - 2) {
      const type = types[i];
      state.selectedTowerType = state.selectedTowerType === type ? null : type;
      state.selectedTower     = null;
      state.sellConfirm       = false;
      state.sellConfirmTimer  = 0;
      return;
    }
  }

  // Start wave (build phase)
  if ((state.phase === 'build' || state.phase === 'countdown') &&
      mx >= UI_X + 10 && mx <= UI_X + UI_WIDTH - 10 &&
      my >= CONTROLS_Y && my <= CONTROLS_Y + 40) {
    startWave(); return;
  }

  const half = (UI_WIDTH - 24) / 2;

  // Pause (left half)
  if (mx >= UI_X + 10 && mx <= UI_X + 10 + half &&
      my >= CONTROLS_Y + 44 && my <= CONTROLS_Y + 72) {
    togglePause(); return;
  }

  // Speed cycle 1→2→3→1 (right half)
  const mx2 = UI_X + 10 + half + 4;
  if (mx >= mx2 && mx <= mx2 + half &&
      my >= CONTROLS_Y + 44 && my <= CONTROLS_Y + 72) {
    state.speed = state.speed >= 3 ? 1 : state.speed + 1; return;
  }

  // Mute (left half)
  if (mx >= UI_X + 10 && mx <= UI_X + 10 + half &&
      my >= CONTROLS_Y + 76 && my <= CONTROLS_Y + 102) {
    Audio.muted = !Audio.muted; return;
  }

  // Menu (right half)
  if (mx >= mx2 && mx <= mx2 + half &&
      my >= CONTROLS_Y + 76 && my <= CONTROLS_Y + 102) {
    goToMenu(); return;
  }

  // Help / hotkeys button
  if (mx >= UI_X + 10 && mx <= UI_X + UI_WIDTH - 10 &&
      my >= CONTROLS_Y + 108 && my <= CONTROLS_Y + 132) {
    state.showHotkeys = !state.showHotkeys; return;
  }

  // Tower action buttons (when tower is selected)
  if (state.selectedTower) handleTowerActionClick(mx, my);
}

// ─── Tower info panel clicks ──────────────────────────────────────────────────
function handleTowerActionClick(mx, my) {
  const t  = state.selectedTower;
  const iy = TOWER_INFO_Y;

  // Priority buttons
  const pKeys = ['first', 'last', 'strongest', 'weakest'];
  for (let i = 0; i < 4; i++) {
    const bx = UI_X + 10 + (i % 2) * 89;
    const by = iy + 105 + Math.floor(i / 2) * 26;
    if (mx >= bx && mx <= bx + 84 && my >= by && my <= by + 22) {
      t.priority = pKeys[i]; return;
    }
  }

  // Upgrade
  const upY = iy + 159;
  if (t.level < 3 && mx >= UI_X + 10 && mx <= UI_X + UI_WIDTH - 10 && my >= upY && my <= upY + 28) {
    const cost = t.upgradeCost;
    if (state.gold >= cost) {
      state.gold -= t.upgrade();
      Audio.upgrade();
      Render3D.onUpgrade(t);
    }
    return;
  }

  // Sell (two-click confirmation)
  const sellY = iy + 194;
  if (mx >= UI_X + 10 && mx <= UI_X + UI_WIDTH - 10 && my >= sellY && my <= sellY + 28) {
    if (state.sellConfirm && state.sellConfirmTimer > 0) {
      // Second click — execute sell
      Render3D.onSell(t);
      state.gold          += t.sellValue;
      state.towers         = state.towers.filter(tt => tt !== t);
      state.selectedTower  = null;
      state.sellConfirm    = false;
      state.sellConfirmTimer = 0;
      Audio.sell();
    } else {
      // First click — arm confirmation
      state.sellConfirm      = true;
      state.sellConfirmTimer = 2.5;
    }
    return;
  }
}

// ─── Tower placement ──────────────────────────────────────────────────────────
// The one placement rule, also used by the 3D placement preview
function canPlaceTower(col, row, type) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS &&
         !isPathTile(col, row) &&
         !state.towers.some(t => t.col === col && t.row === row) &&
         state.gold >= TOWER_DEFS[type].cost;
}

function placeTower(col, row) {
  if (!canPlaceTower(col, row, state.selectedTowerType)) return;
  const def = TOWER_DEFS[state.selectedTowerType];

  state.gold -= def.cost;
  const tower = new Tower(state.selectedTowerType, col, row);
  state.towers.push(tower);
  Render3D.onPlace(tower);
  Audio.towerPlace();
}

// ─── Map / game management ────────────────────────────────────────────────────
function startMap(index) {
  setMap(index);
  state          = makeState(index);
  state.phase    = 'build';
  state.mapIndex = index;
  Audio.startMusic();
}

function selectMap(index)      { startMap(index); }
function restartCurrentMap()   { startMap(state.mapIndex); }

function goToMenu() {
  Audio.stopMusic();
  clearSave();
  state       = makeState(0);
  state.phase = 'menu';
  setMap(0);
}

function togglePause() {
  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') return;
  state.paused = !state.paused;
  if (state.paused) Audio.pauseMusic();
  else              Audio.resumeMusic();
}

function startWave() {
  if (state.waveIndex >= WAVES.length && !state.endlessMode) return;

  // Early-send bonus when called during countdown
  if (state.phase === 'countdown') {
    const bonus = Math.floor(state.countdown * 5);
    if (bonus > 0) {
      state.gold += bonus;
      state.banner      = `+${bonus}g early bonus!`;
      state.bannerTimer = 1.5;
      Audio.income();
    }
  }

  const mod         = getWaveModifier(state.waveIndex);
  state.waveModifier = mod;
  state.spawnQueue  = buildSpawnQueue(state.waveIndex);

  // Swarm: double the queue, enemies get half HP
  if (mod === 'Swarm') {
    const extra = state.spawnQueue.map(e => ({ type: e.type, delay: e.delay + 0.35 }));
    state.spawnQueue = [...state.spawnQueue, ...extra].sort((a, b) => a.delay - b.delay);
  }

  state.waveTotal      = state.spawnQueue.length;
  state.spawnTimer     = 0;
  state.phase          = 'fight';
  state.countdown      = 0;
  state._curWaveLifeLoss = 0;

  const modTag  = mod ? ` [${mod}]` : '';
  const tierTag = (state.endlessMode && state.waveIndex >= WAVES.length)
    ? `  ∞ Tier ${state.waveIndex - WAVES.length + 1}` : '';
  if (!state.banner || state.bannerTimer <= 0) {
    state.banner      = `Wave ${state.waveIndex + 1}${tierTag}${modTag}`;
    state.bannerTimer = 1.8;
  }
  Audio.waveStart();
}

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastTime  = 0;
let _fpsFrames = 0, _fpsTime = 0, _fps = 0;

function gameLoop(ts) {
  const rawDt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime    = ts;

  // FPS tracking (updated every 0.5s)
  _fpsFrames++;
  _fpsTime += rawDt;
  if (_fpsTime >= 0.5) {
    _fps       = Math.round(_fpsFrames / _fpsTime);
    _fpsFrames = 0;
    _fpsTime   = 0;
  }

  update(rawDt);
  draw(rawDt);
  requestAnimationFrame(gameLoop);
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update(rawDt) {
  const dt = state.paused ? 0 : rawDt * state.speed;

  // Screen shake & flash — tick with real time always
  if (state.shake.timer > 0) {
    state.shake.timer -= rawDt;
    const s = state.shake.intensity * Math.max(0, state.shake.timer / state.shake.duration);
    state.shake.x = (Math.random() - 0.5) * 2 * s;
    state.shake.y = (Math.random() - 0.5) * 2 * s;
    if (state.shake.timer <= 0) { state.shake.x = 0; state.shake.y = 0; }
  }
  if (state.flashTimer > 0) state.flashTimer -= rawDt;

  // Tower visual timers (muzzle flash, recoil, lightning, placement bounce) — every phase
  for (const t of state.towers) t.tickVisuals(dt, rawDt);

  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') {
    tickParticles(rawDt);
    tickFloatingTexts(rawDt);
    return;
  }

  if (state.bannerTimer > 0) state.bannerTimer -= rawDt;

  // Sell confirm timer (unscaled, real time)
  if (state.sellConfirmTimer > 0) {
    state.sellConfirmTimer -= rawDt;
    if (state.sellConfirmTimer <= 0) {
      state.sellConfirm      = false;
      state.sellConfirmTimer = 0;
    }
  }

  if (state.paused) {
    tickParticles(0);
    tickFloatingTexts(0);
    return;
  }

  // Countdown phase
  if (state.phase === 'countdown') {
    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      startWave();
    }
    tickParticles(dt);
    tickFloatingTexts(dt);
    return;
  }

  if (state.phase === 'fight') {
    // Spawn
    state.spawnTimer += dt;
    while (state.spawnQueue.length > 0 && state.spawnTimer >= state.spawnQueue[0].delay) {
      const entry = state.spawnQueue.shift();
      const e     = new Enemy(entry.type);
      if (state.hpMult !== 1) {
        e.hp    = Math.round(e.hp * state.hpMult);
        e.maxHp = e.hp;
      }
      const mod = state.waveModifier;
      if (mod === 'Haste')   { e.speed *= 1.4; e.waveMod = 'Haste'; }
      if (mod === 'Armored') { e.waveArmored = true; e.waveMod = 'Armored'; }
      if (mod === 'Swarm')   {
        e.hp    = Math.round(e.hp * 0.5);
        e.maxHp = e.hp;
        e.waveMod = 'Swarm';
      }
      // Endless scaling: +12 % HP per tier beyond wave 20
      if (state.endlessMode && state.waveIndex >= WAVES.length) {
        const tier  = state.waveIndex - WAVES.length + 1;
        const scale = 1 + tier * ENDLESS_HP_SCALE;
        e.hp        = Math.round(e.hp * scale);
        e.maxHp     = e.hp;
      }
      // Start the smooth HP bar at the adjusted HP (difficulty and Swarm can lower it
      // below the base value, which would put displayHp above maxHp)
      e.displayHp = e.hp;
      e.alive = true;
      state.enemies.push(e);
      Render3D.onSpawn(e);
    }

    // Update enemies
    for (const e of state.enemies) e.update(dt, state.enemies);

    // Resolve dead / escaped enemies
    const survived = [];
    for (const e of state.enemies) {
      if (e.escaped) {
        state.lives -= 1;
        state.livesLost++;
        state._curWaveLifeLoss++;
        if (state.lives < 0) state.lives = 0;
        Render3D.onEscape(e);
        Audio.lifeLost();
      } else if (!e.alive) {
        state.gold += e.reward;
        state.killCount++;
        if (e.lastHitTower) e.lastHitTower.killCount++;
        e.reward = 0;
        Render3D.onDeath(e);
        Audio.enemyDeath(e.type === 'Boss');
        if (e.type === 'Boss') { triggerShake(10, 0.7); triggerFlash(); }
      } else {
        survived.push(e);
      }
    }
    state.enemies = survived;

    if (state.lives <= 0) {
      state.phase = 'gameover';
      // Towers stop updating from here on, so switch off any Laser that was firing
      for (const t of state.towers) t.beamActive = false;
      if (!state.scoreSaved) {
        if (state.endlessMode) saveEndlessScore(state);
        else saveScore(state);
        state.scoreSaved = true;
      }
      clearSave();
      Audio.gameOver();
      return;
    }

    // Update towers
    for (const t of state.towers) {
      const prevLen = state.projectiles.length;
      t.update(dt, state.enemies, state.projectiles, state.floatingTexts);
      if (state.projectiles.length > prevLen) Audio.shoot(t.type);
    }

    // Update projectiles
    const nextP = [];
    for (const p of state.projectiles) {
      const wasAlive = p.alive;
      p.update(dt, state.enemies, state.floatingTexts);
      if (!p.alive && wasAlive && p.aoe > 0) {
        triggerShake(4, 0.18);
        Render3D.onExplosion(p.x, p.y);
      }
      if (p.alive) nextP.push(p);
    }
    state.projectiles = nextP;

    // Wave complete?
    if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.waveIndex++;
      if (state.waveIndex >= WAVES.length && !state.endlessMode) {
        state.phase = 'victory';
        if (!state.scoreSaved) { saveScore(state); state.scoreSaved = true; }
        clearSave();
        Audio.victory();
        triggerFlash();
        state.particles.push(...spawnVictoryParticles());
      } else {
        // Record life loss for this wave
        state.waveLifeLoss.push(state._curWaveLifeLoss);
        state._curWaveLifeLoss = 0;

        // Wave income
        const income = waveIncome(state.waveIndex - 1);
        state.gold  += income;
        Audio.income();

        // Life regen (Beginner: +2, Normal: +1, Veteran: 0)
        let regenText = '';
        if (state.regenPerWave > 0) {
          const regen = Math.min(state.regenPerWave, state.maxLives - state.lives);
          if (regen > 0) {
            state.lives += regen;
            regenText    = `  +${regen}\u2665`;
          }
        }

        state.phase       = 'countdown';
        state.countdown   = 10;
        saveGame(); // auto-save between waves
        state.banner      = `Wave ${state.waveIndex} cleared!  +${income}g${regenText}`;
        state.bannerTimer = 2.2;
        Audio.waveComplete();
      }
    }
  }

  tickParticles(dt);
  tickFloatingTexts(dt);
}

function tickParticles(dt) {
  const next = [];
  for (const p of state.particles) {
    p.update(dt);
    if (p.life > 0) next.push(p);
  }
  state.particles = next;
}

function tickFloatingTexts(dt) {
  const next = [];
  for (const ft of state.floatingTexts) {
    ft.update(dt);
    if (ft.life > 0) next.push(ft);
  }
  state.floatingTexts = next;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
// The game area is rendered in 3D by Render3D (on #scene3d, underneath); this
// 2D canvas is transparent over the map and draws the sidebar and overlays.
function draw(rawDt) {
  updateHoverTile();
  Render3D.render(state, rawDt);

  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (!Render3D.ok) {
    ctx.fillStyle = '#95a5a6'; ctx.font = '15px Arial'; ctx.textAlign = 'center';
    ctx.fillText('The 3D view could not start (Three.js did not load or WebGL is unavailable).', (COLS * TILE_SIZE) / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
  }

  if (state.phase === 'menu') {
    drawMenuScreen(ctx, state);
    return;
  }

  // HP bars and damage numbers, positioned over the 3D scene
  Render3D.drawOverlay(ctx, state);

  // Boss death flash — full-screen white pulse over game area, under UI
  if (state.flashTimer > 0) {
    const alpha = Math.max(0, state.flashTimer / 0.4) * 0.72;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(0, 0, COLS * TILE_SIZE, CANVAS_H);
  }

  // Danger border — pulsing red vignette when lives are critical
  drawDangerBorder(ctx, state);

  // Countdown number on map (shown between waves)
  drawMapCountdown(ctx, state);

  drawUI(ctx, state);
  drawBossHPBar(ctx, state);
  drawWaveBanner(ctx, state);

  if (state.paused) drawPauseOverlay(ctx);

  if (state.phase === 'gameover') drawGameOver(ctx, state);
  if (state.phase === 'victory') {
    drawVictory(ctx, state);
    // Confetti on top of the overlay
    for (const p of state.particles) p.draw(ctx);
  }

  // Hotkey overlay (above everything except FPS)
  drawHotkeyOverlay(ctx, state);

  // FPS counter (topmost layer)
  if (state.showFPS) {
    const label = `${_fps} FPS`;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(6, 6, 68, 26);
    ctx.fillStyle = _fps >= 55 ? '#2ecc71' : _fps >= 30 ? '#f39c12' : '#e74c3c';
    ctx.font      = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, 10, 24);
  }
}

// ─── Kick off ─────────────────────────────────────────────────────────────────
requestAnimationFrame(gameLoop);
