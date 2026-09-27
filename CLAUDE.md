# Tower Defense — Project Context

Vanilla JS tower defense game. No frameworks, no build step, no package manager.
All code is plain JS loaded via classic `<script>` tags in `index.html`, sharing globals.

The game area is a 3D scene rendered with **Three.js r128**, vendored at
`vendor/three.min.js` so the game works offline. Use r128 (or anything before r160):
later releases dropped the UMD build, and ES modules don't load over `file://`.
The sidebar, menus and overlays are still drawn on a 2D canvas on top.

The last 2D-only version is commit `7907820` (the `main` branch when the 3D work began).

## Running / Previewing

**Browser:** open `index.html` directly — works fine over `file://`, no network needed.

**Preview tool:** the sandbox cannot `open()` files from the project directory directly
(PermissionError even though `os.path.exists()` returns True). Workflow every session:

```bash
# 1. Sync files to /tmp where the sandbox CAN read them (re-run after every edit)
rsync -a --delete --exclude .git "/Users/dj/Documents/Code/Tower Defense Claude/" /tmp/td-game/

# 2. Start preview server (launch.json already configured)
# preview_start("tower-defense")  →  port 3333
```

`dev/serve.py` is the local HTTP server (gitignored). `/tmp/td-serve.py` is what the
preview tool actually executes — it serves from `/tmp/td-game`.

**Stale JS in preview:** the browser caches scripts. After syncing, run
`await fetch('/game.js', {cache:'reload'})` (for each changed file) and then
`location.reload()`. Console messages also survive reloads, so an old error can look new.

**rAF pauses** while the preview tab is hidden or during an eval call. To advance the game
from eval, drive the loop by hand:

```js
window.step = n => { for (let i = 0; i < n; i++) { update(1/60); draw(1/60); } };
startWave(); step(600);   // 10 s of game time
```

Keep eval snippets short: long ones fail with "Internal error".

**Clicking in preview:** the canvas backing store is scaled by devicePixelRatio, so
`canvas.width` is *not* the logical width. Convert logical game coords with
`CANVAS_W`/`CANVAS_H`:

```js
const r  = canvas.getBoundingClientRect();
clientX  = r.left + gameX * (r.width  / CANVAS_W);
clientY  = r.top  + gameY * (r.height / CANVAS_H);
```

That works for the sidebar and menus. Map tiles are picked by raycasting into the 3D scene,
so a tile's screen position depends on the camera. Get it with
`Render3D.project(pixelX, pixelY, 0.18)` (tile centre, grass height; returns logical px),
then convert as above — after the camera has finished easing in (≈1 s after leaving the
menu). Or skip the mouse: set `state.selectedTowerType` and call `placeTower(col, row)`.

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

These are *logical* sizes. `fitCanvas()` (game.js) scales both canvases to fill the window
and sizes their backing stores at up to 2× devicePixelRatio (it also reruns when the
pixel ratio changes); `draw()` applies `ctx.setTransform(renderScale, …)` so all 2D code
keeps using logical coordinates. The WebGL buffer is further capped at ~4M pixels
(`MAX_PIXELS` in render3d.js) so big HiDPI screens stay fast.

Two stacked canvases:
- `#scene3d` — WebGL, covers only the game area (logical 0–1280 × 0–896)
- `#gameCanvas` — 2D, full width, `z-index: 1`. Cleared to transparent each frame; draws
  the sidebar, overlays, HP bars and damage numbers. Receives all input.

UI layout (from `ui.js`):
```
STATS_Y      = 10
TOWER_BTNS_Y = 128   (7 buttons × TOWER_BTN_H(38) = 266px)
TOWER_INFO_Y = 402   (TOWER_BTNS_Y + 7*38 + 8)
CONTROLS_Y   = CANVAS_H - 142
```

## Script Load Order

```
audio.js → particles.js → map.js → enemies.js → towers.js → waves.js
  → vendor/three.min.js → render3d.js → ui.js → game.js
```

