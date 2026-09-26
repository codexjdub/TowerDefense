// Scale enemy radii with tile size (baseline: 48px tiles)
const _ES = TILE_SIZE / 48;

const ENEMY_DEFS = {
  Scout:   { hp: 80,   speed: 120, reward: 10,  color: '#e74c3c', radius: Math.round(12 * _ES), special: null,      label: 'S'  },
  Soldier: { hp: 200,  speed: 80,  reward: 20,  color: '#c0392b', radius: Math.round(14 * _ES), special: null,      label: 'So' },
  Tank:    { hp: 600,  speed: 50,  reward: 50,  color: '#7f8c8d', radius: Math.round(18 * _ES), special: 'armored', label: 'T'  },
  Speeder: { hp: 120,  speed: 200, reward: 15,  color: '#f39c12', radius: Math.round(10 * _ES), special: null,      label: 'Sp' },
  Healer:  { hp: 300,  speed: 70,  reward: 35,  color: '#2ecc71', radius: Math.round(14 * _ES), special: 'healer',  label: 'H'  },
  Boss:    { hp: 3000, speed: 40,  reward: 200, color: '#8e44ad', radius: Math.round(22 * _ES), special: null,      label: 'B'  },
};

class Enemy {
  constructor(type) {
    const def = ENEMY_DEFS[type];
    this.type    = type;
    this.hp      = def.hp;
    this.maxHp   = def.hp;
    this.speed   = def.speed;
    this.reward  = def.reward;
    this.color   = def.color;
    this.radius  = def.radius;
    this.special = def.special;
    this.label   = def.label;

    // Start at first waypoint pixel position
    this.x = PATH_WAYPOINTS[0].x;
    this.y = PATH_WAYPOINTS[0].y;
    this.waypointIndex = 1; // heading toward this waypoint

    this.slowTimer   = 0;
    this.slowFactor  = 1;
    this.alive       = false;
    this.escaped     = false;
    this.waveMod     = null;
    this.waveArmored = false;
    this.moveAngle   = 0;      // direction of travel (radians), updated each frame
    this.displayHp    = def.hp; // smooth HP bar — interpolates toward this.hp
    this.wobble       = 0;      // lateral sway offset (pixels), recomputed each frame
    this.lastHitTower = null;   // tower that dealt the killing blow (for kill credit)
  }

  // How far along the path this enemy is (higher = further along)
  get progress() {
    if (this.waypointIndex >= PATH_WAYPOINTS.length) return PATH_WAYPOINTS.length;
    const wp = PATH_WAYPOINTS[this.waypointIndex];
    const dx = wp.x - this.x;
    const dy = wp.y - this.y;
    return this.waypointIndex - Math.sqrt(dx * dx + dy * dy) / TILE_SIZE;
  }

