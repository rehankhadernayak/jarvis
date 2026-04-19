# 05 — Mission Control UI (MEDIUM)

## Vision
Replace the current dark chat UI with a full MCU-style holographic dashboard.
JARVIS speaks. Panels animate. It looks like Tony Stark's workshop.

## Components

### Arc Reactor (center)
- Animated Three.js arc reactor = life score charge level
- Pulses blue at rest, spins when processing, green when speaking
- Grade S = full charge, Grade D = dim/flickering

### Status Panels (floating cards)
- Gametime sprint: circular progress ring (3/20), countdown timer
- SAT streak: calendar heat map, days since last session
- Calendar: next 3 events as holographic timeline
- Life score breakdown: radial chart

### Chat (bottom)
- Voice waveform visualizer when JARVIS speaks
- Text stream appears like HUD overlay
- Voice input button = arc reactor click

### System Status (top bar)
- All services status (green dots = all up)
- SGT clock
- Memory usage, model in use

## Tech
- Three.js + WebGL for 3D elements
- CSS animations for holographic scan lines, glow effects
- Responsive: works on Mac browser, looks incredible

## Aesthetic
- Color palette: #0ea5e9 (arc reactor blue), #10b981 (online green), black deep space background
- Font: Orbitron or Exo 2 (sci-fi feel)
- Subtle scan line overlay
- Particle system around active elements