Each file can reference globals defined in earlier files (functions in later files are
fine to call at runtime, e.g. render3d.js uses `roundRect` from ui.js inside draw calls).
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
state.particles[]       // Particle instances — victory confetti only
state.floatingTexts[]   // FloatingText instances (damage numbers)
state.spawnQueue[]      // [{type, delay}] for current wave
state.selectedTower     // Tower | null
state.selectedTowerType // string | null (build mode)
state.mouseCol/mouseRow // tile under the pointer (raycast, re-picked every frame), -1 when none
state.countdown         // seconds remaining in countdown phase
state.waveModifier      // 'Armored' | 'Haste' | 'Swarm' | null
state.paused, state.speed
state.shake             // {x, y, timer, duration, intensity} — camera shake, game pixels
state.flashTimer        // boss-death white flash
```

Game logic works in 2D pixel coordinates (x, y on the 1280×896 map). Only render3d.js
knows about 3D.

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
`canPlaceTower(col, row, type)` (game.js) is the single placement rule, used by
`placeTower()` and by the 3D placement preview.

towers.js holds only data and logic (`Tower`, `Projectile`, `FloatingText`); all tower
visuals are in render3d.js.

**Laser** fires a continuous beam every frame (no projectile). Uses dot/cross product to
test each enemy against the beam line. `tower.beamActive` drives the 3D beam; game.js
clears it on game over, since towers stop updating then.

**Tesla** fires a burst then chains to up to 3 nearby enemies within `1.5*TILE_SIZE`.
`TESLA_CHAIN_MULTS = [0.6, 0.35, 0.2]` — damage decay per hop.
`tower.chainPoints` stores the bolt path; `tower.chainTimer` drives the visual fade (0.18s).

**Visual timers** (`flashTimer`, `recoilAnim`, `chainTimer`, `placementAnim`) are ticked
only by `Tower.tickVisuals(dt, rawDt)`, which game.js calls every frame in every phase —
`Tower.update` only runs during fights, so ticking them there left effects frozen on
screen between waves. render3d.js reads them:
- `recoilAnim = 0.12` on fire — the model's recoil group slides back by
  `(recoilAnim/0.12) * recoilDist` (per-type distance in render3d's `BUILD` table).
- `placementAnim = 0.38` on placement — scale bounce 0 → 1.25 → 1. Uses real time, so a
  tower placed while paused still appears.

**Per-tower stats:** `tower.totalDamage` and `tower.killCount`.
Kill credit: `e.lastHitTower` is set on every hit; checked when enemy dies.

## Enemy System

`ENEMY_DEFS` in enemies.js. Types: Scout, Soldier, Tank, Speeder, Healer, Boss.
`_ES = TILE_SIZE / 48` scales radii (used for hit tests).

Movement: enemies follow `PATH_WAYPOINTS[]` (pixel coords derived from map waypoints).
`e.progress` = waypoint index reached (used for tower targeting priority).
`e.escaped = true` when reaching the last waypoint → player loses a life.
`e.displayHp` eases toward `e.hp` for the HP bars. It must start at the adjusted HP after
spawn modifiers (game.js sets `e.displayHp = e.hp`), otherwise it exceeds `maxHp`.

Wave modifiers applied at spawn:
- `Haste`: `speed *= 1.4`
- `Armored`: `e.waveArmored = true` (50% damage reduction in `takeDamage`)
- `Swarm`: `hp *= 0.5`, but double count spawned

Endless HP scaling: `scale = 1 + tier * ENDLESS_HP_SCALE` where `ENDLESS_HP_SCALE = 0.12`.

## Maps

`MAP_CONFIGS` in map.js: 12 maps, each `{ name, difficulty, diffColor, desc, waypoints }`.
The difficulty label is display-only. Everything else (path tiles, 3D island, road,
scenery, portal, castle, menu thumbnail) is derived from the waypoints. Rules for new maps:
- Waypoints are tile coords (`col` 0–19, `row` 0–13); consecutive waypoints must share a
  row or a column (straight segments only).
- The first waypoint must be on a board edge with the first segment pointing away from
  that edge, and the last must be on an edge with the last segment pointing toward it.
  The portal and castle go in the border ring, one tile beyond the path's ends.
- Keep a grass row/column between parallel segments, or they merge into a 2-wide road.
  Crossings are fine (Spiral, Crossroads).
- Append new maps at the end: saves store `mapIndex`, so reordering breaks them.
- Entrances and exits can be on any edge. The default camera is set back far enough that
  a portal or castle at the island's front corners stays in view.

## Waves

`WAVES` array: 20 hand-crafted waves. Beyond that, `generateEndlessWave(waveIndex)`
produces procedural waves in 5 rotating patterns (0=boss assault, 1=speeder swarm,
2=tank wall, 3=soldier horde, 4=mixed).

`waveIncome(waveIndex)` = `25 + waveIndex * 3` gold on wave clear (0-based index).
Early send bonus: `Math.floor(state.countdown * 5)` gold.

## 3D Renderer (render3d.js)

`Render3D` is an IIFE. If `THREE` is missing or WebGL fails it returns a no-op stub with
`ok: false`, and `draw()` shows an error message in the game area instead of crashing.

It only **reads** game state. Each frame `Render3D.render(state, rawDt)`:
1. Rebuilds the map (ground, road, scenery, portal, gatehouse) when
   `PATH_WAYPOINTS_TILES` changes identity, i.e. after `setMap()`.
2. Syncs towers / enemies / projectiles into view Maps keyed by the game object: a view is
   built the first time an object appears and disposed when it's gone. A tower's model is
   rebuilt when its level changes.
3. Updates the placement ghost and range rings, laser/lightning ribbons, particle pools,
   portal and camera, then renders.

**World coordinates:** one tile = one unit; game pixel (x, y) → world
(`x/TILE_SIZE - COLS/2`, height, `y/TILE_SIZE - ROWS/2`), +Y up. Road at y 0, grass at
`GRASS_Y = 0.18`, island bottom at -1.6, with a one-tile border ring around the board.

**Assets:** none. Textures (grass, road, cliffs, portal swirl, glows) are painted on
canvases at startup; models are low-poly Phong primitives built in code (`BUILD` table for
towers, `buildEnemy`). Reused geometries/materials go through `G(key, fn)` / the `SHARED`
set, which `disposeTree()` skips.

**Event hooks** called from game.js: `onSpawn(e)`, `onDeath(e)`, `onEscape(e)`,
`onExplosion(x, y)` (Cannon AOE), `onPlace(t)`, `onUpgrade(t)`, `onSell(t)`. Add new
effects here rather than in game logic. Effect pools: `sparks` (Points), `debris`
(InstancedMesh), `smoke` / `flashes` / `rings` / `decals` (sprite pools), `fireflies`.

**Input:** `pickTile(clientX, clientY)` raycasts the grass, road and tower models (ignoring
glow sprites, which Three.js would hit even where transparent) and returns `{col, row}` or
null. game.js wraps it in `tileAt()`, which returns null over the sidebar or the menu.
`updateHoverTile()` re-picks the hovered tile from the last pointer position every frame,
since the camera can move while the pointer doesn't. `handleClick(mx, my, tile)` gets both
the logical point (for UI) and the picked tile (for the map).

**Overlay:** `drawOverlay(ctx, state)` draws enemy HP bars (only once damaged; the boss
always) and floating damage numbers on the 2D canvas at `project(x, y, h)` positions.

**Camera:** eases `cam` toward `goal` (target, radius, azimuth `th`, polar `ph`).
`HOME` is the default framing; the game area's aspect ratio is fixed (letterboxed), so it
fits every window. Right-drag → `orbit()`, wheel → `zoom()` (radius 9–40, wheel deltas
normalized to pixels), `C` → `resetCamera()`. The menu shows a slow turntable (disabled
under `prefers-reduced-motion`). `state.shake` offsets the camera.

## 2D Overlay / UI Rendering

All drawn with `ctx.save/restore` on `#gameCanvas`. No DOM UI.