  update(dt, enemies) {
    if (!this.alive) return;

    // Tick slow
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowTimer  = 0;
        this.slowFactor = 1;
      }
    }

    // Healer aura
    if (this.special === 'healer') {
      for (const e of enemies) {
        if (e === this || !e.alive) continue;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 2.5) {
          e.hp = Math.min(e.maxHp, e.hp + 10 * dt);
        }
      }
    }

    // Already past last waypoint
    if (this.waypointIndex >= PATH_WAYPOINTS.length) {
      this.escaped = true;
      this.alive   = false;
      return;
    }

    // Move toward next waypoint
    const wp   = PATH_WAYPOINTS[this.waypointIndex];
    const dx   = wp.x - this.x;
    const dy   = wp.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const move = this.speed * this.slowFactor * dt;

    if (dist <= move) {
      this.x = wp.x;
      this.y = wp.y;
      this.waypointIndex++;
      if (this.waypointIndex >= PATH_WAYPOINTS.length) {
        this.escaped = true;
        this.alive   = false;
      }
    } else {
      this.moveAngle = Math.atan2(dy, dx);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }

    // Smooth HP bar drain
    if (this.displayHp !== this.hp) {
      this.displayHp += (this.hp - this.displayHp) * Math.min(1, dt * 9);
      if (Math.abs(this.displayHp - this.hp) < 0.5) this.displayHp = this.hp;
    }

    // Lateral wobble — perpendicular sway, magnitude varies by type
    const wMag = (this.type === 'Boss' ? 2 : this.type === 'Tank' ? 2.5 : 3.5) * _ES;
    this.wobble = Math.sin(this.progress * 0.45 + Date.now() * 0.0035) * wMag;
  }

  // Returns actual damage dealt
  takeDamage(amount, source) {
    let dmg = amount;
    if (this.special === 'armored' && (source === 'Basic' || source === 'Rapid')) {
      dmg *= 0.7;
    }
    if (this.waveArmored) dmg *= 0.5;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp    = 0;
      this.alive = false;
    }
    if (typeof _onDamage === 'function') _onDamage(dmg, source);
    return dmg;
  }

  applySlow(factor, duration) {
    if (factor < this.slowFactor) this.slowFactor = factor;
    if (duration > this.slowTimer) this.slowTimer  = duration;
  }

  // ── Shared: HP bar, slow/modifier rings ──────────────────────────────────
  _drawOverlays(ctx) {
    const t = Date.now() / 1000;
    const r = this.radius;

    // Slow ring
    if (this.slowTimer > 0) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 5 * _ES, 0, Math.PI * 2);
      ctx.strokeStyle = '#74b9ff'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Wave-modifier ring
    if (this.waveMod === 'Armored') {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 7 * _ES, 0, Math.PI * 2);
      ctx.strokeStyle = '#bdc3c7'; ctx.lineWidth = 2.5; ctx.stroke();
    } else if (this.waveMod === 'Haste') {
      const p = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 7 * _ES, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(231,76,60,${0.4 + 0.5 * p})`; ctx.lineWidth = 2; ctx.stroke();
    } else if (this.waveMod === 'Swarm') {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 6 * _ES, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(155,89,182,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // HP bar
    const isBoss = this.type === 'Boss';
    const bw  = isBoss ? r * 3 : r * 2 + 4 * _ES, bh = isBoss ? Math.round(7 * _ES) : Math.round(5 * _ES);
    const bx  = this.x - bw / 2, by = this.y - r - (isBoss ? 22 * _ES : 10 * _ES);
    ctx.fillStyle = '#111'; ctx.fillRect(bx, by, bw, bh);
    const pct = Math.max(0, this.displayHp / this.maxHp);
    ctx.fillStyle = pct > 0.5 ? '#2ecc71' : pct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(bx, by, bw * pct, bh);
    if (isBoss) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }

  draw(ctx) {
    const t = Date.now() / 1000;
    const r = this.radius;

    // Apply lateral wobble as a perpendicular-to-movement ctx translate
    const perpX = -Math.sin(this.moveAngle);
    const perpY =  Math.cos(this.moveAngle);
    ctx.save();
    ctx.translate(perpX * this.wobble, perpY * this.wobble);

    // ── Scout: teardrop pointed in direction of travel ────────────────────
    if (this.type === 'Scout') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.moveAngle);
      ctx.beginPath();
      ctx.moveTo(r * 1.15, 0);
      ctx.bezierCurveTo(r * 0.4, -r * 0.75, -r * 0.9, -r * 0.5, -r * 0.85, 0);
      ctx.bezierCurveTo(-r * 0.9,  r * 0.5,  r * 0.4,  r * 0.75,  r * 1.15, 0);
      ctx.fillStyle   = this.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      // Eye dot
      ctx.beginPath(); ctx.arc(r * 0.35, 0, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
    }

    // ── Soldier: pentagon / shield ────────────────────────────────────────
    else if (this.type === 'Soldier') {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a  = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const px = this.x + r * Math.cos(a), py = this.y + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = this.color; ctx.fill();
      ctx.strokeStyle = '#7b241c'; ctx.lineWidth = 2; ctx.stroke();
      // Shield boss
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = '#922b21'; ctx.fill();
    }

    // ── Tank: chunky hexagon ──────────────────────────────────────────────
    else if (this.type === 'Tank') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a  = i * Math.PI / 3 + Math.PI / 6;
        const px = this.x + r * Math.cos(a), py = this.y + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = this.color; ctx.fill();
      ctx.strokeStyle = '#aab7b8'; ctx.lineWidth = 2.5; ctx.stroke();
      // Inner hex
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a  = i * Math.PI / 3 + Math.PI / 6;
        const px = this.x + r * 0.52 * Math.cos(a), py = this.y + r * 0.52 * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // ── Speeder: elongated oval with motion streaks ───────────────────────
    else if (this.type === 'Speeder') {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.moveAngle);
      // Speed streaks behind
      ctx.strokeStyle = this.color + '55'; ctx.lineWidth = 1.5;
      for (let i = 1; i <= 3; i++) {
        const offs = i * (r * 0.65);
        ctx.beginPath();
        ctx.moveTo(-offs,          -r * 0.25);
        ctx.lineTo(-offs - r * 0.4, 0);
        ctx.lineTo(-offs,           r * 0.25);
        ctx.stroke();
      }
      // Elongated body
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.5, r * 0.58, 0, 0, Math.PI * 2);
      ctx.fillStyle = this.color; ctx.fill();
      ctx.strokeStyle = '#e67e22'; ctx.lineWidth = 1.5; ctx.stroke();
      // Nose highlight
      ctx.beginPath(); ctx.arc(r * 0.85, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      ctx.restore();
    }

    // ── Healer: rounded cross / plus ─────────────────────────────────────
    else if (this.type === 'Healer') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
      // Pulsing aura
      ctx.beginPath();
      ctx.arc(this.x, this.y, TILE_SIZE * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(46,204,113,${0.04 + 0.03 * pulse})`; ctx.fill();
      ctx.strokeStyle = `rgba(46,204,113,${0.25 + 0.15 * pulse})`; ctx.lineWidth = 1.5; ctx.stroke();
      // Plus shape
      const arm = r * 0.88, w = r * 0.42;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(this.x - arm, this.y - w); ctx.lineTo(this.x + arm, this.y - w);
      ctx.lineTo(this.x + arm, this.y + w); ctx.lineTo(this.x - arm, this.y + w);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(this.x - w, this.y - arm); ctx.lineTo(this.x + w, this.y - arm);
      ctx.lineTo(this.x + w, this.y + arm); ctx.lineTo(this.x - w, this.y + arm);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#27ae60'; ctx.lineWidth = 1.5;
      // Stroke both arms together
      ctx.beginPath();
      ctx.moveTo(this.x - arm, this.y - w); ctx.lineTo(this.x - w, this.y - w);
      ctx.lineTo(this.x - w, this.y - arm); ctx.lineTo(this.x + w, this.y - arm);
      ctx.lineTo(this.x + w, this.y - w);   ctx.lineTo(this.x + arm, this.y - w);
      ctx.lineTo(this.x + arm, this.y + w); ctx.lineTo(this.x + w, this.y + w);
      ctx.lineTo(this.x + w, this.y + arm); ctx.lineTo(this.x - w, this.y + arm);
      ctx.lineTo(this.x - w, this.y + w);   ctx.lineTo(this.x - arm, this.y + w);
      ctx.closePath(); ctx.stroke();
      // White cross highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(this.x, this.y - r * 0.7); ctx.lineTo(this.x, this.y + r * 0.7);
      ctx.moveTo(this.x - r * 0.7, this.y); ctx.lineTo(this.x + r * 0.7, this.y);
      ctx.stroke();
    }

    // ── Boss: circle + crown + purple glow ───────────────────────────────
    else if (this.type === 'Boss') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
      ctx.save();
      ctx.shadowBlur  = 18 + 8 * pulse;
      ctx.shadowColor = '#8e44ad';
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(155,89,182,${0.5 + 0.3 * pulse})`; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2.5; ctx.stroke();
      // Crown
      const cy = this.y - r - 3 * _ES;
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(this.x - 12 * _ES, cy + 4 * _ES, 24 * _ES, 5 * _ES);
      for (let i = 0; i < 3; i++) {
        const sx = this.x + (-8 + i * 8) * _ES;
        ctx.beginPath();
        ctx.moveTo(sx, cy); ctx.lineTo(sx - 4 * _ES, cy + 8 * _ES); ctx.lineTo(sx + 4 * _ES, cy + 8 * _ES);
        ctx.closePath(); ctx.fill();
      }
    }

    // ── Fallback: circle ─────────────────────────────────────────────────
    else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    this._drawOverlays(ctx);
    ctx.restore(); // end wobble translate
  }
}
