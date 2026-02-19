# Carioca - Multiplayer Card Game

An online, multiplayer implementation of the traditional Chilean Rummy-style card game **Carioca**.

This project is structured as a pnpm monorepo consisting of:
- A high-performance Rust backend built with Cargo, Axum, SQLx, and WebSockets.
- A sleek, modern Web frontend built with React, Vite, and TypeScript.

## Architecture

* **Backend Engine**: Pure Rust engine implementing the strict rules of Carioca (`src/engine/rules.rs`), decoupling game logic from network logic for maximum testability and runtime efficiency.
* **Matchmaking & Rooms**: Handled via Tokio MPSC channels and Axum WebSockets.
* **Database**: SQLite (via `sqlx`) for MVP data persistence, prepared for an easy migration to PostgreSQL.
* **Monorepo Management**: `pnpm` workspaces.

## Prerequisites

- [Rust & Cargo](https://rustup.rs/) (v1.85+)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9+)

## Getting Started

### 1. Install Dependencies
Run `pnpm install` from the root of the project to install all workspace dependencies.

### 2. Running the Backend
1. Navigate to the backend directory: `cd backend`
2. Run the tests to verify the game engine: `cargo test`
3. Start the Axum server: `cargo run`
   - The server defaults to running on `http://0.0.0.0:3000`

### 3. Running the Frontend (Coming Soon)
1. Navigate to the frontend directory: `cd frontend`
2. Start the Vite dev server: `pnpm dev`

## Rules of Carioca
The goal is to get rid of all your cards by melding them into valid "Tríos" (3 cards of the same value) and "Escalas" (4+ consecutive cards of the same suit).
Read deeply about the [Rules of Carioca](./rules.md).

## Development Status
- [x] Initial Monorepo Setup
- [x] Rust Backend Scaffolding & Dependencies
- [x] Core Rules Engine (Deck, Cards, valid Tríos/Escalas)
- [ ] Database Schema & Migrations
- [ ] WebSocket Matchmaking & Multiplayer Loop
- [ ] React UI Implementation
