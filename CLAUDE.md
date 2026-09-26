# Tower Defense — Project Context

Vanilla HTML5 Canvas tower defense game. No frameworks, no build step, no dependencies.
All game logic is plain JS loaded via `<script>` tags in `index.html`.

## Running / Previewing

**Browser:** open `index.html` directly — works fine over `file://`.

**Preview tool:** the sandbox cannot `open()` files from the project directory directly
(PermissionError even though `os.path.exists()` returns True). Workflow every session:

```bash
# 1. Sync files to /tmp where the sandbox CAN read them
rm -rf /tmp/td-game && cp -R "/Users/dj/Documents/Codes/Tower Defense Claude" /tmp/td-game

# 2. Start preview server (launch.json already configured)
# preview_start("tower-defense")  →  port 3333
```

`dev/serve.py` is the local HTTP server (gitignored). `/tmp/td-serve.py` is what the
preview tool actually executes — it serves from `/tmp/td-game`.

**Clicking in preview:** the canvas is 1480×896 but displayed smaller. Use this formula
to convert game coordinates to clientX/Y for `MouseEvent` dispatch:

```js
const r  = canvas.getBoundingClientRect();
const sx = r.width  / canvas.width;   // ≈ 0.439
const sy = r.height / canvas.height;
clientX  = r.left + gameX * sx;
clientY  = r.top  + gameY * sy;
```

**Starting a wave in eval:** `requestAnimationFrame` pauses when the preview tab loses
focus during an eval call. Call `startWave()` directly — it's a global.

## Canvas / Layout Constants

Defined in `map.js` (loaded first):

```
TILE_SIZE = 64       (baseline: 48px — scale factor _TS = TILE_SIZE/48 in towers.js)
COLS      = 20
ROWS      = 14
UI_WIDTH  = 200
CANVAS_W  = 1480     (COLS*TILE_SIZE + UI_WIDTH)
CANVAS_H  = 896      (ROWS*TILE_SIZE)
```

UI panel starts at `UI_X = COLS * TILE_SIZE = 1280`.

UI layout (from `ui.js`):
```
STATS_Y      = 10
TOWER_BTNS_Y = 128   (7 buttons × TOWER_BTN_H(38) = 266px)
TOWER_INFO_Y = 402   (TOWER_BTNS_Y + 7*38 + 8)
CONTROLS_Y   = CANVAS_H - 142
```

## Script Load Order

```
audio.js → particles.js → map.js → enemies.js → towers.js → waves.js → ui.js → game.js
```

Each file can reference globals defined in earlier files.
`_TS` (tower scale) is in towers.js. `_ES` (enemy scale) is in enemies.js.

## Game State

All runtime state lives in one object created by `makeState(mapIndex)` in `game.js`.
Key fields:

```js
state.phase             // 'menu' | 'build' | 'countdown' | 'fight' | 'gameover' | 'victory'
state.waveIndex         // 0-based, increments after each wave completes
state.endlessMode       // bool — waves beyond index 20 use generateEndlessWave()
state.towers[]          // Tower instances
state.enemies[]         // Enemy instances (alive only)
state.projectiles[]
state.particles[]       // Particle instances (death bursts, confetti, etc.)
state.floatingTexts[]   // FloatingText instances (damage numbers)
state.spawnQueue[]      // [{type, delay}] for current wave
state.spawnRipples[]    // SpawnRipple instances at entry tile
state.ambientParticles[]// AmbientParticle instances (dust + fireflies)
state.selectedTower     // Tower | null
state.selectedTowerType // string | null (build mode)
state.countdown         // seconds remaining in countdown phase
state.waveModifier      // 'Armored' | 'Haste' | 'Swarm' | null
```

## Tower System

Defined in `TOWER_DEFS` (towers.js). All 7 types:

| Key    | Cost | Damage | Rate  | Range | Special |
|--------|------|--------|-------|-------|---------|
| Basic  | 50   | 25     | 1.0/s | 2.2   | —       |
| Sniper | 100  | 85     | 0.5/s | 4.0   | —       |
| Cannon | 125  | 50     | 0.75/s| 2.5   | AOE 1.1 tiles |
| Freeze | 75   | 5      | 1.5/s | 2.0   | 50% slow |
| Rapid  | 80   | 8      | 4.0/s | 1.5   | —       |
| Laser  | 110  | 30     | beam  | 3.0   | Continuous piercing beam |
| Tesla  | 100  | 40     | 0.8/s | 2.5   | Chain lightning (3 hops) |

Range is stored in tile units in TOWER_DEFS; `tower.range` getter multiplies by TILE_SIZE.
Upgrades: level 1→2 costs `cost*0.5`, level 2→3 costs `cost`. Max level 3.
Sell value = `invested * 0.6`.

**Laser** fires a continuous beam every frame (no projectile). Uses dot/cross product to
test each enemy against the beam line. `tower.beamActive` drives the visual.

**Tesla** fires a burst then chains to up to 3 nearby enemies within `1.5*TILE_SIZE`.
`TESLA_CHAIN_MULTS = [0.6, 0.35, 0.2]` — damage decay per hop.
`tower.chainPoints` stores the bolt path; `tower.chainTimer` drives the visual fade (0.18s).