`drawUI()` → `drawStats()` + `drawTowerButtons()` + `drawTowerInfo()` + `drawControls()`

Draw order in `draw()`: 3D render → clear 2D → menu (returns early) → HP bars / damage
numbers → flash → danger border → countdown → sidebar → boss HP bar → wave banner →
pause → game over / victory (+ confetti) → hotkeys → FPS.

Click detection mirrors drawing coordinates exactly (same constants, same math).
`handleClick()` (menu branch at the top, then the map), `handleSidebarClick()`,
`handleTowerActionClick()` in game.js.
`canvasXY(clientX, clientY)` converts browser coords → logical coords via `getBoundingClientRect`.

Right mouse: drag orbits the camera; a click without dragging cancels placement/selection.

Menu map cards: laid out by `MENU_CARDS` in ui.js (`perRow=6`, `w=210`, `h=172`, `gapX=18`,
`gapY=14`, `y=164`). Drawing, hover and clicks all use `menuCardPos(i)`, `menuCardAt(mx, my)`
and `menuCardsBottom()` (top of the resume button / leaderboard). 12 maps fill two rows;
a 13th map starts a third row, which pushes the leaderboard near the bottom edge.

Tower info panel height = 236px. Priority buttons at `iy+105`, upgrade at `iy+159`,
sell at `iy+194`. Two-click sell confirmation with 2.5s timeout.

`particles.js` now only holds `Particle`, `rand()` and `spawnVictoryParticles()` (110
confetti pieces, drawn after `drawVictory()` so they appear on top of the overlay).
`rand()` is also used by render3d.js.

## Visual Effects

- **Screen shake:** `state.shake` via `triggerShake()` — on Boss death and Cannon AOE.
  Applied as a camera offset in render3d.js; the UI doesn't shake.
- **Flash:** `state.flashTimer = 0.4` — white rect over game area, alpha fades out.
- **Danger border:** 4 gradient edge strips, alpha = `Math.sin(Date.now()/220)` pulsing.
  Shown when `state.lives <= 5`.
- **Boss HP bar:** smooth `displayHp` interpolation toward actual `hp`. Drawn below
  wave banner, above game area. Its gradient stops must stay within 0–1 (clamped), or
  `addColorStop` throws and freezes the game loop.
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

- `rAF` pauses when the preview tab is hidden or during eval calls — use the `step()`
  helper above, and don't trust a screenshot to show the latest frame.
- The sandbox cannot read files from the project directory (`open()` gives PermissionError).
  Always sync to `/tmp/td-game` before starting the preview server.
- `TOWER_INFO_Y` is computed at module load time from `Object.keys(TOWER_DEFS).length`,
  so adding/removing towers automatically adjusts all panel positions.
- Any exception inside `draw()` stops the game loop (the next `requestAnimationFrame` is
  never scheduled), which looks like a freeze. Check the console first.
