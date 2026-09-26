// ─── Layout constants ─────────────────────────────────────────────────────────
const UI_X         = COLS * TILE_SIZE;   // 960
const TOWER_BTN_H  = 38;
const STATS_Y      = 10;
const TOWER_BTNS_Y = 128;  // after extended stats block + gap
const TOWER_INFO_Y = TOWER_BTNS_Y + Object.keys(TOWER_DEFS).length * TOWER_BTN_H + 8; // 326
const CONTROLS_Y   = CANVAS_H - 142;    // more room for ? button

// ─── Helpers ──────────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);       ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function btn(ctx, x, y, w, h, fill, stroke, r = 4) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

// ─── Main UI ──────────────────────────────────────────────────────────────────
function drawUI(ctx, state) {
  const x = UI_X;
  ctx.fillStyle = '#16213e';
  ctx.fillRect(x, 0, UI_WIDTH, CANVAS_H);
  ctx.strokeStyle = '#2d2d5e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();

  drawStats(ctx, x, STATS_Y, state);
  drawTowerButtons(ctx, x, TOWER_BTNS_Y, state);
  if (state.selectedTower) drawTowerInfo(ctx, x, TOWER_INFO_Y, state);
  drawControls(ctx, x, CONTROLS_Y, state);
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function drawStats(ctx, x, y, state) {
  ctx.textAlign = 'left';

  ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 15px Arial';
  ctx.fillText(`\u25C6 ${state.gold}g`, x + 12, y + 20);

  ctx.fillStyle = state.lives <= 5 ? '#e74c3c' : '#2ecc71';
  ctx.fillText(`\u2665 ${state.lives}/${state.maxLives} lives`, x + 12, y + 36);

  ctx.fillStyle = '#ecf0f1'; ctx.font = 'bold 13px Arial';
  if (state.endlessMode) {
    const dispWave = state.waveIndex + 1;
    const tier = state.waveIndex >= WAVES.length ? `  T${state.waveIndex - WAVES.length + 1}` : '';
    ctx.fillText(`Wave ${dispWave} \u221E${tier}`, x + 12, y + 51);
  } else {
    ctx.fillText(`Wave ${Math.min(state.waveIndex + 1, WAVES.length)} / ${WAVES.length}`, x + 12, y + 51);
  }

  ctx.font = '11px Arial';
  const phaseColors = { build: '#7f8c8d', fight: '#e67e22', countdown: '#3498db' };
  ctx.fillStyle = phaseColors[state.phase] || '#7f8c8d';
  const phaseLabels = {
    build:     '\u25A0 BUILD PHASE',
    fight:     '\u25BA WAVE IN PROGRESS',
    countdown: '\u23F1 NEXT WAVE SOON',
  };
  ctx.fillText(phaseLabels[state.phase] || '', x + 12, y + 63);

  const mapCfg = MAP_CONFIGS[state.mapIndex];
  ctx.fillStyle = mapCfg.diffColor;
  ctx.fillText(`${mapCfg.name}  \u2022  ${mapCfg.difficulty}`, x + 12, y + 75);

  ctx.fillStyle = '#7f8c8d';
  const diffColor = { Beginner: '#2ecc71', Normal: '#f39c12', Veteran: '#e74c3c' }[state.difficulty] || '#7f8c8d';
  ctx.fillStyle = diffColor; ctx.font = '10px Arial';
  ctx.fillText(`${state.difficulty || 'Normal'} mode  \u2022  Kills: ${state.killCount}`, x + 12, y + 87);

  // Wave preview (build / countdown) or progress bar (fight)
  if ((state.phase === 'build' || state.phase === 'countdown') && (state.waveIndex < WAVES.length || state.endlessMode)) {
    const preview = getWavePreview(state.waveIndex);
    if (preview.length) {
      ctx.fillStyle = '#4a5a6a'; ctx.font = '9px Arial';
      ctx.fillText('NEXT: ' + preview.map(e => `${e.count}\u00D7${e.type}`).join('  '), x + 12, y + 100);
    }
    const mod = getWaveModifier(state.waveIndex);
    if (mod) {
      const modCol = { Armored: '#95a5a6', Swarm: '#9b59b6', Haste: '#e74c3c' }[mod];
      ctx.fillStyle = modCol; ctx.font = 'bold 9px Arial';
      ctx.fillText(`\u26A1 ${mod.toUpperCase()} wave`, x + 12, y + 112);
    }
    // Income preview
    const nextIncome = waveIncome(state.waveIndex);
    ctx.fillStyle = '#f1c40f'; ctx.font = '9px Arial';
    ctx.fillText(`\u25B8 +${nextIncome}g on clear`, x + UI_WIDTH - 12 - ctx.measureText(`\u25B8 +${nextIncome}g on clear`).width, y + 100);
  } else if (state.phase === 'fight' && state.waveTotal > 0) {
    const remaining = state.enemies.length + state.spawnQueue.length;
    const pct       = Math.max(0, 1 - remaining / state.waveTotal);
    const bw        = UI_WIDTH - 24;
    ctx.fillStyle = '#1e2a45'; ctx.fillRect(x + 12, y + 93, bw, 7);
    ctx.fillStyle = pct > 0.7 ? '#2ecc71' : pct > 0.35 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(x + 12, y + 93, bw * pct, 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 12, y + 93, bw, 7);
    ctx.fillStyle = '#5a6a7a'; ctx.font = '9px Arial';
    ctx.fillText(`${remaining} enemy${remaining !== 1 ? 's' : ''} remaining`, x + 12, y + 108);
  }

  // Separator
  ctx.strokeStyle = '#2d2d5e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 8, y + 116); ctx.lineTo(x + UI_WIDTH - 8, y + 116); ctx.stroke();
}

// ─── Tower buttons ────────────────────────────────────────────────────────────
function drawTowerButtons(ctx, x, startY, state) {
  Object.keys(TOWER_DEFS).forEach((type, i) => {
    const def  = TOWER_DEFS[type];
    const y    = startY + i * TOWER_BTN_H;
    const sel  = state.selectedTowerType === type;
    const ok   = state.gold >= def.cost;

    btn(ctx, x + 8, y + 2, UI_WIDTH - 16, TOWER_BTN_H - 4,
      sel ? '#1a3a5c' : (ok ? '#1e2a45' : '#161b2e'),
      sel ? '#3498db' : (ok ? '#2d3d60' : '#252535')
    );

    ctx.fillStyle = ok ? def.color : '#555';
    ctx.fillRect(x + 14, y + 9, 18, 18);

    ctx.fillStyle = ok ? '#ecf0f1' : '#5a6a7a';
    ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left';
    ctx.fillText(type, x + 40, y + 17);

    ctx.fillStyle = ok ? '#f1c40f' : '#555';
    ctx.font = '11px Arial';
    ctx.fillText(`${def.cost}g`, x + 40, y + 30);

    ctx.fillStyle = '#5a6a7a'; ctx.font = '9px Arial';
    ctx.fillText(`Dmg:${def.damage} Rng:${def.range} ${def.fireRate > 0 ? def.fireRate + '/s' : 'beam'}`, x + 14, y + 40);
  });
}

// ─── Tower info panel ─────────────────────────────────────────────────────────
function drawTowerInfo(ctx, x, y, state) {
  const t = state.selectedTower;
  btn(ctx, x + 8, y, UI_WIDTH - 16, 236, '#1e2a45', '#2d3d60');
  ctx.textAlign = 'left';

  ctx.fillStyle = t.color; ctx.font = 'bold 13px Arial';
  ctx.fillText(t.type, x + 14, y + 17);
  ctx.fillStyle = '#f1c40f'; ctx.font = '12px Arial';
  ctx.fillText(` Lv.${t.level}`, x + 14 + ctx.measureText(t.type).width + 2, y + 17);

  ctx.fillStyle = '#bdc3c7'; ctx.font = '11px Arial';
  ctx.fillText(`Damage : ${Math.round(t.damage)}`, x + 14, y + 32);
  ctx.fillText(`Range  : ${(t.range / TILE_SIZE).toFixed(1)} tiles`, x + 14, y + 46);
  ctx.fillText(`Rate   : ${t.fireRate > 0 ? t.fireRate + '/s' : 'continuous beam'}`, x + 14, y + 59);

  // Per-tower lifetime stats
  const fmtDmg = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  ctx.fillStyle = '#5a7a5a'; ctx.font = '10px Arial';
  ctx.fillText(`\u2694 ${fmtDmg(t.totalDamage)} dmg dealt  \u2022  ${t.killCount} kills`, x + 14, y + 71);

  // Hint
  const hint = TOWER_DEFS[t.type].hint;
  if (hint) {
    ctx.fillStyle = '#4a7a9b'; ctx.font = 'italic 9px Arial';
    const words = hint.split(' ');
    let line = '', lineY = y + 83;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (test.length > 26 && line) {
        ctx.fillText(line, x + 14, lineY);
        line = w; lineY += 11;
      } else { line = test; }
    }
    if (line) ctx.fillText(line, x + 14, lineY);
  }

  ctx.fillStyle = '#7f8c8d'; ctx.font = 'bold 10px Arial';
  ctx.fillText('PRIORITY', x + 14, y + 99);

  const priorities = [
    { key: 'first',     label: 'First'    },
    { key: 'last',      label: 'Last'     },
    { key: 'strongest', label: 'Strongest'},
    { key: 'weakest',   label: 'Weakest'  },
  ];
  priorities.forEach(({ key, label }, i) => {
    const bx     = x + 10 + (i % 2) * 89;
    const by     = y + 105 + Math.floor(i / 2) * 26;
    const active = t.priority === key;
    btn(ctx, bx, by, 84, 22, active ? '#2980b9' : '#2d3d60', active ? '#3498db' : null, 3);
    ctx.fillStyle = '#fff'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
    ctx.fillText(label, bx + 42, by + 15);
    ctx.textAlign = 'left';
  });

  // Upgrade
  if (t.level < 3) {
    const cost = t.upgradeCost;
    const ok   = state.gold >= cost;
    btn(ctx, x + 10, y + 159, UI_WIDTH - 20, 28, ok ? '#1e8449' : '#2d3d40', null, 4);
    ctx.fillStyle = ok ? '#fff' : '#666';
    ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`Upgrade Lv.${t.level + 1}  (${cost}g)`, x + UI_WIDTH / 2, y + 178);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 11px Arial';
    ctx.fillText('\u2605 MAX LEVEL', x + 14, y + 174);
  }

  // Sell — shows confirm state
  const confirming = state.sellConfirm && state.sellConfirmTimer > 0;
  btn(ctx, x + 10, y + 194, UI_WIDTH - 20, 28,
    confirming ? '#e74c3c' : '#922b21', confirming ? '#ff6b6b' : null, 4);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(
    confirming ? `Confirm? (${Math.ceil(state.sellConfirmTimer)}s)` : `Sell  (+${t.sellValue}g)`,
    x + UI_WIDTH / 2, y + 213
  );
  ctx.textAlign = 'left';
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function drawControls(ctx, x, y, state) {
  // Start wave / countdown / in-progress
  if (state.phase === 'build') {
    btn(ctx, x + 10, y, UI_WIDTH - 20, 40, '#1e8449', '#27ae60', 5);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`\u25BA  Start Wave ${state.endlessMode ? state.waveIndex + 1 : Math.min(state.waveIndex + 1, WAVES.length)}`, x + UI_WIDTH / 2, y + 26);

  } else if (state.phase === 'countdown') {
    const bonus = Math.floor(state.countdown * 5);
    const pct   = state.countdown / 10;
    btn(ctx, x + 10, y, UI_WIDTH - 20, 40, '#1a3a5c', '#2980b9', 5);
    ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
    ctx.fillText(`\u25BA Skip Early  (+${bonus}g)`, x + UI_WIDTH / 2, y + 15);
    ctx.fillStyle = '#7f8c8d'; ctx.font = '10px Arial';
    ctx.fillText(`Auto-start in ${Math.ceil(state.countdown)}s`, x + UI_WIDTH / 2, y + 29);
    // Countdown bar
    ctx.fillStyle = '#2980b9';
    roundRect(ctx, x + 10, y + 34, (UI_WIDTH - 20) * pct, 5, 2); ctx.fill();

  } else if (state.phase === 'fight') {
    btn(ctx, x + 10, y, UI_WIDTH - 20, 40, '#2d2d4e', '#444', 5);
    ctx.fillStyle = '#7f8c8d'; ctx.font = '12px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Wave in progress\u2026', x + UI_WIDTH / 2, y + 26);
  }
  ctx.textAlign = 'left';

  // Pause + Speed
  const half   = (UI_WIDTH - 24) / 2;
  const paused = state.paused;
  btn(ctx, x + 10, y + 44, half, 28,
    paused ? '#7d4e00' : '#1a2744', paused ? '#f39c12' : '#2d3d60', 4);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(paused ? '\u25BA Resume' : '\u23F8 Pause', x + 10 + half / 2, y + 63);

  const mx2 = x + 10 + half + 4;
  const speedBg  = { 1: '#1a2744', 2: '#784212', 3: '#7d1234' };
  const speedBdr = { 1: '#2d3d60', 2: '#e67e22', 3: '#e74c3c' };
  const speedLbl = { 1: '\u00BB 1x', 2: '\u00BB\u00BB 2x', 3: '\u00BB\u00BB\u00BB 3x' };
  btn(ctx, mx2, y + 44, half, 28, speedBg[state.speed] || '#1a2744', speedBdr[state.speed] || '#2d3d60', 4);
  ctx.fillStyle = '#fff';
  ctx.fillText(speedLbl[state.speed] || '\u00BB 1x', mx2 + half / 2, y + 63);
  ctx.textAlign = 'left';

  // Mute + Menu
  btn(ctx, x + 10, y + 76, half, 26,
    Audio.muted ? '#4a1a1a' : '#1a2744', Audio.muted ? '#c0392b' : '#2d3d60', 4);
  ctx.fillStyle = '#fff'; ctx.font = '11px Arial'; ctx.textAlign = 'center';
  ctx.fillText(Audio.muted ? '\uD83D\uDD07 Off' : '\uD83D\uDD0A On', x + 10 + half / 2, y + 94);

  btn(ctx, mx2, y + 76, half, 26, '#2c2c4e', '#444', 4);
  ctx.fillStyle = '#bdc3c7';
  ctx.fillText('\u21BA Menu', mx2 + half / 2, y + 94);

  // Help / hotkey cheatsheet button
  const hkActive = state.showHotkeys;
  btn(ctx, x + 10, y + 108, UI_WIDTH - 20, 24,
    hkActive ? '#2c1a4e' : '#16213e', hkActive ? '#8e44ad' : '#2d2d5e', 4);
  ctx.fillStyle = hkActive ? '#c39bd3' : '#5a6a7a';
  ctx.font = '10px Arial'; ctx.textAlign = 'center';
  ctx.fillText('\u2753  Keyboard shortcuts  (? key)', x + UI_WIDTH / 2, y + 124);
  ctx.textAlign = 'left';
}

