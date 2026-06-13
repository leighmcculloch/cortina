# Cortina @ Bathurst

A browser 3D racing **simulation**: drive a 1964 Ford Cortina Mk1 painted *True Blue*
in a solo time trial around a faithful recreation of the **Mount Panorama Circuit
(Bathurst)**. Built with Three.js, no build step.

## Run

Just open `index.html` in a modern browser and click **Start Engine**.
Three.js loads from a CDN, so you need an internet connection on first load.
(Some browsers restrict `file://` — if it won't start, serve the folder:
`python3 -m http.server` then visit `http://localhost:8000`.)

## Controls

| Action | Keys |
| --- | --- |
| Throttle | `W` / `↑` |
| Brake / reverse | `S` / `↓` |
| Steer | `A` `D` / `←` `→` |
| Shift up / down | `E` / `Q` |
| Handbrake | `Space` |
| Respawn to track | `R` |
| Camera (chase / cockpit) | `C` |
| Toggle help | `H` |
| Pause | `P` |

## What's modelled

- **Simulation physics** (`src/vehicle.js`): slip-angle tyre model with a saturating
  grip limit (understeer/oversteer & catchable slides), longitudinal + lateral weight
  transfer, engine torque curve → 5-speed gearbox, wheelspin, front-biased braking with
  lock-up, handbrake rear-lock, drag, surface grip (grass vs tarmac) and punishing wall
  collisions.
- **The track** (`src/track.js`): the real corner sequence and ~175 m elevation profile —
  Hell Corner, Mountain Straight, Griffins Bend, The Cutting, across the top (Sulman,
  McPhillamy, Skyline), down through The Esses and The Dipper, Forrest's Elbow, Conrod
  Straight, The Chase, Murray's Corner. Provides the physics surface-query API.
- **The car** (`src/car.js`): low-poly True Blue Cortina Mk1, right-hand drive, with
  steerable front wheels.
- **HUD** (`src/hud.js`): canvas speedo & tacho, gear, live lap / best / last / delta timing.
- **Integration** (`src/main.js`): scene, lighting & shadows, cameras, input, lap timing,
  engine audio, game loop.

## Tests

`node qa/smoke.js` runs a headless integration smoke test (stubs Three.js, builds the
track + car, drives the physics, and asserts no NaN / car accelerates / shifts gears /
sits on the road surface / track queries are sane).