**Recoil animation:** `recoilAnim = 0.12` set on fire. In draw methods, barrel is
translated `-(recoilAnim/0.12) * N * _TS` pixels backward along the rotated local axis.
Recoil amounts: Basic 5px, Sniper 7px, Cannon 6px, Rapid 3px.

**Per-tower stats:** `tower.totalDamage` and `tower.killCount`.
Kill credit: `e.lastHitTower` is set on every hit; checked when enemy dies.

## Enemy System

`ENEMY_DEFS` in enemies.js. Types: Scout, Soldier, Tank, Speeder, Healer, Boss.
`_ES = TILE_SIZE / 48` scales radii.

Movement: enemies follow `PATH_WAYPOINTS[]` (pixel coords derived from map waypoints).
`e.progress` = waypoint index reached (used for tower targeting priority).
`e.escaped = true` when reaching the last waypoint → player loses a life.

Wave modifiers applied at spawn:
- `Haste`: `speed *= 1.4`
- `Armored`: `e.waveArmored = true` (50% damage reduction in `takeDamage`)
- `Swarm`: `hp *= 0.5`, but double count spawned

Endless HP scaling: `scale = 1 + tier * ENDLESS_HP_SCALE` where `ENDLESS_HP_SCALE = 0.12`.

## Waves

`WAVES` array: 20 hand-crafted waves. Beyond that, `generateEndlessWave(waveIndex)`
produces procedural waves in 5 rotating patterns (0=boss assault, 1=speeder swarm,
2=tank wall, 3=soldier horde, 4=mixed).

`waveIncome(waveIndex)` = `25 + waveIndex * 3` gold on wave clear (0-based index).
Early send bonus: `Math.floor(state.countdown * 5)` gold.

## Particles

- `Particle` — base class (position, velocity, gravity, fade)
- `AmbientParticle` — persistent dust/firefly, reinits on expiry
- `SpawnRipple` — expanding ring at enemy entry tile
- `spawnDeathParticles(x, y, color, enemyType)` — type-specific bursts
- `spawnBossDeathParticles(x, y)` — dramatic multi-burst
- `spawnExplosionParticles(x, y)` — Cannon AOE
- `spawnVictoryParticles()` — 110 upward confetti (drawn AFTER victory overlay)
- `spawnEnemyBirthParticles(x, y, color)` — on spawn
- `spawnPlacementParticles(col, row)` — on tower placement

Victory confetti is intentionally skipped in the main draw loop and redrawn after
`drawVictory()` so it appears on top of the overlay.

## UI Rendering

All drawn with `ctx.save/restore`. No DOM elements except the `<canvas>` itself.

`drawUI()` → `drawStats()` + `drawTowerButtons()` + `drawTowerInfo()` + `drawControls()`

Click detection mirrors drawing coordinates exactly (same constants, same math).
`handleMenuClick()`, `handleSidebarClick()`, `handleTowerActionClick()` in game.js.
`canvasXY(clientX, clientY)` converts browser coords → game coords via `getBoundingClientRect`.

Menu map cards: `perRow=4`, `cardW=210`, `cardH=172`, `gapX=18`, `gapY=14`, `startY=164`.

Tower info panel height = 236px. Priority buttons at `iy+105`, upgrade at `iy+159`,
sell at `iy+194`. Two-click sell confirmation with 2.5s timeout.

## Visual Effects

- **Screen shake:** `state.shake` — triggers on Boss death and AOE. Applies `ctx.translate`
  to game world only (not UI/overlays).
- **Flash:** `state.flashTimer = 0.4` — white rect over game area, alpha fades out.
- **Danger border:** 4 gradient edge strips, alpha = `Math.sin(Date.now()/220)` pulsing.
  Shown when `state.lives <= 5`.
- **Boss HP bar:** smooth `displayHp` interpolation toward actual `hp`. Drawn below
  wave banner, above game area.
- **Wave banner:** `state.banner` + `state.bannerTimer`. Centered above game area.

## Audio

`Audio` object in audio.js. Web Audio API, initialised on first user interaction.
Methods: `shoot(type)`, `enemyDeath(isBoss)`, `lifeLost()`, `income()`, `upgrade()`,
`sell()`, `towerPlace()`, `waveStart()`, `waveComplete()`, `gameOver()`, `victory()`,
`startMusic()`, `stopMusic()`, `pauseMusic()`, `resumeMusic()`.
`Audio.muted` getter/setter.

## Save System

`saveGame()` / `loadSave()` / `hasSave()` / `clearSave()` use `localStorage('td_save')`.
Saves between waves (build/countdown phase only). Stores: mapIndex, difficulty, gold,
lives, waveIndex, tower list (type/col/row/level/priority/invested).

Leaderboard: `saveScore()` / `getScores()` → `'td_lb'` (top 10, regular).
`saveEndlessScore()` / `getEndlessScores()` → `'td_endless_lb'` (top 10, endless).

## Known Quirks

- `rAF` loop pauses when the preview tab loses focus during `preview_eval` calls.
  Use `startWave()` directly or trigger clicks via dispatched MouseEvents.
- The sandbox cannot read files from the project directory (`open()` gives PermissionError).
  Always `cp -R` to `/tmp/td-game` before starting the preview server.
- `TOWER_INFO_Y` is computed at module load time from `Object.keys(TOWER_DEFS).length`,
  so adding/removing towers automatically adjusts all panel positions.