// ─── Map countdown overlay ────────────────────────────────────────────────────
function drawMapCountdown(ctx, state) {
  if (state.phase !== 'countdown') return;
  const cx   = (COLS * TILE_SIZE) / 2;
  const cy   = CANVAS_H / 2;
  const secs = Math.ceil(state.countdown);
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Giant faint number
  ctx.globalAlpha = 0.09 + 0.05 * pulse;
  ctx.fillStyle   = '#3498db';
  ctx.font        = 'bold 210px Arial';
  ctx.fillText(String(secs), cx, cy + 24);

  // "NEXT WAVE IN" label above
  ctx.globalAlpha = 0.40 + 0.18 * pulse;
  ctx.fillStyle   = '#ecf0f1';
  ctx.font        = 'bold 20px Arial';
  ctx.fillText('NEXT WAVE IN', cx, cy - 122);

  ctx.restore();
}

// ─── Hotkey cheatsheet overlay ────────────────────────────────────────────────
function drawHotkeyOverlay(ctx, state) {
  if (!state.showHotkeys) return;

  const pw = 360, ph = 272;
  const px = (COLS * TILE_SIZE - pw) / 2;
  const py = (CANVAS_H - ph) / 2;

  ctx.save();

  // Background panel
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = 'rgba(8,10,22,0.94)';
  ctx.fill();
  ctx.strokeStyle = '#3d2d6e';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Title
  ctx.fillStyle = '#f1c40f';
  ctx.font      = 'bold 15px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('KEYBOARD SHORTCUTS', px + pw / 2, py + 28);

  // Divider
  ctx.strokeStyle = '#2d2d5e'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 20, py + 38); ctx.lineTo(px + pw - 20, py + 38);
  ctx.stroke();

  const rows = [
    ['Space',  'Start wave / skip countdown'],
    ['1 – 7',  'Select tower type'],
    ['U',      'Upgrade selected tower'],
    ['P',      'Pause / Resume'],
    ['Esc',    'Deselect tower'],
    ['F',      'Toggle FPS counter'],
    ['?',      'Toggle this help'],
  ];

  rows.forEach(([key, desc], i) => {
    const ry = py + 58 + i * 28;

    // Key badge
    roundRect(ctx, px + 22, ry - 11, 62, 20, 4);
    ctx.fillStyle = '#1e2a45'; ctx.fill();
    ctx.strokeStyle = '#2d3d60'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle   = '#f1c40f';
    ctx.font        = 'bold 11px Arial';
    ctx.textAlign   = 'center';
    ctx.fillText(key, px + 53, ry + 3);

    ctx.fillStyle   = '#bdc3c7';
    ctx.font        = '12px Arial';
    ctx.textAlign   = 'left';
    ctx.fillText(desc, px + 96, ry + 3);
  });

  // Close hint
  ctx.fillStyle   = '#4a5a6a';
  ctx.font        = '10px Arial';
  ctx.textAlign   = 'center';
  ctx.fillText('Press  ?  or click the button below to close', px + pw / 2, py + ph - 12);

  ctx.restore();
}

