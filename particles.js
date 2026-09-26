class Particle {
  constructor(x, y, vx, vy, color, radius, life) {
    this.x       = x;
    this.y       = y;
    this.vx      = vx;
    this.vy      = vy;
    this.color   = color;
    this.radius  = radius;
    this.life    = life;
    this.maxLife = life;
  }

  update(dt) {
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.vy += 120 * dt; // gravity
    this.vx *= 0.98;
    this.life -= dt;
  }

  draw(ctx) {
    const a = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = a * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0.5, this.radius * a), 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.restore();
  }
}

function rand(min, max) { return min + Math.random() * (max - min); }

// ─── Victory confetti burst ───────────────────────────────────────────────────
function spawnVictoryParticles() {
  const colors = ['#f1c40f','#2ecc71','#3498db','#9b59b6','#e74c3c','#fd79a8','#e67e22','#1abc9c','#fff'];
  const gw = COLS * TILE_SIZE;
  const out = [];
  for (let i = 0; i < 110; i++) {
    const x   = rand(gw * 0.05, gw * 0.95);
    const y   = rand(0, CANVAS_H * 0.5);
    const spd = rand(90, 260);
    const ang = rand(-Math.PI * 0.9, -Math.PI * 0.1); // upward fan
    const col = colors[Math.floor(Math.random() * colors.length)];
    out.push(new Particle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, col, rand(3, 6.5), rand(1.8, 3.8)));
  }
  return out;
}

// ─── Enemy-type-specific death particles ──────────────────────────────────────
function spawnDeathParticles(x, y, color, enemyType) {
  if (enemyType === 'Boss') return spawnBossDeathParticles(x, y);

  const cfgs = {
    Scout:   { count: 12, speed: 105, life: 0.50, radius: 3,   colors: ['#e74c3c', '#ff7675', '#fdcb6e'] },
    Soldier: { count: 15, speed: 85,  life: 0.65, radius: 4,   colors: ['#c0392b', '#922b21', '#e74c3c'] },
    Tank:    { count: 18, speed: 65,  life: 0.80, radius: 5,   colors: ['#7f8c8d', '#b2bec3', '#636e72'] },
    Speeder: { count: 10, speed: 145, life: 0.42, radius: 3,   colors: ['#f39c12', '#fdcb6e', '#e17055'] },
    Healer:  { count: 14, speed: 75,  life: 0.68, radius: 3,   colors: ['#2ecc71', '#55efc4', '#00b894'] },
  };
  const cfg = cfgs[enemyType] || { count: 10, speed: 90, life: 0.55, radius: 3, colors: [color] };

  const out = [];

  // Main burst
  for (let i = 0; i < cfg.count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = rand(cfg.speed * 0.4, cfg.speed);
    const col   = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
    out.push(new Particle(
      x + rand(-5, 5), y + rand(-5, 5),
      Math.cos(angle) * spd,
      Math.sin(angle) * spd - rand(20, 60),
      col, cfg.radius + rand(-1, 1.5), rand(cfg.life * 0.6, cfg.life)
    ));
  }

  // White flash sparks
  for (let i = 0; i < 4; i++) {
    const angle = Math.random() * Math.PI * 2;
    out.push(new Particle(
      x, y,
      Math.cos(angle) * rand(30, 80),
      Math.sin(angle) * rand(30, 80) - 20,
      '#ffffff', 2, rand(0.2, 0.4)
    ));
  }

  // Tank: slow heavy debris chunks
  if (enemyType === 'Tank') {
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      out.push(new Particle(
        x + rand(-8, 8), y + rand(-8, 8),
        Math.cos(angle) * rand(20, 50),
        Math.sin(angle) * rand(20, 50) - 25,
        '#636e72', rand(6, 10), rand(0.9, 1.2)
      ));
    }
  }

  // Speeder: fast directional streaks
  if (enemyType === 'Speeder') {
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      out.push(new Particle(
        x, y,
        Math.cos(angle) * rand(160, 240),
        Math.sin(angle) * rand(160, 240) - 10,
        '#fdcb6e', 2, rand(0.18, 0.32)
      ));
    }
  }

  // Healer: green sparkles that float upward
  if (enemyType === 'Healer') {
    for (let i = 0; i < 7; i++) {
      out.push(new Particle(
        x + rand(-12, 12), y + rand(-12, 12),
        rand(-30, 30),
        rand(-100, -50),
        '#00b894', rand(2, 4), rand(0.7, 1.1)
      ));
    }
  }

  return out;
}

// ─── Boss death — dramatic multi-burst ───────────────────────────────────────
function spawnBossDeathParticles(x, y) {
  const colors = ['#8e44ad', '#9b59b6', '#f1c40f', '#ffffff', '#e74c3c', '#fd79a8', '#a29bfe'];
  const out    = [];

  // Main burst — 55 particles
  for (let i = 0; i < 55; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = rand(80, 300);
    const col   = colors[Math.floor(Math.random() * colors.length)];
    out.push(new Particle(
      x + rand(-12, 12), y + rand(-12, 12),
      Math.cos(angle) * spd,
      Math.sin(angle) * spd - rand(20, 80),
      col, rand(4, 11), rand(0.8, 1.7)
    ));
  }

  // Evenly-spaced gold ring — 24 particles
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const spd   = rand(190, 270);
    out.push(new Particle(
      x, y,
      Math.cos(angle) * spd,
      Math.sin(angle) * spd,
      '#f1c40f', rand(5, 9), rand(1.0, 1.5)
    ));
  }

  // Large purple smoke clouds
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    out.push(new Particle(
      x + rand(-18, 18), y + rand(-18, 18),
      Math.cos(angle) * rand(12, 45),
      Math.sin(angle) * rand(12, 45) - 55,
      'rgba(60,0,80,0.82)', rand(9, 16), rand(1.2, 2.0)
    ));
  }

  // White flash sparks — fast, short-lived
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    out.push(new Particle(
      x, y,
      Math.cos(angle) * rand(70, 160),
      Math.sin(angle) * rand(70, 160) - 30,
      '#ffffff', rand(3, 7), rand(0.18, 0.42)
    ));
  }

  return out;
}

