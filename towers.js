const TOWER_DEFS = {
  // Basic: reliable all-rounder, slightly buffed damage
  Basic:  { cost: 50,  damage: 25, fireRate: 1.0,  range: 2.2, color: '#3498db', projColor: '#2980b9', aoe: 0,   slow: 0,   projSpeed: 220, label: 'B',  desc: 'Balanced. Single target.',    hint: 'Great all-rounder. Place near bends so it hits enemies multiple times.' },
  // Sniper: best per-shot damage, unchanged
  Sniper: { cost: 100, damage: 85, fireRate: 0.5,  range: 4.0, color: '#2c3e50', projColor: '#bdc3c7', aoe: 0,   slow: 0,   projSpeed: 500, label: 'Sn', desc: 'Long range. High damage.',     hint: 'Best vs high-HP enemies. Place far back — it reaches the whole map.' },
  // Cannon: slightly wider AOE radius, best vs crowds/tanks
  Cannon: { cost: 125, damage: 50, fireRate: 0.75, range: 2.5, color: '#e67e22', projColor: '#d35400', aoe: 1.1, slow: 0,   projSpeed: 200, label: 'C',  desc: 'Area damage on impact.',      hint: 'Shreds groups and Tanks. Place on straight lanes where enemies clump.' },
  // Freeze: slow duration trimmed so it's support, not dominant
  Freeze: { cost: 75,  damage: 5,  fireRate: 1.5,  range: 2.0, color: '#74b9ff', projColor: '#0984e3', aoe: 0,   slow: 0.5, projSpeed: 220, label: 'F',  desc: 'Slows enemies 50%.',          hint: 'Pair with Cannon or Sniper — slowed enemies take far more damage.' },
  // Rapid: DPS nerfed slightly (8 × 4 = 32 vs old 10 × 4 = 40)
  Rapid:  { cost: 80,  damage: 8,  fireRate: 4.0,  range: 1.5, color: '#fd79a8', projColor: '#e84393', aoe: 0,   slow: 0,   projSpeed: 260, label: 'R',  desc: 'Fast fire rate. Short range.', hint: 'Melts Scouts and Speeders quickly. Weak vs Tanks — use Cannon nearby.' },
  // Laser: continuous piercing beam hitting all enemies in a line
  Laser:  { cost: 110, damage: 30, fireRate: 0,    range: 3.0, color: '#a29bfe', projColor: '#a29bfe', aoe: 0,   slow: 0,   projSpeed: 0,   label: 'Lz', desc: 'Piercing beam. All in line.',  hint: 'Damages every enemy in its path at once. Strongest on long straight lanes.' },
  // Tesla: chain lightning — hits one target, arcs to nearby enemies
  Tesla:  { cost: 100, damage: 40, fireRate: 0.8,  range: 2.5, color: '#00cec9', projColor: '#00cec9', aoe: 0,   slow: 0,   projSpeed: 0,   label: 'Tz', desc: 'Chain lightning. Hits groups.', hint: 'Lightning chains to 3 nearby enemies with decaying damage. Best vs clumps.' },
};

const UPGRADE_MULTS = [
  { dmg: 1.0, range: 1.0  }, // level 1 (base)
  { dmg: 1.5, range: 1.25 }, // level 2
  { dmg: 2.0, range: 1.5  }, // level 3
];

// ─── Floating damage numbers ─────────────────────────────────────────────────
class FloatingText {
  constructor(x, y, text, color) {
    this.x     = x + (Math.random() - 0.5) * 10;
    this.y     = y;
    this.text  = String(text);
    this.color = color;
    this.life  = 1.0;
    this.vy    = -55;
  }