// ─── Wave announcement banner ─────────────────────────────────────────────────
function drawWaveBanner(ctx, state) {
  if (!state.banner || state.bannerTimer <= 0) return;
  const alpha = Math.min(1, state.bannerTimer / 0.5);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, CANVAS_H / 2 - 30, COLS * TILE_SIZE, 50);
  ctx.fillStyle   = '#f1c40f'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
  ctx.fillText(state.banner, (COLS * TILE_SIZE) / 2, CANVAS_H / 2 + 7);
  ctx.textAlign   = 'left';
  ctx.restore();
}

// ─── Pause overlay ────────────────────────────────────────────────────────────
function drawPauseOverlay(ctx) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, COLS * TILE_SIZE, CANVAS_H);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 46px Arial'; ctx.textAlign = 'center';
  ctx.fillText('PAUSED', (COLS * TILE_SIZE) / 2, CANVAS_H / 2 - 10);
  ctx.fillStyle = '#95a5a6'; ctx.font = '15px Arial';
  ctx.fillText('Press  P  or click Resume to continue', (COLS * TILE_SIZE) / 2, CANVAS_H / 2 + 28);
  ctx.textAlign = 'left';
}

// ─── Map selection screen ─────────────────────────────────────────────────────
function drawMenuScreen(ctx, state) {
  ctx.fillStyle = 'rgba(10,10,25,0.90)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 36px Arial';
  ctx.fillText('TOWER DEFENSE', CANVAS_W / 2, 46);
  ctx.fillStyle = '#7f8c8d'; ctx.font = '14px Arial';
  ctx.fillText('Choose a difficulty and map', CANVAS_W / 2, 66);

  // Difficulty selector
  const DIFF_OPTS   = ['Beginner', 'Normal', 'Veteran'];
  const DIFF_COLORS = { Beginner: '#2ecc71', Normal: '#f39c12', Veteran: '#e74c3c' };
  const DIFF_DESC   = { Beginner: 'More gold & lives, weaker enemies', Normal: 'Standard challenge', Veteran: 'Less resources, stronger enemies' };
  const dBtnW = 88, dBtnH = 26, dGap = 10;
  const dRowW = DIFF_OPTS.length * dBtnW + (DIFF_OPTS.length - 1) * dGap;
  const dsx   = (CANVAS_W - dRowW) / 2;
  const dsy   = 76;
  DIFF_OPTS.forEach((d, i) => {
    const bx     = dsx + i * (dBtnW + dGap);
    const active = (state.difficulty || 'Normal') === d;
    const col    = DIFF_COLORS[d];
    btn(ctx, bx, dsy, dBtnW, dBtnH, active ? col + '40' : '#111828', active ? col : '#253050', 5);
    ctx.fillStyle = active ? col : '#7f8c8d';
    ctx.font = `bold ${active ? 12 : 11}px Arial`; ctx.textAlign = 'center';
    ctx.fillText(d, bx + dBtnW / 2, dsy + 17);
  });
  // Show description of active difficulty
  const activeDiff = state.difficulty || 'Normal';
  ctx.fillStyle = DIFF_COLORS[activeDiff] + 'bb'; ctx.font = '10px Arial';
  ctx.fillText(DIFF_DESC[activeDiff], CANVAS_W / 2, dsy + dBtnH + 12);

  // Endless mode toggle
  const eBtnW = 160, eBtnH = 26;
  const ebx   = (CANVAS_W - eBtnW) / 2;
  const eby   = 116;
  const eOn   = !!state.endlessMode;
  btn(ctx, ebx, eby, eBtnW, eBtnH,
    eOn ? '#1a3a2a' : '#111828',
    eOn ? '#2ecc71' : '#2d3d60', 5);
  ctx.fillStyle = eOn ? '#2ecc71' : '#5a6a7a';
  ctx.font = `bold 12px Arial`; ctx.textAlign = 'center';
  ctx.fillText(eOn ? '\u221E  Endless Mode  ON' : '\u221E  Endless Mode  OFF', CANVAS_W / 2, eby + 17);
  if (eOn) {
    ctx.fillStyle = '#55efc4'; ctx.font = '9px Arial';
    ctx.fillText('Waves never end \u2014 enemies scale each tier', CANVAS_W / 2, eby + eBtnH + 10);
  }

  const perRow  = Math.min(4, MAP_CONFIGS.length);
  const cardW   = 210, cardH = 172, gapX = 18, gapY = 14;
  const rowW    = perRow * cardW + (perRow - 1) * gapX;
  const startX  = (CANVAS_W - rowW) / 2;
  const startY  = 164;

  MAP_CONFIGS.forEach((cfg, i) => {
    const col   = i % perRow, row = Math.floor(i / perRow);
    const cx    = startX + col * (cardW + gapX);
    const cy    = startY + row * (cardH + gapY);
    const hover = state.menuHover === i;

    btn(ctx, cx, cy, cardW, cardH,
      hover ? '#1a2a4a' : '#111828',
      hover ? cfg.diffColor : '#253050', 7
    );

    drawMiniMap(ctx, i, cx + 8, cy + 6, cardW - 16, 90);

    ctx.fillStyle = '#ecf0f1'; ctx.font = `bold ${hover ? 15 : 14}px Arial`;
    ctx.fillText(cfg.name, cx + cardW / 2, cy + 108);

    const badgeW = ctx.measureText(cfg.difficulty).width + 16;
    btn(ctx, cx + cardW / 2 - badgeW / 2, cy + 112, badgeW, 17,
      cfg.diffColor + '30', cfg.diffColor, 8);
    ctx.fillStyle = cfg.diffColor; ctx.font = 'bold 10px Arial';
    ctx.fillText(cfg.difficulty, cx + cardW / 2, cy + 124);

    ctx.fillStyle = hover ? '#aab8cc' : '#6a7a8a'; ctx.font = '10px Arial';
    cfg.desc.split('\n').forEach((line, j) => ctx.fillText(line, cx + cardW / 2, cy + 141 + j * 14));

    if (hover) {
      ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 11px Arial';
      ctx.fillText('\u25BA Play', cx + cardW / 2, cy + 165);
    }
  });

  const rows = Math.ceil(MAP_CONFIGS.length / perRow);
  drawLeaderboardPreview(ctx, CANVAS_W / 2, startY + rows * (cardH + gapY) + 20);
  ctx.textAlign = 'left';
}

