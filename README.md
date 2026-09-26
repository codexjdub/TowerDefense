# Tower Defense

A browser-based tower defense game built with vanilla HTML5 Canvas — no frameworks, no dependencies.

## Play

Just open `index.html` in a browser — no build step, no install.

## Features

- **8 maps** — S-Curve, Zigzag, Serpentine, Switchback, Crown, Figure-8, Twisted, Spiral
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
- **Tower upgrades** up to level 3
- Per-tower damage and kill tracking
- Auto-save between waves with resume support
- Local leaderboard (regular + endless)
- Screen shake, floating damage numbers, particle effects, ambient fireflies

## Controls

| Key | Action |
|---|---|
| `1` – `7` | Select tower type |
| `Space` | Start wave / skip countdown (early gold bonus) |
| `U` | Upgrade selected tower |
| `P` | Pause / Resume |
| `Esc` | Deselect |
| `F` | Toggle FPS counter |
| `?` | Toggle hotkey reference |

Right-click or `Esc` cancels tower placement.

## Structure

```
index.html      entry point
audio.js        sound effects (Web Audio API)
particles.js    particle system (death bursts, confetti, ambient dust)
map.js          tile grid, path waypoints, map configs
enemies.js      enemy definitions and movement
towers.js       tower definitions, projectiles, Laser/Tesla special logic
waves.js        wave definitions, endless generator, income formula
ui.js           sidebar, overlays, leaderboard, menus
game.js         game loop, state, input handling
style.css       minimal page styling
```
