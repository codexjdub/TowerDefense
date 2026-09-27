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
}