// ─── Leaderboard preview (menu) ───────────────────────────────────────────────
function drawLeaderboardPreview(ctx, cx, y) {
  ctx.textAlign = 'center';

  // Resume saved game — shown above leaderboard
  if (typeof hasSave === 'function' && hasSave()) {
    const save   = typeof loadSave === 'function' ? loadSave() : null;
    const mapName = save ? (MAP_CONFIGS[save.mapIndex]?.name || 'Saved') : 'Saved';
    const label  = save
      ? `\u25BA Resume  \u2014  ${mapName}  \u2022  Wave ${save.waveIndex + 1}  \u2022  ${save.difficulty}`
      : '\u25BA Resume Saved Game';
    btn(ctx, cx - 180, y, 360, 28, '#1a3a5c', '#2980b9', 5);
    ctx.fillStyle = '#7fc8f8'; ctx.font = 'bold 12px Arial';
    ctx.fillText(label, cx, y + 19);
    y += 40;
  }

  const scores = getScores();
  const endlessScores = getEndlessScores();
  const hasAny = scores.length || endlessScores.length;
  if (!hasAny) return;

  // Regular scores (left column)
  if (scores.length) {
    ctx.fillStyle = '#7f8c8d'; ctx.font = 'bold 12px Arial';
    ctx.fillText('TOP SCORES', cx - (endlessScores.length ? 190 : 0), y);
    scores.slice(0, 5).forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#f1c40f' : '#bdc3c7';
      ctx.font = `${i === 0 ? 'bold ' : ''}11px Arial`;
      ctx.fillText(`${i + 1}. ${s.map}  \u2014  W${s.wave}  \u2014  ${s.kills}k  \u2014  ${s.date}`,
        cx - (endlessScores.length ? 190 : 0), y + 18 + i * 17);
    });
  }

  // Endless scores (right column)
  if (endlessScores.length) {
    ctx.fillStyle = '#2ecc71'; ctx.font = 'bold 12px Arial';
    ctx.fillText('\u221E ENDLESS SCORES', cx + (scores.length ? 190 : 0), y);
    endlessScores.slice(0, 5).forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#2ecc71' : '#7dcea0';
      ctx.font = `${i === 0 ? 'bold ' : ''}11px Arial`;
      const tierTag = s.tier ? ` T${s.tier}` : '';
      ctx.fillText(`${i + 1}. ${s.map}  \u2014  W${s.wave}${tierTag}  \u2014  ${s.kills}k  \u2014  ${s.date}`,
        cx + (scores.length ? 190 : 0), y + 18 + i * 17);
    });
  }
}

