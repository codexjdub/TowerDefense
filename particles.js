// Victory confetti, drawn on the 2D overlay canvas. In-game effects live in
// render3d.js, which also uses rand().

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
