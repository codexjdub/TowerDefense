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
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

// ─── Fit canvas to window (scale down on small screens) ──────────────────────
function fitCanvas() {
  const scale = Math.min(
    window.innerWidth  / canvas.width,
    window.innerHeight / canvas.height,
    1  // never upscale
  );
  canvas.style.transformOrigin = 'top left';
  canvas.style.transform       = `scale(${scale})`;
  canvas.style.left = `${Math.max(0, (window.innerWidth  - canvas.width  * scale) / 2)}px`;
  canvas.style.top  = `${Math.max(0, (window.innerHeight - canvas.height * scale) / 2)}px`;
}
window.addEventListener('resize', fitCanvas);
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
    ambientParticles: [],
    spawnRipples:     [],
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
  state.ambientParticles = makeAmbientParticles();
  Audio.startMusic();
}

// ─── Input helpers ────────────────────────────────────────────────────────────
function canvasXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return [
    (clientX - r.left) * (canvas.width  / r.width),
    (clientY - r.top)  * (canvas.height / r.height),
  ];
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
        state.particles.push(...spawnPlacementParticles(t.col, t.row));
      }
    }
  }
});

// ─── Mouse events ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  const [mx, my] = canvasXY(e.clientX, e.clientY);
  state.mouseCol = Math.floor(mx / TILE_SIZE);
  state.mouseRow = Math.floor(my / TILE_SIZE);

  // Menu hover detection
  if (state.phase === 'menu') {
    const perRow = Math.min(4, MAP_CONFIGS.length);
    const cardW = 210, cardH = 172, gapX = 18, gapY = 14;
    const rowW  = perRow * cardW + (perRow - 1) * gapX;
    const sx    = (CANVAS_W - rowW) / 2;
    const sy    = 164;
    let hit = -1;
    MAP_CONFIGS.forEach((_, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const cx  = sx + col * (cardW + gapX);
      const cy  = sy + row * (cardH + gapY);
      if (mx >= cx && mx <= cx + cardW && my >= cy && my <= cy + cardH) hit = i;
    });
    state.menuHover = hit;
  }

  // Cursor style
  if (mx >= UI_X)                      canvas.style.cursor = 'pointer';
  else if (state.selectedTowerType)    canvas.style.cursor = 'crosshair';
  else if (state.phase === 'menu')     canvas.style.cursor = state.menuHover >= 0 ? 'pointer' : 'default';
  else                                 canvas.style.cursor = 'default';
});

canvas.addEventListener('mouseleave', () => { state.mouseCol = -1; state.mouseRow = -1; });

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  state.selectedTowerType = null;
  state.selectedTower     = null;
});

canvas.addEventListener('click', e => {
  Audio.init();
  const [mx, my] = canvasXY(e.clientX, e.clientY);
  handleClick(mx, my);
});

// ─── Touch support ────────────────────────────────────────────────────────────
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  Audio.init();
  const t = e.touches[0];
  const [mx, my] = canvasXY(t.clientX, t.clientY);
  handleClick(mx, my);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const [mx, my] = canvasXY(t.clientX, t.clientY);
  state.mouseCol = Math.floor(mx / TILE_SIZE);
  state.mouseRow = Math.floor(my / TILE_SIZE);
}, { passive: false });

canvas.addEventListener('touchend', e => { e.preventDefault(); }, { passive: false });