  update(dt) {
    this.life -= dt * 1.2;
    this.y    += this.vy * dt;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle   = this.color;
    ctx.font        = `bold ${Math.round(13 * _TS)}px Arial`;
    ctx.textAlign   = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

// Trail length and style per tower type
const TRAIL_CONFIG = {
  Basic:  { len: 6,  style: 'dots' },
  Sniper: { len: 16, style: 'line' },
  Cannon: { len: 4,  style: 'dots' },
  Freeze: { len: 8,  style: 'dots' },
  Rapid:  { len: 4,  style: 'dots' },
};

// Scale factor relative to the baseline tile size of 48px
const _TS = TILE_SIZE / 48;

const TESLA_CHAIN_MULTS = [0.6, 0.35, 0.2]; // damage decay per chain hop

// ─── Projectile ───────────────────────────────────────────────────────────────
class Projectile {
  constructor(x, y, target, damage, speed, color, aoe, slow, source, sourceTower = null) {
    this.x           = x;
    this.y           = y;
    this.target      = target;
    this.damage      = damage;
    this.speed       = speed;
    this.color       = color;
    this.aoe         = aoe;
    this.slow        = slow;
    this.source      = source;
    this.sourceTower = sourceTower;
    this.alive  = true;
    this.size   = aoe > 0 ? 7 * _TS : 4 * _TS;
    const tc    = TRAIL_CONFIG[source] || { len: 5, style: 'dots' };
    this.trailMax   = tc.len;
    this.trailStyle = tc.style;
    this.trail      = [];
  }

  update(dt, enemies, floatingTexts, particles) {
    if (!this.alive) return;

    // Record trail position before moving
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.trailMax) this.trail.shift();

    if (!this.target.alive && this.aoe === 0) { this.alive = false; return; }

    const tx   = this.target.alive ? this.target.x : this.x;
    const ty   = this.target.alive ? this.target.y : this.y;
    const dx   = tx - this.x;
    const dy   = ty - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const move = this.speed * dt;

    if (dist <= move + this.size) {
      if (this.aoe > 0) {
        if (particles) particles.push(...spawnExplosionParticles(tx, ty));
        const aoeRange = this.aoe * TILE_SIZE;
        for (const e of enemies) {
          if (!e.alive) continue;
          const ex = e.x - tx, ey = e.y - ty;
          if (Math.sqrt(ex * ex + ey * ey) <= aoeRange) {
            e.lastHitTower = this.sourceTower;
            const dmg = e.takeDamage(this.damage, this.source);
            if (this.sourceTower) this.sourceTower.totalDamage += dmg;
            floatingTexts.push(new FloatingText(e.x, e.y, Math.round(dmg), '#e67e22'));
          }
        }
      } else if (this.target.alive) {
        this.target.lastHitTower = this.sourceTower;
        const dmg = this.target.takeDamage(this.damage, this.source);
        if (this.sourceTower) this.sourceTower.totalDamage += dmg;
        floatingTexts.push(new FloatingText(this.target.x, this.target.y, Math.round(dmg), '#fff'));
        if (this.slow > 0) this.target.applySlow(this.slow, 1.5);
      }
      this.alive = false;
    } else {
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }
  }

  draw(ctx) {
    if (this.trail.length > 1) {
      if (this.trailStyle === 'line') {
        // Sniper: single streak line
        ctx.beginPath();
        ctx.moveTo(this.trail[0].x, this.trail[0].y);
        for (const pt of this.trail) ctx.lineTo(pt.x, pt.y);
        ctx.lineTo(this.x, this.y);
        ctx.strokeStyle = this.color + '99';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      } else {
        // Other types: fading dot trail
        for (let i = 0; i < this.trail.length; i++) {
          const t     = i / this.trail.length;
          const alpha = t * 0.55;
          const r     = this.size * (0.3 + t * 0.55);
          ctx.beginPath();
          ctx.arc(this.trail[i].x, this.trail[i].y, r, 0, Math.PI * 2);
          ctx.fillStyle = this.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
      }
    }

    // Main projectile
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    // Bright core
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
  }
}

// ─── Tower ────────────────────────────────────────────────────────────────────
class Tower {
  constructor(type, col, row) {
    const def       = TOWER_DEFS[type];
    this.type       = type;
    this.col        = col;
    this.row        = row;
    this.x          = col * TILE_SIZE + TILE_SIZE / 2;
    this.y          = row * TILE_SIZE + TILE_SIZE / 2;
    this.level      = 1;
    this.baseDmg    = def.damage;
    this.baseRange  = def.range;
    this.fireRate   = def.fireRate;
    this.color      = def.color;
    this.projColor  = def.projColor;
    this.projSpeed  = def.projSpeed;
    this.aoe        = def.aoe;
    this.slow       = def.slow;
    this.label      = def.label;
    this.cost       = def.cost;
    this.invested   = def.cost;
    this.priority    = 'first';
    this.totalDamage = 0;
    this.killCount   = 0;
    this.cooldown    = 0;
    this.beamActive  = false;   // Laser only
    this.chainPoints = [];      // Tesla only — [{x,y},...] for lightning visual
    this.chainTimer  = 0;       // Tesla only — visual duration countdown
    this.angle      = 0;          // barrel/aim direction (radians)
    this.flashTimer = 0;          // firing flash countdown
    this.recoilAnim = 0;          // barrel recoil timer (seconds)
    this.spinAngle  = 0;          // for Rapid spin / Freeze crystal rotation
    this.placementAnim = 0.38;  // bounce-in timer (seconds)
  }

  get damage() { return this.baseDmg   * UPGRADE_MULTS[this.level - 1].dmg;   }
  get range()  { return this.baseRange * UPGRADE_MULTS[this.level - 1].range * TILE_SIZE; }

  get upgradeCost() {
    if (this.level >= 3) return null;
    return this.level === 1
      ? Math.round(this.cost * 0.5)
      : this.cost;
  }

  get sellValue() { return Math.round(this.invested * 0.6); }

  findTarget(enemies) {
    const inRange = enemies.filter(e => {
      if (!e.alive) return false;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      return Math.sqrt(dx * dx + dy * dy) <= this.range;
    });
    if (!inRange.length) return null;
    switch (this.priority) {
      case 'first':    return inRange.reduce((a, b) => a.progress > b.progress ? a : b);
      case 'last':     return inRange.reduce((a, b) => a.progress < b.progress ? a : b);
      case 'strongest':return inRange.reduce((a, b) => a.hp > b.hp ? a : b);
      case 'weakest':  return inRange.reduce((a, b) => a.hp < b.hp ? a : b);
    }
    return inRange[0];
  }

  update(dt, enemies, projectiles, floatingTexts = null) {
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.recoilAnim  > 0) this.recoilAnim  = Math.max(0, this.recoilAnim  - dt);
    if (this.chainTimer  > 0) this.chainTimer  -= dt;
    if (this.placementAnim > 0) this.placementAnim = Math.max(0, this.placementAnim - dt);
    // Spin speed varies by type
    const spinRates = { Rapid: 6, Laser: 1.4, Tesla: 2.0 };
    this.spinAngle += dt * (spinRates[this.type] || 0.6);

    // ── Laser: continuous piercing beam ───────────────────────────────────────
    if (this.type === 'Laser') {
      const target = this.findTarget(enemies);
      if (!target) { this.beamActive = false; return; }
      this.angle      = Math.atan2(target.y - this.y, target.x - this.x);
      this.beamActive = true;
      const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.x - this.x, dy = e.y - this.y;
        const dot  = dx * cos + dy * sin;           // projection along beam
        if (dot < 0 || dot > this.range) continue;  // behind tower or out of range
        const perp = Math.abs(dx * sin - dy * cos); // perpendicular distance
        if (perp <= e.radius + 2 * _TS) {
          e.lastHitTower = this;
          const dmg = e.takeDamage(this.damage * dt, this.type);
          this.totalDamage += dmg;
        }
      }
      return;
    }

    // ── Tesla: chain lightning burst ─────────────────────────────────────────
    if (this.type === 'Tesla') {
      this.cooldown -= dt;
      const target = this.findTarget(enemies);
      if (target) this.angle = Math.atan2(target.y - this.y, target.x - this.x);
      if (this.cooldown > 0 || !target) return;

      // Primary hit
      target.lastHitTower = this;
      const dmg = target.takeDamage(this.damage, this.type);
      this.totalDamage += dmg;
      if (floatingTexts) floatingTexts.push(new FloatingText(target.x, target.y, Math.round(dmg), '#00cec9'));

      // Chain to up to 3 nearby enemies
      const chain     = [{ x: target.x, y: target.y }];
      let lastX       = target.x, lastY = target.y;
      const chainRng  = 1.5 * TILE_SIZE;
      const hit       = new Set([target]);
      const chainMult = TESLA_CHAIN_MULTS;

      for (let c = 0; c < 3; c++) {
        let best = null, bestDist = chainRng;
        for (const e of enemies) {
          if (!e.alive || hit.has(e)) continue;
          const d = Math.hypot(e.x - lastX, e.y - lastY);
          if (d < bestDist) { best = e; bestDist = d; }
        }
        if (!best) break;
        hit.add(best);
        best.lastHitTower = this;
        const cdmg = best.takeDamage(this.damage * chainMult[c], this.type);
        this.totalDamage += cdmg;
        if (floatingTexts) floatingTexts.push(new FloatingText(best.x, best.y, Math.round(cdmg), '#81ecec'));
        chain.push({ x: best.x, y: best.y });
        lastX = best.x; lastY = best.y;
      }

      this.chainPoints = [{ x: this.x, y: this.y }, ...chain];
      this.chainTimer  = 0.18;
      this.cooldown    = 1 / this.fireRate;
      this.flashTimer  = 0.08;
      return;
    }

    // ── Standard projectile towers ────────────────────────────────────────────
    this.cooldown  -= dt;
    const target = this.findTarget(enemies);
    if (target) this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    if (this.cooldown > 0 || !target) return;

    projectiles.push(new Projectile(
      this.x, this.y, target,
      this.damage, this.projSpeed, this.projColor,
      this.aoe, this.slow, this.type, this
    ));
    this.cooldown   = 1 / this.fireRate;
    this.flashTimer = 0.08;
    this.recoilAnim = 0.12;
  }

