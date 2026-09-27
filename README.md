# Tower Defense

A browser-based tower defense game in vanilla JavaScript, with a 3D battlefield rendered
by [Three.js](https://threejs.org/). No build step, no install, and it runs offline.

## Play

**Online:** https://codexjdub.github.io/TowerDefense/

**Locally:** open `index.html` in a browser. Three.js is bundled in `vendor/`, so no internet
connection is needed. Requires a browser with WebGL.

## Features

- **12 maps** — S-Curve, Zigzag, Serpentine, Switchback, Crown, Figure-8, Twisted, Spiral,
  Descent, Horseshoe, Crossroads, Sprint
- **3 difficulty modes** — Beginner, Normal, Veteran
- **20 hand-crafted waves** + unlimited **Endless mode** with procedurally generated waves
- **7 tower types:**

| Tower | Description |
|---|---|
| Basic | Reliable single-target |
| Sniper | Long range, high damage |
| Cannon | AOE explosion on impact |
| Freeze | Slows enemies 50% |
| Rapid | Fast fire rate, short range |
| Laser | Continuous piercing beam |
| Tesla | Chain lightning hitting up to 4 enemies |

- **5 enemy types** — Scout, Soldier, Tank, Speeder, Healer — plus a Boss
- **Wave modifiers** — Armored, Haste, Swarm
- **Tower upgrades** up to level 3 (the tower model changes with each level)
- Per-tower damage and kill tracking
- Auto-save between waves with resume support
- Local leaderboard (regular + endless)
- 3D island map with a rotatable, zoomable camera
- Explosions, sparks, laser beams and chain lightning, floating damage numbers, screen shake

## Controls

| Input | Action |
|---|---|
| `1` – `7` | Select tower type |
| `Space` | Start wave / skip countdown (early gold bonus) |
| `U` | Upgrade selected tower |
| `P` | Pause / Resume |
| `Esc` | Deselect |
| Right-drag | Rotate camera |
| Scroll | Zoom camera |
| `C` | Reset camera |
| `F` | Toggle FPS counter |
| `?` | Toggle hotkey reference |

Right-click (without dragging) or `Esc` cancels tower placement.

## Structure

```
index.html            entry point (3D canvas under a 2D UI canvas)
audio.js              sound effects and music (Web Audio API)
particles.js          victory confetti
map.js                tile grid, path waypoints, map configs
enemies.js            enemy definitions and movement
towers.js             tower definitions, projectiles, Laser/Tesla special logic
waves.js              wave definitions, endless generator, income formula
vendor/three.min.js   Three.js r128 (MIT license)
render3d.js           3D scene: map, models, effects, camera, tile picking
ui.js                 sidebar, overlays, leaderboard, menus
game.js               game loop, state, input handling
style.css             minimal page styling
```

Game logic works in 2D map coordinates; `render3d.js` reads the game state each frame and
mirrors it into the 3D scene.
