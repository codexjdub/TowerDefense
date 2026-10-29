// Procedural sound: every effect, the music and the ambience are synthesised with Web Audio.
// No sound files. Graph:
//   sound → panner ─┬→ sfxBus ──────────┐
//                   └→ send → sfxRev ──→ sfxBus
//   music → song bus → musicLevel ─┬→ musicBus ─┼→ master (mute) → compressor → speakers
//                                  └→ musicRev ─→ musicBus
//   ambience / hums → ambBus → sfxBus
const Audio = (() => {
  let ctx = null;
  let muted = false;
  let vol = { music: 0.5, sfx: 0.8 };
  const clamp01 = v => Math.min(1, Math.max(0, +v || 0));
  try { muted = localStorage.getItem('td_muted') === '1'; } catch (_) {}
  try {
    const v = JSON.parse(localStorage.getItem('td_vol'));
    if (v) vol = { music: clamp01(v.music), sfx: clamp01(v.sfx) };
  } catch (_) {}

  let master, sfxBus, musicBus, musicLevel, ambBus, sfxRev, musicRev, noiseBuf;
  const NOISE_LEN = 4;          // seconds of cached white noise, shared by every noise sound
  const MAX_VOICES = 48;        // sources playing at once; ordinary effects are dropped past this
  let voices = 0;

  function init() {
    if (ctx) { if (!muted && ctx.state === 'suspended' && !document.hidden) ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 8;
    comp.attack.value = 0.003;  comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = gain(muted ? 0 : 1, comp);
    sfxBus   = gain(vol.sfx, master);
    musicBus = gain(vol.music * 0.7, master);
    musicLevel = gain(0, musicBus);
    ambBus   = gain(0, sfxBus);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * NOISE_LEN, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const ir = impulse(1.8);
    sfxRev = ctx.createConvolver();   sfxRev.buffer = ir;   sfxRev.connect(gain(0.6, sfxBus));
    musicRev = ctx.createConvolver(); musicRev.buffer = ir; musicRev.connect(gain(0.7, musicBus));


    buildLoops();
    if (muted) ctx.suspend();
  }

  // Pause all audio while the tab is hidden (rAF stops then too)
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (!muted) ctx.resume();
  });

  // ─── Building blocks ─────────────────────────────────────────────────────────
  function gain(v, to) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  // A stereo reverb tail: decaying noise
  function impulse(sec) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = b.getChannelData(c);
      for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    }
    return b;
  }

  const live = () => ctx && !muted && ctx.state === 'running';
  // Can a sound play now? Important ones (stingers, UI, life lost) ignore the voice cap.
  const ready = (important) => live() && (important || voices < MAX_VOICES);
  function track(src) { voices++; src.onended = () => { voices--; }; }
  const vary = (amt = 0.04) => 1 + (Math.random() * 2 - 1) * amt;

  // Stereo position of a game-pixel point: where it appears on screen, so panning still
  // matches after the camera is rotated
  function panAt(x, y) {
    if (x == null) return 0;
    let sx = x;
    if (typeof Render3D !== 'undefined' && Render3D.ok) sx = Render3D.project(x, y, 0.5)[0];
    return Math.max(-1, Math.min(1, sx / (COLS * TILE_SIZE) * 2 - 1)) * 0.75;
  }

  // Output for one sound: a panner into the effects bus, plus a reverb send
  function out(x, y, rev = 0.12, bus = sfxBus, revNode = sfxRev) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = typeof x === 'number' && y === undefined ? x : panAt(x, y);
    p.connect(bus);
    if (rev > 0) p.connect(gain(rev, revNode));
    return p;
  }

  function env(g, t, v, at, dur) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, at + 0.01));
  }

  // One oscillator with a pitch glide and an optional lowpass sweep
  function osc(dst, t, { f, f2, type = 'sine', dur, vol, at = 0.003, lp, lp2, q = 0.7, detune = 0 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    let head = o;
    if (lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass'; fl.Q.value = q;
      fl.frequency.setValueAtTime(lp, t);
      if (lp2) fl.frequency.exponentialRampToValueAtTime(lp2, t + dur);
      o.connect(fl); head = fl;
    }
    head.connect(g); g.connect(dst);
    env(g, t, vol, at, dur);
    o.start(t); o.stop(t + dur + 0.03);
    track(o);
  }

  // A filtered burst from the cached noise buffer
  function nz(dst, t, { dur, vol, at = 0.002, ft = 'bandpass', f = 1000, f2, q = 1 }) {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    fl.type = ft; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dst);
    env(g, t, vol, at, dur);
    s.start(t, Math.random() * Math.max(0, NOISE_LEN - dur - 0.1));
    s.stop(t + dur + 0.03);
    track(s);
  }

  // ─── Weapons ─────────────────────────────────────────────────────────────────
  // Minimum gap between two shots of the same type (s): each type stays audible in busy
  // waves without a dozen Rapids stacking into noise
  const SHOT_GAP = { Basic: 0.05, Sniper: 0.03, Cannon: 0.07, Freeze: 0.06, Rapid: 0.045, Tesla: 0.06 };
  const lastShot = {};

  const SHOTS = {
    Basic(d, t, v) {
      nz(d, t, { dur: 0.05, vol: 0.2, f: 1800 * v, q: 1.2 });
      osc(d, t, { f: 320 * v, f2: 110, type: 'triangle', dur: 0.09, vol: 0.16 });
    },
    Sniper(d, t, v) {
      nz(d, t, { dur: 0.035, vol: 0.32, ft: 'highpass', f: 2500 });
      osc(d, t, { f: 1400 * v, f2: 180, type: 'sawtooth', dur: 0.07, vol: 0.07, lp: 3500 });
      nz(d, t + 0.01, { dur: 0.4, vol: 0.09, f: 900, f2: 280, q: 0.8 });
    },
    Cannon(d, t, v) {
      osc(d, t, { f: 120 * v, f2: 38, dur: 0.32, vol: 0.5 });
      nz(d, t, { dur: 0.25, vol: 0.28, ft: 'lowpass', f: 900, f2: 140 });
    },
    Freeze(d, t, v) {
      osc(d, t, { f: 1320 * v, dur: 0.28, vol: 0.07 });
      osc(d, t + 0.015, { f: 1980 * v, dur: 0.2, vol: 0.045 });
      nz(d, t, { dur: 0.09, vol: 0.05, ft: 'highpass', f: 6000 });
    },
    Rapid(d, t, v) {
      nz(d, t, { dur: 0.03, vol: 0.14, f: 2600 * v, q: 2 });
      osc(d, t, { f: 900 * v, f2: 450, type: 'square', dur: 0.03, vol: 0.04, lp: 2500 });
    },
    // Crackle: a run of tiny clicks over a falling buzz
    Tesla(d, t, v) {
      let k = t;
      for (let i = 0; i < 6; i++) {
        nz(d, k, { dur: 0.018, vol: 0.16 * (1 - i * 0.12), f: 3200 * vary(0.3), q: 0.7 });
        k += 0.012 + Math.random() * 0.022;
      }
      osc(d, t, { f: 190 * v, f2: 80, type: 'sawtooth', dur: 0.22, vol: 0.07, lp: 1400 });
      osc(d, t, { f: 2400 * v, f2: 500, type: 'square', dur: 0.08, vol: 0.025, lp: 4000 });
    },
  };

  // ─── Enemy deaths ────────────────────────────────────────────────────────────
  function boom(d, t, size) {
    nz(d, t, { dur: 0.5 * size, vol: 0.42, ft: 'lowpass', f: 1300, f2: 90 });
    osc(d, t, { f: 75, f2: 28, dur: 0.45 * size, vol: 0.45 });
    nz(d, t + 0.02, { dur: 0.15, vol: 0.09, ft: 'highpass', f: 2200 });
  }

  const DEATHS = {
    Scout(d, t, v) {
      osc(d, t, { f: 620 * v, f2: 190, dur: 0.09, vol: 0.12 });
      nz(d, t, { dur: 0.05, vol: 0.08, f: 1500 });
    },
    Soldier(d, t, v) {
      osc(d, t, { f: 230 * v, f2: 105, type: 'square', dur: 0.13, vol: 0.09, lp: 900 });
      nz(d, t, { dur: 0.08, vol: 0.1, f: 1100 });
      osc(d, t + 0.06, { f: 1850 * v, dur: 0.12, vol: 0.03 });           // helmet ping
    },
    Speeder(d, t, v) {
      nz(d, t, { dur: 0.22, vol: 0.14, f: 2200, f2: 500, q: 1.5 });
      osc(d, t, { f: 520 * v, f2: 140, type: 'sawtooth', dur: 0.16, vol: 0.06, lp: 2000 });
    },
    Tank(d, t, v) {
      boom(d, t, 1.2);
      osc(d, t + 0.08, { f: 340 * v, type: 'square', dur: 0.3, vol: 0.04, lp: 1600 });   // metal clank
      osc(d, t + 0.08, { f: 467 * v, type: 'square', dur: 0.25, vol: 0.03, lp: 1600 });
    },
    Healer(d, t, v) {
      [1568, 1175, 880].forEach((f, i) => osc(d, t + i * 0.06, { f: f * v, dur: 0.35, vol: 0.06 }));
    },
    Boss(d, t) {
      boom(d, t, 2.4);
      osc(d, t, { f: 90, f2: 24, dur: 1.4, vol: 0.5 });
      boom(d, t + 0.28, 1.6);
      osc(d, t, { f: 180, f2: 60, type: 'sawtooth', dur: 0.8, vol: 0.12, lp: 700, lp2: 150 });
    },
  };
  const lastDeath = {};

  // ─── Loops: Laser hum and portal hum ─────────────────────────────────────────
  let laser = null, portal = null;
  function buildLoops() {
    // Laser: two buzzing saws through a wobbling bandpass
    const lp = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const lg = gain(0, lp), lf = ctx.createBiquadFilter();
    lp.connect(sfxBus);
    lf.type = 'bandpass'; lf.frequency.value = 900; lf.Q.value = 3; lf.connect(lg);
    for (const [f, type] of [[98, 'sawtooth'], [196.6, 'sawtooth'], [1760, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      o.connect(f > 1000 ? gain(0.25, lf) : lf); o.start();
    }
    const wob = ctx.createOscillator(); wob.frequency.value = 6;
    wob.connect(gain(260, lf.frequency)); wob.start();
    laser = { pan: lp, gain: lg };

    // Portal: a low beating drone with slow tremolo
    const pp = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const pg = gain(0, pp), trem = gain(0.7, pg);
    pp.connect(sfxBus);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain(0.5, trem)); o.start();
    }
    const tl = ctx.createOscillator(); tl.frequency.value = 0.3;
    tl.connect(gain(0.3, trem.gain)); tl.start();
    portal = { pan: pp, gain: pg, surge: 0 };
  }

  // ─── Ambience per theme ──────────────────────────────────────────────────────
  // Noise layers: filter type, frequency, Q, level, and optional filter sweep (lfo Hz, depth)
  // and gusts (Hz, share of the level). `event` plays now and then.
  const AMBIENCE = {
    meadow:   { layers: [{ ft: 'lowpass', f: 450, q: 0.7, vol: 0.10, lfo: 0.07, depth: 200, gust: 0.11, g: 0.6 }],
                every: [2.5, 7], event: birds },
    autumn:   { layers: [{ ft: 'bandpass', f: 650, q: 0.8, vol: 0.12, lfo: 0.09, depth: 260, gust: 0.16, g: 0.75 }],
                every: [1.5, 4], event: rustle },
    desert:   { layers: [{ ft: 'highpass', f: 2600, q: 0.7, vol: 0.025, gust: 0.13, g: 0.6 },
                         { ft: 'lowpass', f: 300, q: 0.7, vol: 0.1, lfo: 0.05, depth: 120, gust: 0.08, g: 0.5 }],
                every: [4, 9], event: sandGust },
    snow:     { layers: [{ ft: 'bandpass', f: 600, q: 7, vol: 0.16, lfo: 0.06, depth: 280, gust: 0.1, g: 0.7 },
                         { ft: 'lowpass', f: 350, q: 0.7, vol: 0.06 }],
                every: [5, 11], event: whistle },
    volcanic: { layers: [{ ft: 'lowpass', f: 110, q: 0.9, vol: 0.32, gust: 0.05, g: 0.4 }],
                every: [0.15, 1.1], event: crackle },
  };
  let amb = null, ambTheme = null, ambNext = 0;

  function buildAmbience(theme) {
    const now = ctx.currentTime;
    if (amb) {
      const old = amb;
      old.out.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => { old.nodes.forEach(n => n.stop()); old.out.disconnect(); }, 2500);
    }
    const A = AMBIENCE[theme] || AMBIENCE.meadow, g = gain(0, ambBus), nodes = [];
    g.gain.setTargetAtTime(1, now, 1.2);
    for (const L of A.layers) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), lg = gain(L.vol, g);
      s.buffer = noiseBuf; s.loop = true;
      fl.type = L.ft; fl.frequency.value = L.f; fl.Q.value = L.q;
      s.connect(fl); fl.connect(lg);
      s.start(now, Math.random() * NOISE_LEN); nodes.push(s);
      if (L.lfo) {
        const o = ctx.createOscillator(); o.frequency.value = L.lfo;
        o.connect(gain(L.depth, fl.frequency)); o.start(); nodes.push(o);
      }
      if (L.gust) {
        const o = ctx.createOscillator(); o.frequency.value = L.gust;
        o.connect(gain(L.vol * L.g, lg.gain)); o.start(); nodes.push(o);
      }
    }
    amb = { out: g, nodes, def: A };
    ambNext = now + 1;
  }

  const ambOut = () => out(Math.random() * 1.6 - 0.8, undefined, 0.3, ambBus);
  function birds(t) {
    const d = ambOut(), base = 2400 + Math.random() * 1400;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) osc(d, t + i * 0.09, { f: base * vary(0.08), f2: base * 1.45, dur: 0.07, vol: 0.05 });
  }
  function rustle(t) {
    nz(ambOut(), t, { dur: 0.5, vol: 0.05, at: 0.15, ft: 'highpass', f: 3500 });
  }
  function sandGust(t) {
    nz(ambOut(), t, { dur: 1.8, vol: 0.06, at: 0.7, f: 1300, f2: 700, q: 0.8 });
  }
  function whistle(t) {
    osc(ambOut(), t, { f: 850, f2: 1250, dur: 1.8, vol: 0.02, at: 0.7 });
  }
  function crackle(t) {
    const d = ambOut();
    if (Math.random() < 0.12) osc(d, t, { f: 130, f2: 55, dur: 0.22, vol: 0.06 });   // lava bubble
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++)
      nz(d, t + i * 0.03 * Math.random(), { dur: 0.012, vol: 0.06, ft: 'highpass', f: 1800 });
  }

  // ─── Music ───────────────────────────────────────────────────────────────────
  // A generated loop: 16th-note steps, a chord every two bars, four chords per cycle.
  const SCALES = {
    major:     [0, 2, 4, 5, 7, 9, 11],
    dorian:    [0, 2, 3, 5, 7, 9, 10],
    phrygDom:  [0, 1, 4, 5, 7, 8, 10],
    minor:     [0, 2, 3, 5, 7, 8, 10],
    harmMinor: [0, 2, 3, 5, 7, 8, 11],
  };
  // prog: scale degrees (0-based) of the four chords; voice: the arpeggio's instrument
  const MUSIC = {
    meadow:   { root: 60, scale: 'major',     prog: [0, 4, 5, 3], bpm: 100, voice: 'pluck' },
    autumn:   { root: 62, scale: 'dorian',    prog: [0, 2, 6, 3], bpm: 90,  voice: 'pluck' },
    desert:   { root: 62, scale: 'phrygDom',  prog: [0, 1, 0, 6], bpm: 96,  voice: 'oud' },
    snow:     { root: 64, scale: 'minor',     prog: [0, 5, 2, 6], bpm: 84,  voice: 'bell' },
    volcanic: { root: 57, scale: 'harmMinor', prog: [0, 5, 3, 4], bpm: 108, voice: 'square' },
  };
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  let song = MUSIC.meadow, songTheme = null, step = 0, nextT = 0, mood = null, ducked = false;
  // The current song's output: `dry` for every note, `pad` (lowpass, brightness per mood) and
  // `send` (its reverb) for the pads. A restart fades the old bus out, so notes the old song
  // already scheduled (pads last about 5s) die away instead of clashing with the new key.
  let songBus = null;
  function newSongBus() {
    const now = ctx.currentTime;
    if (songBus) {
      const old = songBus;
      for (const g of [old.dry, old.send]) g.gain.setTargetAtTime(0, now, 0.1);
      setTimeout(() => { old.dry.disconnect(); old.send.disconnect(); }, 1000);
    }
    const dry = gain(1, musicLevel), send = gain(0.5, musicRev), pad = ctx.createBiquadFilter();
    pad.type = 'lowpass'; pad.Q.value = 0.7; pad.frequency.value = MOODS[mood || 'menu'].pad;
    pad.connect(dry); pad.connect(send);
    songBus = { dry, send, pad };
  }

  function chordOf(deg) {
    const sc = SCALES[song.scale];
    return [deg, deg + 2, deg + 4].map(d => song.root + 12 * Math.floor(d / 7) + sc[d % 7]);
  }

  function pad(m, t, len) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(g); g.connect(songBus.pad);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.8);
      g.gain.setValueAtTime(0.03, t + len - 0.6);
      g.gain.linearRampToValueAtTime(0, t + len + 0.6);
      o.start(t); o.stop(t + len + 0.7);
      track(o);
    }
  }

  function lead(d, m, t, accent) {
    const f = hz(m), v = accent ? 1.3 : 1;
    switch (song.voice) {
      case 'bell':
        osc(d, t, { f, dur: 1.1, vol: 0.035 * v });
        osc(d, t, { f: f * 2.76, dur: 0.5, vol: 0.012 * v });
        break;
      case 'oud':
        osc(d, t, { f, type: 'sawtooth', dur: 0.22, vol: 0.04 * v, lp: 2600, lp2: 400 });
        break;
      case 'square':
        osc(d, t, { f, type: 'square', dur: 0.2, vol: 0.022 * v, lp: 1800, lp2: 500 });
        break;
      default:
        osc(d, t, { f, type: 'triangle', dur: 0.32, vol: 0.05 * v, lp: 3200, lp2: 700 });
    }
  }

  function playStep(i, t) {
    if (mood === 'end' || !songBus) return;
    const s = i % 16, bar = Math.floor(i / 16), dur = 60 / song.bpm / 4;
    const ch = chordOf(song.prog[Math.floor(bar / 2) % 4]);
    const fight = mood === 'fight' || mood === 'boss', boss = mood === 'boss';
    const m = songBus.dry;
    let dOut = null;                         // created only on steps that play a lead note
    const d = () => dOut || (dOut = out(0, undefined, 0.25, m, musicRev));

    if (s === 0 && bar % 2 === 0) for (const n of ch) pad(n - 12, t, 32 * dur);

    // Arpeggio: quarters on the menu, eighths otherwise
    const every = mood === 'menu' ? 4 : 2;
    if (s % every === 0) {
      const k = ARP[(s / every + bar * 2) % 8];
      lead(d(), ch[k] + (k === 2 && bar % 4 === 3 ? 12 : 0) + (mood === 'menu' ? 0 : 12), t, s === 0);
    }

    // Bass
    if (fight && [0, 3, 8, 11].concat(boss ? [14] : []).includes(s))
      osc(m, t, { f: hz((s === 11 ? ch[2] : ch[0]) - 24), type: 'triangle', dur: dur * 2.6, vol: 0.2, lp: 700 });
    else if (mood === 'build' && s === 0)
      osc(m, t, { f: hz(ch[0] - 24), type: 'triangle', dur: dur * 14, vol: 0.13, at: 0.1, lp: 500 });

    if (!fight) return;
    // Drums
    if (s === 0 || s === 8 || (boss && (s === 6 || s === 10)))
      osc(m, t, { f: 150, f2: 42, dur: 0.26, vol: 0.5 });
    if (s === 4 || s === 12) {
      nz(m, t, { dur: 0.16, vol: 0.18, f: 1800, q: 0.8 });
      osc(m, t, { f: 195, f2: 150, type: 'triangle', dur: 0.08, vol: 0.12 });
    }
    if (boss || s % 2 === 0)
      nz(m, t, { dur: 0.035, vol: s % 4 === 2 ? 0.07 : 0.045, ft: 'highpass', f: 7000 });

    // Boss: a brass-like riff on the chord tones
    if (boss) {
      const at = [0, 3, 6, 10].indexOf(s);
      if (at >= 0) for (const det of [-6, 6])
        osc(d(), t, { f: hz(ch[at === 3 ? 2 : at === 2 ? 1 : 0] - 12), type: 'sawtooth', detune: det,
                    dur: at === 3 ? 0.5 : 0.24, vol: 0.05, at: 0.02, lp: 600, lp2: 1500 });
    }
  }

  // Music level, pad brightness and ambience level per mood
  const MOODS = {
    menu:  { level: 0.8, pad: 700,  amb: 1   },
    build: { level: 0.8, pad: 900,  amb: 1   },
    fight: { level: 1,   pad: 1400, amb: 0.6 },
    boss:  { level: 1,   pad: 2200, amb: 0.5 },
    end:   { level: 0,   pad: 700,  amb: 0.6 },
  };
  function applyMood(now) {
    const M = MOODS[mood];
    musicLevel.gain.setTargetAtTime(M.level * (ducked ? 0.35 : 1), now, mood === 'end' ? 0.5 : 0.3);
    if (songBus) songBus.pad.frequency.setTargetAtTime(M.pad, now, 0.8);
    ambBus.gain.setTargetAtTime(M.amb, now, 0.8);
  }

  function restartSong() {
    step = 0;
    if (!ctx) return;
    nextT = ctx.currentTime + 0.1;
    newSongBus();
  }

  // ─── Per-frame driver ────────────────────────────────────────────────────────
  let lastTick = 0, healT = 1, portalPanT = 0;
  // Glide a loop's param toward v, scheduling only when the target actually changes
  const targets = new WeakMap();
  function glide(param, v, tc, eps = 0.002) {
    if (!param || Math.abs((targets.has(param) ? targets.get(param) : NaN) - v) <= eps) return;
    targets.set(param, v);
    param.setTargetAtTime(v, ctx.currentTime, tc);
  }
  function update(state, rawDt) {
    if (!live()) return;
    const now = ctx.currentTime;
    const theme = (MAP_CONFIGS[state.mapIndex] || MAP_CONFIGS[0]).theme;
    if (theme !== ambTheme) { ambTheme = theme; buildAmbience(theme); }
    if (theme !== songTheme) { songTheme = theme; song = MUSIC[theme] || MUSIC.meadow; restartSong(); }

    // Mood; drums come in and out on a bar line, the end fade starts at once
    const ph = state.phase;
    const bossAlive = ph === 'fight' && state.enemies.some(e => e.type === 'Boss');
    const want = ph === 'menu' ? 'menu' : ph === 'gameover' || ph === 'victory' ? 'end'
               : ph === 'fight' ? (bossAlive ? 'boss' : 'fight') : 'build';
    if (want !== mood && (!mood || want === 'end' || mood === 'end' || mood === 'menu' || want === 'menu' || step % 16 === 0)) {
      if (mood === 'end' || mood === 'menu') restartSong();
      mood = want;
      applyMood(now);
    }
    if (!!state.paused !== ducked) { ducked = !!state.paused; applyMood(now); }

    if (nextT < now) nextT = now + 0.05;              // fell behind (tab was hidden)
    while (nextT < now + 0.2) {
      playStep(step, nextT);
      step++;
      nextT += 60 / song.bpm / 4;
    }

    // Ambient events
    if (amb && now >= ambNext) {
      amb.def.event(now + 0.02);
      const [a, b] = amb.def.every;
      ambNext = now + a + Math.random() * (b - a);
    }

    // Laser hum while any beam is on
    const playing = !state.paused && ph === 'fight';
    let beams = 0, pan = 0;
    if (playing) for (const t of state.towers) if (t.beamActive) { beams++; pan += panAt(t.x, t.y); }
    glide(laser.gain.gain, beams ? 0.04 + 0.02 * Math.min(beams, 4) : 0, 0.04);
    if (beams) glide(laser.pan.pan, pan / beams, 0.1, 0.02);

    // Portal hum, swelling in fights and after a Boss entrance. Its pan follows the camera,
    // re-checked a few times a second.
    const wp = PATH_WAYPOINTS[0];
    portalPanT -= rawDt;
    if (wp && portalPanT <= 0) { portalPanT = 0.25; glide(portal.pan.pan, panAt(wp.x, wp.y), 0.3, 0.02); }
    portal.surge = Math.max(0, portal.surge - rawDt * 0.5);
    const hum = ph === 'menu' || ph === 'gameover' || ph === 'victory' ? 0
              : (bossAlive ? 0.09 : ph === 'fight' ? 0.06 : 0.03) + portal.surge * 0.2;
    glide(portal.gain.gain, hum, 0.5);

    // Countdown ticks for the last three seconds
    if (ph === 'countdown' && !state.paused) {
      const c = Math.ceil(state.countdown);
      if (c <= 3 && c >= 1 && c !== lastTick) {
        const d = out(0);
        osc(d, now, { f: c === 1 ? 1320 : 990, dur: 0.09, vol: 0.12 });
        nz(d, now, { dur: 0.02, vol: 0.05, ft: 'highpass', f: 4000 });
      }
      lastTick = c;
    } else if (ph !== 'countdown') lastTick = 0;   // kept while paused, so resuming doesn't re-tick

    // Healer shimmer every couple of seconds while one is on the field
    if (playing) {
      healT -= rawDt * state.speed;
      if (healT <= 0) {
        healT = 2.4;
        const h = state.enemies.find(e => e.type === 'Healer');
        if (h) {
          const d = out(h.x, h.y, 0.5);
          [1760, 2217, 2637].forEach((f, i) => osc(d, now + i * 0.07, { f, dur: 0.4, vol: 0.022, at: 0.02 }));
        }
      }
    }
  }

  // ─── API ─────────────────────────────────────────────────────────────────────
  function setVolume(kind, v) {
    vol[kind] = clamp01(v);
    try { localStorage.setItem('td_vol', JSON.stringify(vol)); } catch (_) {}
    if (!ctx) return;
    if (kind === 'music') musicBus.gain.setTargetAtTime(vol.music * 0.7, ctx.currentTime, 0.05);
    else sfxBus.gain.setTargetAtTime(vol.sfx, ctx.currentTime, 0.05);
  }

  // A short sound at the centre: stingers and UI
  function ui(fn) {
    if (!ready(true)) return;
    fn(out(0, undefined, 0.2), ctx.currentTime);
  }

  return {
    get muted() { return muted; },
    set muted(v) {
      muted = v;
      try { localStorage.setItem('td_muted', v ? '1' : '0'); } catch (_) {}
      if (!ctx) return;
      master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.02);
      if (v) setTimeout(() => { if (muted) ctx.suspend(); }, 100);
      else if (!document.hidden) ctx.resume();
    },
    get musicVolume() { return vol.music; },
    set musicVolume(v) { setVolume('music', v); },
    get sfxVolume() { return vol.sfx; },
    set sfxVolume(v) { setVolume('sfx', v); },

    init, update,
    // Restart the song from bar 1 (quitting to the menu). Entering a map, pausing and the
    // end screens are handled by update() from the game state.
    stopMusic: restartSong,

    shoot(type, x, y) {
      if (!ready() || !SHOTS[type]) return;
      const t = ctx.currentTime;
      if (t - (lastShot[type] || 0) < SHOT_GAP[type]) return;
      lastShot[type] = t;
      SHOTS[type](out(x, y, type === 'Cannon' || type === 'Sniper' ? 0.25 : 0.1), t, vary());
    },

    // A projectile reaching its target
    hit(source, x, y) {
      if (!ready()) return;
      const t = ctx.currentTime, key = source === 'Freeze' ? 'hitF' : 'hit';
      if (t - (lastShot[key] || 0) < 0.04) return;
      lastShot[key] = t;
      const d = out(x, y, 0.1);
      if (source === 'Freeze') {
        for (let i = 0; i < 4; i++)
          osc(d, t + Math.random() * 0.05, { f: 2000 + Math.random() * 2200, dur: 0.06 + Math.random() * 0.07, vol: 0.035 });
        nz(d, t, { dur: 0.1, vol: 0.07, ft: 'highpass', f: 4000 });
      } else if (source === 'Sniper') {
        nz(d, t, { dur: 0.08, vol: 0.16, ft: 'lowpass', f: 1600 });
      } else {
        nz(d, t, { dur: 0.025, vol: 0.06, f: 3500 * vary(0.15), q: 1.5 });
      }
    },

    explosion(x, y) {
      if (!ready()) return;
      const t = ctx.currentTime;
      if (t - (lastShot.boom || 0) < 0.05) return;
      lastShot.boom = t;
      boom(out(x, y, 0.35), t, vary(0.1));
    },

    enemyDeath(type, x, y) {
      const fn = DEATHS[type] || DEATHS.Scout, big = type === 'Boss' || type === 'Tank';
      if (!ready(type === 'Boss')) return;
      const t = ctx.currentTime;
      if (!big && t - (lastDeath[type] || 0) < 0.03) return;
      lastDeath[type] = t;
      fn(out(x, y, big ? 0.35 : 0.1), t, vary());
    },

    bossRoar(x, y) {
      if (!ready(true)) return;
      const t = ctx.currentTime, d = out(x, y, 0.5);
      for (const [f, det] of [[72, -10], [72, 10], [108, 0]])
        osc(d, t + 0.15, { f, f2: f * 0.62, type: 'sawtooth', detune: det, dur: 1.6, vol: 0.14, at: 0.25, lp: 500, lp2: 220 });
      nz(d, t, { dur: 1.9, vol: 0.35, at: 0.3, ft: 'lowpass', f: 160, q: 1.2 });
      osc(d, t, { f: 60, f2: 240, dur: 1.0, vol: 0.08, at: 0.4 });      // portal surge
      portal.surge = 1;
    },

    // A Boss foot landing
    stomp(x, y) {
      if (!ready()) return;
      const t = ctx.currentTime, d = out(x, y, 0.2);
      osc(d, t, { f: 65, f2: 32, dur: 0.26, vol: 0.32 });
      nz(d, t, { dur: 0.2, vol: 0.16, ft: 'lowpass', f: 260 });
    },

    lifeLost() {
      ui((d, t) => {
        osc(d, t, { f: 330, f2: 220, type: 'triangle', dur: 0.35, vol: 0.22 });
        osc(d, t + 0.15, { f: 247, f2: 165, type: 'triangle', dur: 0.45, vol: 0.2 });
        osc(d, t, { f: 82, dur: 0.6, vol: 0.18 });
      });
    },

    towerPlace(x, y) {
      if (!ready(true)) return;
      const t = ctx.currentTime, d = out(x, y, 0.15);
      osc(d, t, { f: 150, f2: 55, dur: 0.18, vol: 0.35 });
      nz(d, t, { dur: 0.1, vol: 0.16, ft: 'lowpass', f: 900 });
      nz(d, t + 0.06, { dur: 0.03, vol: 0.06, f: 3000 });
    },

    upgrade() {
      ui((d, t) => {
        [523, 659, 784, 1047].forEach((f, i) => osc(d, t + i * 0.06, { f, type: 'triangle', dur: 0.22, vol: 0.12 }));
        nz(d, t + 0.18, { dur: 0.35, vol: 0.04, at: 0.05, ft: 'highpass', f: 6000 });
      });
    },

    sell() {
      ui((d, t) => {
        [1568, 1319, 1047].forEach((f, i) => osc(d, t + i * 0.05, { f, dur: 0.12, vol: 0.08 }));
        osc(d, t, { f: 220, f2: 140, type: 'triangle', dur: 0.18, vol: 0.12 });
      });
    },

    // A war-horn call
    waveStart() {
      ui((d, t) => {
        for (const [f, at, len] of [[196, 0, 0.35], [294, 0.32, 0.6]])
          for (const det of [-8, 8])
            osc(d, t + at, { f, type: 'sawtooth', detune: det, dur: len, vol: 0.07, at: 0.06, lp: 500, lp2: 1800 });
      });
    },

    waveComplete() {
      ui((d, t) => {
        [523, 659, 784, 1047].forEach((f, i) => {
          osc(d, t + i * 0.1, { f, type: 'triangle', dur: 0.3, vol: 0.12 });
          osc(d, t + i * 0.1, { f: f * 2.76, dur: 0.25, vol: 0.02 });
        });
      });
    },

    income() {
      ui((d, t) => {
        osc(d, t, { f: 1319, dur: 0.12, vol: 0.08 });
        osc(d, t + 0.07, { f: 1760, dur: 0.18, vol: 0.08 });
      });
    },

    gameOver() {
      ui((d, t) => {
        [392, 330, 262, 196].forEach((f, i) =>
          osc(d, t + i * 0.28, { f, type: 'sawtooth', dur: 0.5, vol: 0.08, lp: 1200, lp2: 400 }));
        osc(d, t + 0.8, { f: 65, dur: 1.8, vol: 0.25, at: 0.2 });
      });
    },

    victory() {
      ui((d, t) => {
        [523, 659, 784].forEach((f, i) => osc(d, t + i * 0.12, { f, type: 'triangle', dur: 0.25, vol: 0.14 }));
        for (const f of [523, 659, 784, 1047])
          for (const det of [-6, 6])
            osc(d, t + 0.4, { f, type: 'sawtooth', detune: det, dur: 1.4, vol: 0.035, at: 0.05, lp: 2500, lp2: 900 });
      });
    },

    click() {
      ui((d, t) => {
        osc(d, t, { f: 1200, dur: 0.035, vol: 0.05 });
        nz(d, t, { dur: 0.015, vol: 0.03, ft: 'highpass', f: 4000 });
      });
    },

    // For testing in the console: the context, master gain and live voice count
    get debug() { return { ctx, master, voices }; },
  };
})();
