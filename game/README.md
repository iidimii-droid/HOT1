# Ironfall

A squad-based multiplayer RTS in the style of *Company of Heroes*: power-armored
space marines fighting over capture points. It runs in the browser, and a small
Node.js server simulates every match so neither player can cheat.

All names and art are original (no Games Workshop trademarks), so the game can
be shared publicly.

## Run it

```bash
cd game
npm install
npm start            # http://localhost:8080  (set PORT to change)
```

Open the page, enter a name and pick a mode:

- **Play vs AI**: starts right away against the computer.
- **Create online match**: gives you a 4-letter code and a link. Your opponent
  opens the link (or enters the code) on the same server.

To play over the internet, the server has to be reachable by both players.
Deploy the `game/` folder to any Node host that supports WebSockets (Fly.io,
Render, Railway or a VPS) with `npm start` as the start command. There's a health
check at `/health`.

## How it plays

| Mechanic | How it works |
|---|---|
| **Victory** | Each side starts with 500 tickets. Hold more of the 3 victory points (stars) than the enemy to drain their tickets each second. |
| **Economy** | Requisition (R) and power (P) come in over time. Capturing R and P points raises your income. |
| **Squads** | Units are squads of models. Losses are refilled with **Reinforce (T)** near your HQ. |
| **Cover** | Sandbags, walls and ruin edges give heavy cover (green shield): half accuracy and less damage taken. Craters give light cover (yellow). Cover only protects from the side it faces. |
| **Suppression** | Heavy Support teams (and explosions) suppress infantry, which slows them and lowers their accuracy. Enough suppression pins them in place. |
| **Retreat (R)** | The squad runs to HQ, takes half damage on the way, and heals at base. |
| **Veterancy** | Squads that deal damage earn up to 3 stars, which raise accuracy and toughness. |
| **Line of sight** | Ruined buildings block movement, shots and sight. The fog of war hides enemies outside your squads' vision. |
| **HQ bastion** | Each HQ has a defensive gun, so a base can't be camped. |

### Units

| Key | Unit | Cost | Role |
|---|---|---|---|
| Z | Tactical Squad (5) | 300R | All-rounder. **G**: frag grenade |
| X | Heavy Support Team (3) | 280R | Repeater suppresses infantry; has to set up before firing |
| C | Assault Squad (4) | 320R 20P | Jump packs and blades, deadly in melee. **G**: jump |
| V | Lance Team (3) | 300R 45P | Anti-tank weapon |
| B | Warhound Tank | 380R 160P | Cannon plus coaxial gun; small arms barely scratch it |

### Controls

- Left-click or drag to select. Shift adds to the selection. Double-click selects every squad of that type on screen.
- Right-click to move, or right-click an enemy to attack.
- **Q** + click: attack-move. **E**: stop. **R**: retreat. **T**: reinforce. **G** + click: ability.
- **Rally point:** left-click your HQ (or press **H**), then right-click the map. New units walk there.
- **Ctrl+1–9** sets a control group; **1–9** selects it (press twice to jump the camera there).
- **Tab** selects all your squads. **Space** centers on the selection. **Home** jumps to HQ.
- Move the camera with **W A S D** or the arrow keys, by holding the right mouse button and dragging, with the screen edges, or with a middle-mouse drag. The wheel zooms. Click the minimap to jump; right-click it to move there.
- **M** toggles sound.

## Code layout

```
server/data.js   unit, weapon and economy numbers; the mirrored map
server/sim.js    authoritative simulation (20 ticks/s): movement, combat, cover, capture
server/geo.js    A* pathfinding grid, line of sight, collision helpers
server/ai.js     computer opponent (uses the same command API as players)
server/index.js  static file server and WebSocket rooms
public/          canvas client: rendering, fog of war, HUD, input, synthesized sound
test/            headless AI-vs-AI matches and an end-to-end WebSocket test
```

Players pick an armor scheme on the menu (Azure Guard, Crimson Host, Emerald Wardens, Storm Grey). All unit and terrain art is drawn in code in `public/art.js`.

`npm run build:offline` writes `dist/ironfall.html`, a single-file vs-AI version that needs no server.

Run `npm test` to play three AI-vs-AI matches headlessly and run a two-client
network check.

Balance lives in `server/data.js`. Change a number and restart the server.