// ─── Click handler ────────────────────────────────────────────────────────────
function handleClick(mx, my) {
  // Menu map/difficulty selection
  if (state.phase === 'menu') {
    // Resume saved game button (shown in leaderboard area when save exists)
    // Position matches drawLeaderboardPreview: cx=CANVAS_W/2, button at cx-180 to cx+180
    // The leaderboard y = startY + rows*(cardH+gapY)+16
    if (hasSave()) {
      const perRow = Math.min(4, MAP_CONFIGS.length);
      const rows   = Math.ceil(MAP_CONFIGS.length / perRow);
      const lbY    = 164 + rows * (172 + 14) + 16;
      if (mx >= CANVAS_W / 2 - 180 && mx <= CANVAS_W / 2 + 180 &&
          my >= lbY && my <= lbY + 28) {
        resumeGame(); return;
      }
    }

    // Difficulty buttons
    const diffOpts = ['Beginner', 'Normal', 'Veteran'];
    const dBtnW = 88, dBtnH = 26, dGap = 10;
    const dRowW = diffOpts.length * dBtnW + (diffOpts.length - 1) * dGap;
    const dsx   = (CANVAS_W - dRowW) / 2;
    const dsy   = 76;
    for (let i = 0; i < diffOpts.length; i++) {
      const bx = dsx + i * (dBtnW + dGap);
      if (mx >= bx && mx <= bx + dBtnW && my >= dsy && my <= dsy + dBtnH) {
        selectedDifficulty = diffOpts[i];
        state.difficulty   = selectedDifficulty;
        return;
      }
    }

    // Endless mode toggle
    const eBtnW = 160, eBtnH = 26;
    const ebx   = (CANVAS_W - eBtnW) / 2;
    const eby   = 116;
    if (mx >= ebx && mx <= ebx + eBtnW && my >= eby && my <= eby + eBtnH) {
      selectedEndless = !selectedEndless;
      state.endlessMode = selectedEndless;
      return;
    }

    // Map cards
    const perRow = Math.min(4, MAP_CONFIGS.length);
    const cardW = 210, cardH = 172, gapX = 18, gapY = 14;
    const rowW  = perRow * cardW + (perRow - 1) * gapX;
    const sx    = (CANVAS_W - rowW) / 2;
    const sy    = 164;
    MAP_CONFIGS.forEach((_, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const cx  = sx + col * (cardW + gapX);
      const cy  = sy + row * (cardH + gapY);
      if (mx >= cx && mx <= cx + cardW && my >= cy && my <= cy + cardH) selectMap(i);
    });
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
  const col = Math.floor(mx / TILE_SIZE);
  const row = Math.floor(my / TILE_SIZE);

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
      state.particles.push(...spawnPlacementParticles(t.col, t.row));
    }
    return;
  }

  // Sell (two-click confirmation)
  const sellY = iy + 194;
  if (mx >= UI_X + 10 && mx <= UI_X + UI_WIDTH - 10 && my >= sellY && my <= sellY + 28) {
    if (state.sellConfirm && state.sellConfirmTimer > 0) {
      // Second click — execute sell
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
function placeTower(col, row) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  if (isPathTile(col, row)) return;
  if (state.towers.find(t => t.col === col && t.row === row)) return;
  const def = TOWER_DEFS[state.selectedTowerType];
  if (state.gold < def.cost) return;

  state.gold -= def.cost;
  state.towers.push(new Tower(state.selectedTowerType, col, row));
  state.particles.push(...spawnPlacementParticles(col, row));
  Audio.towerPlace();
}

// ─── Map / game management ────────────────────────────────────────────────────
function startMap(index) {
  setMap(index);
  state                  = makeState(index);
  state.phase            = 'build';
  state.mapIndex         = index;
  state.ambientParticles = makeAmbientParticles();
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
  draw();
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

  // Ambient particles + spawn ripples (real-time, always)
  for (const ap of state.ambientParticles) ap.update(rawDt);
  state.spawnRipples = state.spawnRipples.filter(rp => { rp.update(rawDt); return rp.alive; });

  // Tick tower placement bounce animations (real-time, always — even in build/countdown)
  for (const t of state.towers) {
    if (t.placementAnim > 0) t.placementAnim = Math.max(0, t.placementAnim - rawDt);
  }

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
        e.displayHp = e.hp;
      }
      e.alive = true;
      state.enemies.push(e);
      // Spawn ripple + brief flash at START tile
      const sx = PATH_WAYPOINTS[0].x, sy = PATH_WAYPOINTS[0].y;
      state.spawnRipples.push(new SpawnRipple(sx, sy, e.color));
      state.particles.push(...spawnEnemyBirthParticles(sx, sy, e.color));
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
        state.particles.push(...spawnDeathParticles(
          PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1].x,
          PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1].y,
          e.color, e.type
        ));
        Audio.lifeLost();
      } else if (!e.alive) {
        state.gold += e.reward;
        state.killCount++;
        if (e.lastHitTower) e.lastHitTower.killCount++;
        e.reward = 0;
        state.particles.push(...spawnDeathParticles(e.x, e.y, e.color, e.type));
        Audio.enemyDeath(e.type === 'Boss');
        if (e.type === 'Boss') { triggerShake(10, 0.7); triggerFlash(); }
      } else {
        survived.push(e);
      }
    }
    state.enemies = survived;

    if (state.lives <= 0) {
      state.phase = 'gameover';
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
      p.update(dt, state.enemies, state.floatingTexts, state.particles);
      if (!p.alive && wasAlive && p.aoe > 0) triggerShake(4, 0.18);
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
function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (state.phase === 'menu') {
    drawMap(ctx);
    drawMenuScreen(ctx, state);
    return;
  }

  // Apply screen shake to the game world only (not UI/overlays)
  ctx.save();
  if (state.shake.timer > 0) ctx.translate(state.shake.x, state.shake.y);

  drawMap(ctx);

  // Ambient dust/firefly particles (over map, under towers)
  for (const ap of state.ambientParticles) ap.draw(ctx);
  // Spawn ripples at the START tile
  for (const rp of state.spawnRipples) rp.draw(ctx);

  drawPlacementPreview(ctx);
  drawHoverRangePreview(ctx);

  for (const t of state.towers) t.draw(ctx, t === state.selectedTower);
  for (const e of state.enemies) if (e.alive) e.draw(ctx);
  // Laser beams and Tesla chains drawn on top of enemies
  for (const t of state.towers) {
    if (t.type === 'Laser') t.drawBeam(ctx);
    if (t.type === 'Tesla') t.drawChain(ctx);
  }
  for (const p of state.projectiles) p.draw(ctx);
  // During victory, skip particles here — drawn on top of overlay instead
  if (state.phase !== 'victory') {
    for (const p of state.particles) p.draw(ctx);
  }
  for (const ft of state.floatingTexts) ft.draw(ctx);

  ctx.restore();

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

  if (state.phase === 'gameover') drawGameOver(ctx);
  if (state.phase === 'victory') {
    drawVictory(ctx);
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

// ─── Placement preview ────────────────────────────────────────────────────────
function drawPlacementPreview(ctx) {
  if (!state.selectedTowerType) return;
  const col = state.mouseCol, row = state.mouseRow;
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

  const def      = TOWER_DEFS[state.selectedTowerType];
  const canPlace = !isPathTile(col, row) &&
                   !state.towers.find(t => t.col === col && t.row === row) &&
                   state.gold >= def.cost;
  const px    = col * TILE_SIZE + TILE_SIZE / 2;
  const py    = row * TILE_SIZE + TILE_SIZE / 2;
  const range = def.range * UPGRADE_MULTS[0].range * TILE_SIZE;

  ctx.beginPath();
  ctx.arc(px, py, range, 0, Math.PI * 2);
  ctx.fillStyle   = canPlace ? 'rgba(52,152,219,0.10)' : 'rgba(231,76,60,0.10)';
  ctx.fill();
  ctx.strokeStyle = canPlace ? 'rgba(52,152,219,0.55)' : 'rgba(231,76,60,0.55)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.fillStyle = canPlace ? 'rgba(52,152,219,0.35)' : 'rgba(231,76,60,0.35)';
  ctx.fillRect(col * TILE_SIZE + 3, row * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
}

// ─── Hover range preview (no tower type selected, mouse over placed tower) ────
function drawHoverRangePreview(ctx) {
  if (state.selectedTowerType) return;
  if (state.mouseCol < 0 || state.mouseRow < 0) return;
  const hovered = state.towers.find(
    t => t.col === state.mouseCol && t.row === state.mouseRow
  );
  if (!hovered || hovered === state.selectedTower) return; // selected tower already draws its own ring

  ctx.beginPath();
  ctx.arc(hovered.x, hovered.y, hovered.range, 0, Math.PI * 2);
  ctx.fillStyle   = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth   = 1;
  ctx.stroke();
}

// ─── Kick off ─────────────────────────────────────────────────────────────────
requestAnimationFrame(gameLoop);
