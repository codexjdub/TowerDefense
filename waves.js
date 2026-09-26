// Each wave is an array of groups: { type, count, interval }
// Groups spawn sequentially (group 2 starts after last enemy of group 1 is queued)
const WAVES = [
  /* 1  */ [{ type: 'Scout',   count: 10, interval: 1.0 }],
  /* 2  */ [{ type: 'Scout',   count: 8,  interval: 0.8 }, { type: 'Soldier', count: 3,  interval: 1.5 }],
  /* 3  */ [{ type: 'Soldier', count: 6,  interval: 1.2 }, { type: 'Scout',   count: 6,  interval: 0.6 }],
  /* 4  */ [{ type: 'Speeder', count: 8,  interval: 0.5 }, { type: 'Soldier', count: 4,  interval: 1.0 }],
  /* 5  */ [{ type: 'Scout',   count: 8,  interval: 0.5 }, { type: 'Boss',    count: 1,  interval: 0   }],
  /* 6  */ [{ type: 'Soldier', count: 8,  interval: 0.9 }, { type: 'Tank',    count: 2,  interval: 2.0 }],
  /* 7  */ [{ type: 'Speeder', count: 12, interval: 0.4 }, { type: 'Healer',  count: 2,  interval: 2.0 }],
  /* 8  */ [{ type: 'Tank',    count: 5,  interval: 1.5 }, { type: 'Scout',   count: 8,  interval: 0.4 }],
  /* 9  */ [{ type: 'Soldier', count: 10, interval: 0.6 }, { type: 'Speeder', count: 8,  interval: 0.3 }],
  /* 10 */ [{ type: 'Boss',    count: 1,  interval: 0   }, { type: 'Tank',    count: 4,  interval: 1.5 }, { type: 'Soldier', count: 8, interval: 0.5 }],
  /* 11 */ [{ type: 'Healer',  count: 3,  interval: 1.5 }, { type: 'Soldier', count: 12, interval: 0.5 }],
  /* 12 */ [{ type: 'Tank',    count: 6,  interval: 1.2 }, { type: 'Speeder', count: 10, interval: 0.3 }],
  /* 13 */ [{ type: 'Soldier', count: 14, interval: 0.4 }, { type: 'Healer',  count: 4,  interval: 1.0 }],
  /* 14 */ [{ type: 'Tank',    count: 8,  interval: 0.9 }, { type: 'Speeder', count: 14, interval: 0.3 }],
  /* 15 */ [{ type: 'Boss',    count: 1,  interval: 0   }, { type: 'Soldier', count: 10, interval: 0.4 }, { type: 'Tank', count: 5, interval: 1.0 }],
  /* 16 */ [{ type: 'Tank',    count: 10, interval: 0.8 }, { type: 'Healer',  count: 5,  interval: 1.0 }],
  /* 17 */ [{ type: 'Speeder', count: 20, interval: 0.25 }, { type: 'Soldier', count: 15, interval: 0.3 }],
  /* 18 */ [{ type: 'Tank',    count: 12, interval: 0.7 }, { type: 'Boss',    count: 1,  interval: 0   }],
  /* 19 */ [{ type: 'Soldier', count: 20, interval: 0.25 }, { type: 'Tank', count: 10, interval: 0.5 }, { type: 'Healer', count: 5, interval: 0.8 }],
  /* 20 */ [{ type: 'Boss',    count: 3,  interval: 3.0 }, { type: 'Tank', count: 15, interval: 0.4 }, { type: 'Speeder', count: 20, interval: 0.2 }],
];

// Wave modifiers — applied on top of the base wave definition
// Armored: enemies take 50% damage  |  Haste: 40% faster  |  Swarm: 2× count ½ HP
const WAVE_MODIFIERS = [
  null, null, 'Haste', null, null,           // waves 1-5   (Boss on 5)
  'Swarm', 'Haste', 'Armored', null, null,   // waves 6-10  (Boss on 10)
  'Swarm', 'Haste', 'Armored', 'Swarm', null, // waves 11-15 (Boss on 15)
  'Haste', 'Armored', 'Swarm', 'Haste', null, // waves 16-20 (Boss finale on 20)
];

