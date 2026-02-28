# Flip 7 LAN Party (Ruleset 3.1)

A multiplayer Flip 7-inspired game server built with Bun + WebSocket. Refactored for modularity, real-time persistence, and official ruleset accuracy.

## Key Features

- **Ruleset 3.1 Alignment**: Strictly follows the official 94-card deck distribution (0-12 ladder, 3x Actions, 6x Modifiers).
- **Real-time 30s Turn Timer**: Automated background timer processing ensures the game never stalls.
- **Dynamic UI/UX**: React-based frontend with smooth CSS animations, toast notifications, and a real-time shrinking timer bar.
- **Robust Persistence**: Powered by `ioredis` for reliable state storage with an automatic in-memory fallback.
- **Modular Architecture**: Clean separation of types, deck logic, game state transitions, and server-side coordination.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript
- **Frontend**: React (ESM via CDN) + Tailwind CSS + htm (Hyperscript Tagged Markup)
- **Networking**: Bun WebSocket + Built-in HTTP Server
- **Database**: Redis (via `ioredis`)

## Quick Start

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Run in dev mode (with hot reload)**:
   ```bash
   bun run dev
   ```

3. **Run tests**:
   ```bash
   bun test
   ```

4. **Access the game**:
   Open `http://localhost:3000` in your browser. Use `?room=YOUR_ROOM_NAME` to join different sessions.

## Scripts

- `bun run dev` - Start server with hot reload (`bun --hot`)
- `bun run start` - Start production server
- `bun test` - Run the logic validation suite in `tests/`
- `bun run typecheck` - Run TypeScript compiler checks

## Environment Variables

- `PORT` (optional): Server port, defaults to `3000` (auto-increments if port is busy).
- `REDIS_URL` (optional): Connection string for Redis persistence. If not provided, the server defaults to in-memory mode.

## Project Structure

- `src/server.ts` - Entry point, WebSocket handling, and background timer intervals.
- `src/game.ts` - Core game engine and state transition logic.
- `src/types.ts` - Centralized TypeScript interfaces and action types.
- `src/deck.ts` - Official 94-card deck generation and shuffle logic.
- `src/store.ts` - Multi-layered state storage (Redis + Memory).
- `src/rooms.ts` - Room-based mutual exclusion locking and client management.
- `tests/server.test.ts` - Comprehensive ruleset validation suite.
- `public/index.html` - Minimal HTML shell with integrated Tailwind styles.
- `public/app.js` - Modern React frontend with hooks and real-time state sync.

## Game Rules (Summary)

- **Objective**: Be the first player to reach 200 points.
- **Deck Distribution**: 
  - Number Cards (79 total): `0` (1), `1` (1), `2` (2), `3` (3) ... `12` (12).
  - Actions: `Freeze` (3), `Flip Three` (3), `Second Chance` (3).
  - Modifiers: `+2`, `+4`, `+6`, `+8`, `+10`, `x2` (1 each).
- **Turn Actions**: Draw ("Twist") or Stop ("Bank").
- **Busting**: Drawing a duplicate number causes a bust unless saved by a "Second Chance".
- **Flip 7**: Collecting 7 unique numbers awards a 15-point bonus and ends the round immediately.

## Disclaimer

I do not claim any copyright or ownership of the Flip 7 game concept.  
This project was created for educational purposes and personal enjoyment.  
If this repository violates any rights, please relase an issue.
