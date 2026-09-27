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
// Drawn by Render3D.drawOverlay at their projected screen position.
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
}

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
  }

  update(dt, enemies, floatingTexts) {
    if (!this.alive) return;

    if (!this.target.alive && this.aoe === 0) { this.alive = false; return; }

    const tx   = this.target.alive ? this.target.x : this.x;
    const ty   = this.target.alive ? this.target.y : this.y;
    const dx   = tx - this.x;
    const dy   = ty - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const move = this.speed * dt;

    if (dist <= move + this.size) {
      if (this.aoe > 0) {
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

  // Visual-only timers. game.js calls this every frame in every phase, so effects
  // fade out between waves and after game over instead of freezing on screen.
  // The placement bounce runs on real time so a tower placed while paused still appears.
  tickVisuals(dt, rawDt) {
    if (this.flashTimer    > 0) this.flashTimer    = Math.max(0, this.flashTimer    - dt);
    if (this.recoilAnim    > 0) this.recoilAnim    = Math.max(0, this.recoilAnim    - dt);
    if (this.chainTimer    > 0) this.chainTimer    = Math.max(0, this.chainTimer    - dt);
    if (this.placementAnim > 0) this.placementAnim = Math.max(0, this.placementAnim - rawDt);
  }

  update(dt, enemies, projectiles, floatingTexts = null) {
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
}