// Endless modifier cycle — harder than the base game
const ENDLESS_MODIFIERS = ['Armored', 'Haste', 'Swarm', 'Armored', null,
                            'Haste',   'Swarm', 'Armored', 'Haste',  null];

function getWaveModifier(waveIndex) {
  if (waveIndex >= WAVES.length) {
    return ENDLESS_MODIFIERS[(waveIndex - WAVES.length) % ENDLESS_MODIFIERS.length];
  }
  return WAVE_MODIFIERS[waveIndex] || null;
}

// ─── Procedural endless wave generator ───────────────────────────────────────
function generateEndlessWave(waveIndex) {
  const tier     = waveIndex - WAVES.length + 1;          // 1, 2, 3 …
  const bossCnt  = Math.min(1 + Math.floor((tier - 1) / 5), 5); // more bosses every 5 tiers
  const cap      = n => Math.min(n, 55);                  // never more than 55 per group
  const pattern  = tier % 5;

  if (pattern === 0) {
    // Every 5th tier: all-out Boss assault
    return [
      { type: 'Boss',    count: cap(bossCnt + 1),        interval: 2.2  },
      { type: 'Tank',    count: cap(12 + tier * 2),      interval: 0.38 },
      { type: 'Soldier', count: cap(18 + tier * 2),      interval: 0.22 },
      { type: 'Healer',  count: cap(4 + Math.floor(tier / 3)), interval: 0.8 },
    ];
  } else if (pattern === 1) {
    // Speeder + Scout swarm
    return [
      { type: 'Speeder', count: cap(22 + tier * 3),      interval: 0.15 },
      { type: 'Scout',   count: cap(15 + tier * 2),      interval: 0.20 },
      { type: 'Healer',  count: cap(3 + Math.floor(tier / 2)), interval: 0.7 },
    ];
  } else if (pattern === 2) {
    // Tank wall + Boss
    return [
      { type: 'Tank',    count: cap(10 + tier * 2),      interval: 0.55 },
      { type: 'Speeder', count: cap(18 + tier),           interval: 0.22 },
      { type: 'Boss',    count: bossCnt,                  interval: 3.0  },
    ];
  } else if (pattern === 3) {
    // Soldier + Healer horde
    return [
      { type: 'Soldier', count: cap(20 + tier * 3),      interval: 0.20 },
      { type: 'Healer',  count: cap(5 + Math.floor(tier / 2)), interval: 0.6 },
      { type: 'Tank',    count: cap(8 + tier),            interval: 0.60 },
    ];
  } else {
    // Mixed: Tanks + Speeders + Boss
    return [
      { type: 'Tank',    count: cap(8 + tier * 2),       interval: 0.50 },
      { type: 'Speeder', count: cap(20 + tier * 2),      interval: 0.18 },
      { type: 'Boss',    count: bossCnt,                  interval: 2.5  },
      { type: 'Soldier', count: cap(15 + tier),           interval: 0.30 },
    ];
  }
}

// Gold awarded for completing a wave (0-based wave index)
function waveIncome(waveIndex) {
  return 25 + waveIndex * 3;
}

// Returns [{type, count}] summary for the given wave index (used for wave preview)
function getWavePreview(waveIndex) {
  const wave = waveIndex < WAVES.length ? WAVES[waveIndex] : generateEndlessWave(waveIndex);
  const counts = {};
  for (const group of wave) {
    counts[group.type] = (counts[group.type] || 0) + group.count;
  }
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

// Flatten a wave definition into a time-ordered spawn queue
function buildSpawnQueue(waveIndex) {
  const wave  = waveIndex < WAVES.length ? WAVES[waveIndex] : generateEndlessWave(waveIndex);
  const queue = [];
  let time    = 0;

  for (const group of wave) {
    for (let i = 0; i < group.count; i++) {
      queue.push({ type: group.type, delay: time });
      time += group.interval;
    }
    // Small gap between groups
    time += 0.3;
  }

  return queue;
}
