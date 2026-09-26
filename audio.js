const Audio = (() => {
  let ctx    = null;
  let muted  = false;
  let shootCD = 0;

  // Background music node refs
  let music = null;
  // Restore muted preference from previous session
  try { muted = localStorage.getItem('td_muted') === '1'; } catch (_) {}

  function init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function tone(freq, type, duration, vol, delay = 0, freqEnd = null) {
    if (muted || !ctx) return;
    const t   = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t); osc.stop(t + duration + 0.01);
  }

  function noise(duration, vol, delay = 0) {
    if (muted || !ctx) return;
    const samples = Math.ceil(ctx.sampleRate * duration);
    const buf     = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data    = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(g); g.connect(ctx.destination);
    src.start(t);
  }

  function startMusic()  {}
  function stopMusic()   {}
  function pauseMusic()  {}
  function resumeMusic() {}

  // ─── SFX ────────────────────────────────────────────────────────────────────
  return {
    get muted() { return muted; },
    set muted(v) {
      muted = v;
      try { localStorage.setItem('td_muted', v ? '1' : '0'); } catch (_) {}
      if (music) {
        music.master.gain.setTargetAtTime(v ? 0 : 0.10, ctx.currentTime, 0.3);
      }
    },

    init,
    startMusic, stopMusic, pauseMusic, resumeMusic,

    shoot(type) {
      const now = performance.now();
      if (now - shootCD < 75) return;
      shootCD = now;
      switch (type) {
        case 'Basic':  tone(440, 'square',   0.06, 0.12); break;
        case 'Sniper': tone(880, 'sawtooth', 0.05, 0.10); break;
        case 'Cannon': noise(0.12, 0.20); tone(90, 'sine', 0.18, 0.25); break;
        case 'Freeze': tone(660, 'sine', 0.10, 0.10); tone(330, 'sine', 0.10, 0.08, 0.05); break;
        case 'Rapid':  tone(600, 'square', 0.04, 0.09); break;
      }
    },

    enemyDeath(isBoss) {
      if (isBoss) {
        noise(0.25, 0.30); tone(180, 'sawtooth', 0.35, 0.35); tone(90, 'sawtooth', 0.40, 0.25, 0.20);
      } else {
        tone(340, 'sawtooth', 0.07, 0.15); noise(0.05, 0.10);
      }
    },

    lifeLost() { tone(220, 'sine', 0.40, 0.30); tone(160, 'sine', 0.40, 0.25, 0.15); },

    towerPlace() { tone(600, 'sine', 0.08, 0.20); },

    upgrade() {
      tone(440, 'sine', 0.07, 0.18);
      tone(554, 'sine', 0.07, 0.18, 0.07);
      tone(659, 'sine', 0.12, 0.20, 0.14);
    },

    sell() { tone(220, 'sine', 0.15, 0.18); },

    waveStart() {
      tone(330, 'sine', 0.10, 0.22);
      tone(440, 'sine', 0.10, 0.22, 0.10);
      tone(550, 'sine', 0.15, 0.22, 0.20);
    },

    waveComplete() {
      [0, 0.10, 0.20, 0.32].forEach((d, i) => tone([440,550,660,880][i], 'sine', 0.14, 0.22, d));
    },

    income() { tone(523, 'sine', 0.12, 0.18); tone(659, 'sine', 0.12, 0.18, 0.08); },

    gameOver() {
      tone(330, 'sawtooth', 0.30, 0.28);
      tone(220, 'sawtooth', 0.35, 0.22, 0.25);
      tone(110, 'sawtooth', 0.55, 0.18, 0.55);
    },

    victory() {
      [0, 0.10, 0.20, 0.35, 0.50].forEach((d, i) =>
        tone([440,550,660,880,1100][i], 'sine', 0.18, 0.22, d));
    },
  };
})();