// ─── Cannon AOE explosion ─────────────────────────────────────────────────────
function spawnExplosionParticles(x, y) {
  const colors = ['#e67e22', '#e74c3c', '#f39c12', '#ffeaa7', '#fff'];
  const out    = [];
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = rand(70, 180);
    out.push(new Particle(
      x + rand(-10, 10), y + rand(-10, 10),
      Math.cos(angle) * spd,
      Math.sin(angle) * spd - rand(30, 80),
      colors[Math.floor(Math.random() * colors.length)],
      rand(2, 5), rand(0.5, 0.85)
    ));
  }
  // Smoke
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    out.push(new Particle(
      x + rand(-8, 8), y + rand(-8, 8),
      Math.cos(angle) * rand(20, 50),
      Math.sin(angle) * rand(20, 50) - 40,
      'rgba(80,80,80,0.8)', rand(4, 8), rand(0.6, 1.0)
    ));
  }
  return out;
}

// ─── Ambient map particles (dust + fireflies) ────────────────────────────────
class AmbientParticle {
  constructor(randomAge) { this._init(randomAge); }

  _init(randomAge) {
    // Prefer grass tiles (up to 8 tries)
    let col, row, tries = 0;
    do {
      col = Math.floor(Math.random() * COLS);
      row = Math.floor(Math.random() * ROWS);
    } while (isPathTile(col, row) && ++tries < 8);

    this.x       = (col + Math.random()) * TILE_SIZE;
    this.y       = (row + Math.random()) * TILE_SIZE;
    this.vx      = (Math.random() - 0.5) * 11;
    this.vy      = -rand(4, 13);
    this.maxAge  = rand(2.8, 5.5);
    this.age     = randomAge ? Math.random() * this.maxAge : 0;
    this.r       = rand(1.0, 2.2);
    this.firefly = Math.random() < 0.22;
    this.phase   = Math.random() * Math.PI * 2;
    this.color   = this.firefly
      ? (Math.random() < 0.55 ? '#f1c40f' : '#a8ffce')
      : `rgb(${200 + Math.round(Math.random() * 35)},${182 + Math.round(Math.random() * 28)},${120 + Math.round(Math.random() * 35)})`;
  }

  update(dt) {
    this.age += dt;
    this.x   += this.vx * dt;
    this.y   += this.vy * dt;
    this.vx  += (Math.random() - 0.5) * 0.6;
    this.vx  *= 0.97;
    if (this.age >= this.maxAge) this._init(false);
  }

  draw(ctx) {
    const t     = this.age / this.maxAge;
    const fade  = Math.min(t / 0.12, 1, (1 - t) / 0.12);
    const pulse = this.firefly ? 0.4 * Math.sin(this.age * 3.5 + this.phase) : 0;
    const alpha = fade * ((this.firefly ? 0.55 : 0.28) + pulse);
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    if (this.firefly && alpha > 0.25) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 2.8, 0, Math.PI * 2);
      ctx.fillStyle = this.color + '28';
      ctx.fill();
    }
    ctx.restore();
  }
}

function makeAmbientParticles(count = 58) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(new AmbientParticle(true));
  return arr;
}

// ─── Enemy spawn ripple (expanding ring at START tile) ────────────────────────
class SpawnRipple {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.life = 0.52; this.maxLife = 0.52;
  }
  update(dt) { this.life -= dt; }
  get alive()  { return this.life > 0; }
  draw(ctx) {
    const t = 1 - this.life / this.maxLife;   // 0 → 1
    const r = t * TILE_SIZE * 1.25;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.72;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Enemy birth flash particles ──────────────────────────────────────────────
function spawnEnemyBirthParticles(x, y, color) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const spd   = rand(40, 75);
    out.push(new Particle(x, y,
      Math.cos(angle) * spd, Math.sin(angle) * spd,
      color, rand(2, 3.5), rand(0.22, 0.42)
    ));
  }
  // Centre white flash dot
  out.push(new Particle(x, y, 0, -8, '#ffffff', TILE_SIZE / 9, 0.20));
  return out;
}

// ─── Tower placement sparkle ──────────────────────────────────────────────────
function spawnPlacementParticles(col, row) {
  const cx  = col * TILE_SIZE + TILE_SIZE / 2;
  const cy  = row * TILE_SIZE + TILE_SIZE / 2;
  const out = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    out.push(new Particle(
      cx, cy,
      Math.cos(angle) * rand(35, 70),
      Math.sin(angle) * rand(35, 70) - 20,
      '#f1c40f', rand(2, 4), rand(0.3, 0.55)
    ));
  }
  return out;
}