  upgrade() {
    if (this.level >= 3) return 0;
    const cost = this.upgradeCost;
    this.level++;
    this.invested += cost;
    return cost;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  _basePlate(ctx) {
    const h = TILE_SIZE / 2;
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(this.x - h, this.y - h, TILE_SIZE, TILE_SIZE);
  }

  _levelRing(ctx) {
    if (this.level < 2) return;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 21 * _TS, 0, Math.PI * 2);
    ctx.strokeStyle = this.level === 3 ? '#f1c40f' : this.color + 'cc';
    ctx.lineWidth   = this.level === 3 ? 2 : 1.5;
    ctx.stroke();
  }

  _levelDots(ctx) {
    const half = TILE_SIZE / 2;
    for (let i = 0; i < this.level; i++) {
      ctx.beginPath();
      ctx.arc(this.x + (-5 + i * 5) * _TS, this.y + half - 7 * _TS, 2.5 * _TS, 0, Math.PI * 2);
      ctx.fillStyle = this.level === 3 ? '#f1c40f' : '#c0a030';
      ctx.fill();
    }
  }

  // ── Basic: circle turret + rotating barrel ────────────────────────────────
  _drawBasic(ctx) {
    const lv = this.level;
    this._basePlate(ctx);
    // Barrel (draw first so body sits on top)
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.recoilAnim > 0) ctx.translate(-(this.recoilAnim / 0.12) * 5 * _TS, 0);
    const bLen = (16 + lv * 2) * _TS, bW = (6 + lv) * _TS;
    ctx.fillStyle = lv === 3 ? '#d4ac0d' : '#2471a3';
    ctx.fillRect(0, -bW / 2, bLen, bW);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#5dade2';
    ctx.fillRect(bLen - 5 * _TS, -bW / 2 - _TS, 5 * _TS, bW + 2 * _TS);
    ctx.restore();
    // Body circle
    const bodyR = (10 + lv) * _TS;
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#1a6fa5' : lv === 2 ? '#2980b9' : '#1f618d';
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : lv === 2 ? '#74b9ff' : '#2980b9';
    ctx.lineWidth = lv === 1 ? 1.5 : 2;
    ctx.stroke();
    // Turret cap
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#5dade2';
    ctx.fill();
    this._levelDots(ctx);
  }

  // ── Sniper: narrow body + very long thin barrel ───────────────────────────
  _drawSniper(ctx) {
    const lv = this.level;
    this._basePlate(ctx);
    // Long thin barrel
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.recoilAnim > 0) ctx.translate(-(this.recoilAnim / 0.12) * 7 * _TS, 0);
    const bLen = (24 + lv * 2) * _TS, bW = (3 + (lv > 1 ? 1 : 0)) * _TS;
    ctx.fillStyle = lv === 3 ? '#d4ac0d' : '#7f8c8d';
    ctx.fillRect(-4 * _TS, -bW / 2, bLen + 4 * _TS, bW);
    // Muzzle break / tip
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#bdc3c7';
    ctx.fillRect(bLen - 2 * _TS, -bW - _TS, 4 * _TS, bW * 2 + 2 * _TS);
    // Scope
    if (lv >= 2) {
      ctx.fillStyle = '#2d3436';
      ctx.fillRect(4 * _TS, -5 * _TS, 10 * _TS, 10 * _TS);
      ctx.beginPath();
      ctx.arc(9 * _TS, 0, 3 * _TS, 0, Math.PI * 2);
      ctx.fillStyle = '#dfe6e9';
      ctx.fill();
    }
    ctx.restore();
    // Narrow body
    const bh = (22 + lv * 2) * _TS, bw = (8 + lv) * _TS;
    ctx.fillStyle = lv === 3 ? '#2c3e50' : '#1c2833';
    ctx.fillRect(this.x - bw / 2, this.y - bh / 2, bw, bh);
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : lv === 2 ? '#95a5a6' : '#7f8c8d';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(this.x - bw / 2, this.y - bh / 2, bw, bh);
    this._levelRing(ctx);
    this._levelDots(ctx);
  }

  // ── Cannon: heavy round body + fat rotating barrel ────────────────────────
  _drawCannon(ctx) {
    const lv = this.level;
    this._basePlate(ctx);
    // Heavy base ring
    ctx.beginPath();
    ctx.arc(this.x, this.y, 18 * _TS, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1015';
    ctx.fill();
    // Fat barrel
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.recoilAnim > 0) ctx.translate(-(this.recoilAnim / 0.12) * 6 * _TS, 0);
    const bLen = (16 + lv) * _TS, bW = (9 + lv) * _TS;
    ctx.fillStyle = lv === 3 ? '#9a6800' : '#784212';
    ctx.fillRect(-2 * _TS, -bW / 2, bLen + 2 * _TS, bW);
    ctx.fillStyle = lv === 3 ? '#d4ac0d' : '#e67e22';
    ctx.fillRect(bLen - 5 * _TS, -bW / 2 - 2 * _TS, 5 * _TS, bW + 4 * _TS);
    ctx.restore();
    // Round body
    const bodyR = (12 + lv) * _TS;
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#ca6f1e' : lv === 2 ? '#d35400' : '#a04000';
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : lv === 2 ? '#f39c12' : '#e67e22';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Rivet ring
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = lv === 3 ? '#f1c40f55' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    this._levelDots(ctx);
  }

  // ── Freeze: rotating crystal / gem ────────────────────────────────────────
  _drawFreeze(ctx) {
    const lv = this.level;
    const angle = this.spinAngle;
    this._basePlate(ctx);
    // Crystal glow
    ctx.beginPath();
    ctx.arc(this.x, this.y, 18 * _TS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(116,185,255,${0.08 + 0.04 * Math.sin(angle * 2)})`;
    ctx.fill();
    // Star / crystal shape (6 + 2*lv points at alternating radii)
    const pts = 6 + (lv - 1) * 2;
    const outerR = (14 + lv) * _TS, innerR = (6 + lv) * _TS;
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const r   = i % 2 === 0 ? outerR : innerR;
      const a   = (i * Math.PI / pts) + angle;
      const px  = this.x + r * Math.cos(a);
      const py  = this.y + r * Math.sin(a);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = lv === 3 ? '#a8daff' : lv === 2 ? '#74b9ff' : '#0984e3';
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : '#dfe6e9';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    // Inner gem
    ctx.beginPath();
    ctx.arc(this.x, this.y, innerR * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#dfe6e9';
    ctx.fill();
    this._levelDots(ctx);
  }

  // ── Rapid: small body + fan of spinning barrels ───────────────────────────
  _drawRapid(ctx) {
    const lv       = this.level;
    const nBarrels = lv + 2;   // L1: 3, L2: 4, L3: 5
    const spread   = 0.28;
    this._basePlate(ctx);
    // Barrels (rotating fan)
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle + this.spinAngle * 0.15);
    if (this.recoilAnim > 0) ctx.translate(-(this.recoilAnim / 0.12) * 3 * _TS, 0);
    for (let i = 0; i < nBarrels; i++) {
      const offset = (i - (nBarrels - 1) / 2) * spread;
      ctx.save();
      ctx.rotate(offset);
      ctx.fillStyle = lv === 3 ? '#d4006a' : '#c0006a';
      ctx.fillRect(2 * _TS, -2 * _TS, (18 + lv) * _TS, 4 * _TS);
      ctx.fillStyle = lv === 3 ? '#f1c40f' : '#fd79a8';
      ctx.fillRect((18 + lv) * _TS, -3 * _TS, 4 * _TS, 6 * _TS);
      ctx.restore();
    }
    ctx.restore();
    // Small body circle
    const bodyR = (7 + lv) * _TS;
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#c0006a' : lv === 2 ? '#d63031' : '#9b0059';
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : '#fd79a8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this._levelRing(ctx);
    this._levelDots(ctx);
  }

  // ── Laser: rotating prism arms + central emitter ─────────────────────────
  _drawLaser(ctx) {
    const lv    = this.level;
    const angle = this.spinAngle;
    this._basePlate(ctx);

    // Ambient glow ring
    const pulse = 0.7 + 0.3 * Math.sin(angle * 2.5);
    ctx.beginPath();
    ctx.arc(this.x, this.y, 20 * _TS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(162,155,254,${0.10 * pulse})`;
    ctx.fill();

    // Rotating prism arms (3 at L1, 4 at L2, 5 at L3)
    const nArms = 2 + lv;
    for (let i = 0; i < nArms; i++) {
      const a = angle + (i / nArms) * Math.PI * 2;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(a);
      ctx.fillStyle = lv === 3 ? '#d4ac0d' : '#a29bfe';
      ctx.fillRect(7 * _TS, -2 * _TS, (13 + lv) * _TS, 4 * _TS);
      // Tip gem
      ctx.fillStyle = lv === 3 ? '#f1c40f' : '#e8e4ff';
      ctx.fillRect((19 + lv) * _TS, -3 * _TS, 4 * _TS, 6 * _TS);
      ctx.restore();
    }

    // Central emitter body
    const bodyR = (9 + lv) * _TS;
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#6c5ce7' : lv === 2 ? '#7c6cf7' : '#4a3a8a';
    ctx.fill();
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : '#a29bfe';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pulsing core
    ctx.beginPath();
    ctx.arc(this.x, this.y, bodyR * 0.5 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#e8e4ff';
    ctx.fill();

    this._levelDots(ctx);
  }

  // ── Tesla: coil tower with arcing spheres ──────────────────────────────
  _drawTesla(ctx) {
    const lv = this.level;
    this._basePlate(ctx);

    // Electric aura
    const pulse = 0.6 + 0.4 * Math.sin(this.spinAngle * 4);
    ctx.beginPath();
    ctx.arc(this.x, this.y, 19 * _TS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,206,201,${0.10 * pulse})`;
    ctx.fill();

    // Central coil pillar
    const cW = (8 + lv) * _TS, cH = (20 + lv * 2) * _TS;
    ctx.fillStyle = lv === 3 ? '#2d3436' : '#636e72';
    ctx.fillRect(this.x - cW / 2, this.y - cH / 2, cW, cH);
    ctx.strokeStyle = lv === 3 ? '#f1c40f' : '#00cec9';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.x - cW / 2, this.y - cH / 2, cW, cH);

    // Top sphere
    const sR = (6 + lv) * _TS;
    ctx.beginPath();
    ctx.arc(this.x, this.y - cH / 2 + sR * 0.3, sR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#00cec9';
    ctx.fill();
    ctx.strokeStyle = '#dfe6e9'; ctx.lineWidth = 1; ctx.stroke();

    // Bottom sphere
    ctx.beginPath();
    ctx.arc(this.x, this.y + cH / 2 - sR * 0.3, sR, 0, Math.PI * 2);
    ctx.fillStyle = lv === 3 ? '#f1c40f' : '#00cec9';
    ctx.fill();
    ctx.strokeStyle = '#dfe6e9'; ctx.stroke();

    // Random spark dots when pulsing
    if (pulse > 0.85) {
      for (let i = 0; i < 1 + lv; i++) {
        const sy = this.y + (Math.random() - 0.5) * cH * 0.6;
        const sx = this.x + (Math.random() > 0.5 ? 1 : -1) * cW * 0.7;
        ctx.beginPath();
        ctx.arc(sx, sy, 2 * _TS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
      }
    }

    this._levelDots(ctx);
  }

  // ── Tesla chain lightning (drawn in a separate pass on top of enemies) ────
  drawChain(ctx) {
    if (this.chainTimer <= 0 || this.chainPoints.length < 2) return;
    const alpha = Math.min(1, this.chainTimer / 0.06);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (let i = 0; i < this.chainPoints.length - 1; i++) {
      const a = this.chainPoints[i], b = this.chainPoints[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const segs = 8, jitter = len * 0.18;
      // Build path with jitter
      const pts = [];
      for (let s = 1; s < segs; s++) {
        const t = s / segs;
        pts.push({
          x: a.x + dx * t + nx * (Math.random() - 0.5) * jitter,
          y: a.y + dy * t + ny * (Math.random() - 0.5) * jitter,
        });
      }
      // Outer glow
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(0,206,201,0.35)';
      ctx.lineWidth = 7 * _TS; ctx.stroke();
      // Core
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#e0fffe';
      ctx.lineWidth = 1.5 * _TS; ctx.stroke();
    }
    ctx.restore();
  }

  // ── Laser beam (drawn in a separate pass on top of enemies) ───────────────
  drawBeam(ctx) {
    if (!this.beamActive) return;
    const ex = this.x + Math.cos(this.angle) * this.range;
    const ey = this.y + Math.sin(this.angle) * this.range;
    ctx.save();
    ctx.lineCap = 'round';
    // Outer soft glow
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(162,155,254,0.14)';
    ctx.lineWidth = 14 * _TS; ctx.stroke();
    // Mid glow
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(162,155,254,0.45)';
    ctx.lineWidth = 4 * _TS; ctx.stroke();
    // Bright core
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey);
    ctx.strokeStyle = '#f0eeff';
    ctx.lineWidth = 1.5 * _TS; ctx.stroke();
    ctx.restore();
  }

  // ── Public draw ───────────────────────────────────────────────────────────
  draw(ctx, selected) {
    const half = TILE_SIZE / 2;

    // Faint permanent range ring — always visible, very subtle
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
    ctx.strokeStyle = this.color + '1a';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Bright range ring when selected
    if (selected) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Placement bounce: scale 0 → 1.25 → 1.0 over 0.38s
    let animScale = 1;
    if (this.placementAnim > 0) {
      const t = 1 - this.placementAnim / 0.38;
      animScale = t < 0.6
        ? (t / 0.6) * 1.25
        : 1.25 - ((t - 0.6) / 0.4) * 0.25;
    }

    if (animScale !== 1) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(animScale, animScale);
      ctx.translate(-this.x, -this.y);
    }

    // Draw type shape
    switch (this.type) {
      case 'Basic':  this._drawBasic(ctx);  break;
      case 'Sniper': this._drawSniper(ctx); break;
      case 'Cannon': this._drawCannon(ctx); break;
      case 'Freeze': this._drawFreeze(ctx); break;
      case 'Rapid':  this._drawRapid(ctx);  break;
      case 'Laser':  this._drawLaser(ctx);  break;
      case 'Tesla':  this._drawTesla(ctx);  break;
    }

    // Firing flash halo (drawn on top)
    if (this.flashTimer > 0) {
      const alpha = (this.flashTimer / 0.08) * 0.55;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 22 * _TS, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    }

    if (animScale !== 1) ctx.restore();
  }
}