// ─── Run stats panel (used inside overlays) ───────────────────────────────────
function drawRunStats(ctx, cx, y, state) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7f8c8d'; ctx.font = 'bold 11px Arial';
  ctx.fillText('THIS RUN', cx, y);

  ctx.fillStyle = '#ecf0f1'; ctx.font = '12px Arial';
  ctx.fillText(`Kills: ${state.killCount}`, cx, y + 18);

  const hardest = (() => {
    if (!state.waveLifeLoss || !state.waveLifeLoss.length) return null;
    let maxLoss = 0, maxWave = 0;
    state.waveLifeLoss.forEach((v, i) => { if (v > maxLoss) { maxLoss = v; maxWave = i + 1; } });
    return maxLoss > 0 ? { wave: maxWave, loss: maxLoss } : null;
  })();

  ctx.fillStyle = '#bdc3c7'; ctx.font = '11px Arial';
  ctx.fillText(`Lives lost: ${state.livesLost || 0}`, cx, y + 34);
  if (hardest) ctx.fillText(`Hardest: Wave ${hardest.wave} (${hardest.loss}\u2665 lost)`, cx, y + 50);

  // Damage-by-tower mini bar chart
  const stats  = state.stats || {};
  const types  = Object.keys(TOWER_DEFS);
  const total  = types.reduce((s, t) => s + (stats[t] || 0), 0);
  if (total > 0) {
    ctx.fillStyle = '#7f8c8d'; ctx.font = 'bold 10px Arial';
    ctx.fillText('DAMAGE DEALT', cx, y + 68);
    const barW = 120, barH = 8, bx = cx - barW / 2;
    let by = y + 76;
    for (const type of types) {
      const dmg = stats[type] || 0;
      if (!dmg) continue;
      const pct   = dmg / total;
      const color = TOWER_DEFS[type].color;
      ctx.fillStyle = '#1e2a45';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, barW * pct, barH);
      ctx.fillStyle = '#aaa'; ctx.font = '9px Arial'; ctx.textAlign = 'left';
      ctx.fillText(`${type} ${Math.round(pct * 100)}%`, bx + barW + 4, by + 7);
      ctx.textAlign = 'center';
      by += barH + 4;
    }
  }
}

// ─── Game Over overlay ────────────────────────────────────────────────────────
function drawGameOver(ctx) {
  const state = window._gameState;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, COLS * TILE_SIZE, CANVAS_H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 48px Arial';
  ctx.fillText('GAME OVER', (COLS * TILE_SIZE) / 2, CANVAS_H / 2 - 108);
  ctx.fillStyle = '#ecf0f1'; ctx.font = '16px Arial';
  ctx.fillText(`Survived ${state.waveIndex} wave${state.waveIndex !== 1 ? 's' : ''}  \u2022  ${state.killCount} kills`,
    (COLS * TILE_SIZE) / 2, CANVAS_H / 2 - 78);

  // Split layout: run stats left, leaderboard right
  drawRunStats(ctx, (COLS * TILE_SIZE) / 4, CANVAS_H / 2 - 58, state);
  drawLeaderboardInOverlay(ctx, (COLS * TILE_SIZE) * 3 / 4, CANVAS_H / 2 - 58);

  const cy = CANVAS_H / 2;
  btn(ctx, (COLS * TILE_SIZE) / 2 - 170, cy + 110, 155, 44, '#1e8449', '#27ae60', 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
  ctx.fillText('RETRY', (COLS * TILE_SIZE) / 2 - 92, cy + 138);

  btn(ctx, (COLS * TILE_SIZE) / 2 + 15, cy + 110, 155, 44, '#1a3a6e', '#2980b9', 6);
  ctx.fillStyle = '#fff';
  ctx.fillText('MENU', (COLS * TILE_SIZE) / 2 + 92, cy + 138);
  ctx.textAlign = 'left';
}

// ─── Victory overlay ──────────────────────────────────────────────────────────
function drawVictory(ctx) {
  const state = window._gameState;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, COLS * TILE_SIZE, CANVAS_H);
  ctx.textAlign = 'center';

  ctx.fillStyle = '#f1c40f'; ctx.font = 'bold 48px Arial';
  ctx.fillText('VICTORY!', (COLS * TILE_SIZE) / 2, CANVAS_H / 2 - 108);
  ctx.fillStyle = '#ecf0f1'; ctx.font = '16px Arial';
  ctx.fillText(`All 20 waves defeated!  \u2022  ${state.killCount} kills  \u2022  ${state.gold}g left`,
    (COLS * TILE_SIZE) / 2, CANVAS_H / 2 - 78);

  drawRunStats(ctx, (COLS * TILE_SIZE) / 4, CANVAS_H / 2 - 58, state);
  drawLeaderboardInOverlay(ctx, (COLS * TILE_SIZE) * 3 / 4, CANVAS_H / 2 - 58);

  const cy = CANVAS_H / 2;
  btn(ctx, (COLS * TILE_SIZE) / 2 - 170, cy + 110, 155, 44, '#1a5276', '#2980b9', 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
  ctx.fillText('PLAY AGAIN', (COLS * TILE_SIZE) / 2 - 92, cy + 138);

  btn(ctx, (COLS * TILE_SIZE) / 2 + 15, cy + 110, 155, 44, '#4a1a6e', '#8e44ad', 6);
  ctx.fillStyle = '#fff';
  ctx.fillText('MENU', (COLS * TILE_SIZE) / 2 + 92, cy + 138);
  ctx.textAlign = 'left';
}

// ─── Leaderboard (overlay) ────────────────────────────────────────────────────
function drawLeaderboardInOverlay(ctx, cx, y) {
  const state   = window._gameState;
  const endless = state && state.endlessMode;
  const scores  = endless ? getEndlessScores() : getScores();
  ctx.textAlign = 'center';
  ctx.fillStyle = endless ? '#2ecc71' : '#7f8c8d';
  ctx.font = 'bold 12px Arial';
  ctx.fillText(endless ? '\u221E ENDLESS SCORES' : 'TOP SCORES', cx, y + 5);
  if (!scores.length) {
    ctx.fillStyle = '#555'; ctx.font = '11px Arial';
    ctx.fillText('No scores yet.', cx, y + 24);
    return;
  }
  scores.slice(0, 5).forEach((s, i) => {
    ctx.fillStyle = i === 0 ? (endless ? '#2ecc71' : '#f1c40f') : '#9a9a9a';
    ctx.font = `${i === 0 ? 'bold ' : ''}11px Arial`;
    const tierTag = endless && s.tier ? ` T${s.tier}` : '';
    ctx.fillText(`${i + 1}. ${s.map}  \u2014  Wave ${s.wave}${tierTag}  \u2014  ${s.kills} kills  \u2014  ${s.date}`,
      cx, y + 22 + i * 16);
  });
}

// ─── Boss HP bar ──────────────────────────────────────────────────────────────
function drawBossHPBar(ctx, state) {
  if (state.phase !== 'fight') return;
  const boss = state.enemies.find(e => e.alive && e.type === 'Boss');
  if (!boss) return;

  const bw = 300, bh = 14;
  const bx = (COLS * TILE_SIZE - bw) / 2;
  const by = 8;
  const pct = Math.max(0, boss.displayHp / boss.maxHp);

  // Background pill
  ctx.save();
  roundRect(ctx, bx - 36, by - 4, bw + 72, bh + 24, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fill();

  // Label
  ctx.fillStyle = '#e74c3c';
  ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
  ctx.fillText('\u2620  BOSS', COLS * TILE_SIZE / 2, by + 9);

  // Bar track
  ctx.fillStyle = '#2d1a1a';
  roundRect(ctx, bx, by + 13, bw, bh, 3);
  ctx.fill();

  // Bar fill
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#7b241c');
  grad.addColorStop(pct * 0.5, '#e74c3c');
  grad.addColorStop(pct, '#ff6b6b');
  ctx.fillStyle = grad;
  roundRect(ctx, bx, by + 13, bw * pct, bh, 3);
  ctx.fill();

  // Bar border
  ctx.strokeStyle = '#7b241c'; ctx.lineWidth = 1;
  roundRect(ctx, bx, by + 13, bw, bh, 3);
  ctx.stroke();

  // HP numbers
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '9px Arial';
  ctx.fillText(`${Math.ceil(boss.displayHp).toLocaleString()} / ${boss.maxHp.toLocaleString()}`, COLS * TILE_SIZE / 2, by + 24);

  ctx.restore();
}

// ─── Danger border vignette ───────────────────────────────────────────────────
function drawDangerBorder(ctx, state) {
  if (state.lives > 5) return;
  if (state.phase === 'menu' || state.phase === 'gameover' || state.phase === 'victory') return;

  const pulse = 0.28 + 0.22 * Math.sin(Date.now() / 220);
  const gw = COLS * TILE_SIZE, gh = CANVAS_H;
  const thick = 72;

  ctx.save();
  ctx.globalAlpha = pulse;

  const top = ctx.createLinearGradient(0, 0, 0, thick);
  top.addColorStop(0, '#c0392b'); top.addColorStop(1, 'transparent');
  ctx.fillStyle = top; ctx.fillRect(0, 0, gw, thick);

  const bot = ctx.createLinearGradient(0, gh - thick, 0, gh);
  bot.addColorStop(0, 'transparent'); bot.addColorStop(1, '#c0392b');
  ctx.fillStyle = bot; ctx.fillRect(0, gh - thick, gw, thick);

  const lft = ctx.createLinearGradient(0, 0, thick, 0);
  lft.addColorStop(0, '#c0392b'); lft.addColorStop(1, 'transparent');
  ctx.fillStyle = lft; ctx.fillRect(0, 0, thick, gh);

  const rgt = ctx.createLinearGradient(gw - thick, 0, gw, 0);
  rgt.addColorStop(0, 'transparent'); rgt.addColorStop(1, '#c0392b');
  ctx.fillStyle = rgt; ctx.fillRect(gw - thick, 0, thick, gh);

  ctx.restore();
}

// ─── Leaderboard storage ──────────────────────────────────────────────────────
function saveScore(state) {
  let scores = getScores();
  scores.push({
    map:   MAP_CONFIGS[state.mapIndex].name,
    wave:  state.waveIndex,
    kills: state.killCount,
    date:  new Date().toLocaleDateString(),
  });
  scores.sort((a, b) => b.wave - a.wave || b.kills - a.kills);
  localStorage.setItem('td_leaderboard', JSON.stringify(scores.slice(0, 10)));
}

function getScores() {
  try { return JSON.parse(localStorage.getItem('td_leaderboard') || '[]'); }
  catch { return []; }
}

function saveEndlessScore(state) {
  const tier = state.waveIndex >= WAVES.length ? state.waveIndex - WAVES.length + 1 : 0;
  let scores  = getEndlessScores();
  scores.push({
    map:   MAP_CONFIGS[state.mapIndex].name,
    wave:  state.waveIndex,
    tier,
    kills: state.killCount,
    date:  new Date().toLocaleDateString(),
  });
  scores.sort((a, b) => b.wave - a.wave || b.kills - a.kills);
  localStorage.setItem('td_endless_lb', JSON.stringify(scores.slice(0, 10)));
}

function getEndlessScores() {
  try { return JSON.parse(localStorage.getItem('td_endless_lb') || '[]'); }
  catch { return []; }
}
