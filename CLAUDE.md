# Carioca — Claude Code Guide

## Project Overview

Carioca is a multiplayer online implementation of the Chilean Rummy-style card game. It's a pnpm monorepo with:
- **Backend**: Rust (Axum, SQLx, Tokio, WebSockets) — `backend/`
- **Frontend**: React + TypeScript + Vite — `frontend/`
- **Game rules reference**: `rules.md`

## Commands

### Setup
```bash
pnpm install          # install all workspace deps
```

### Backend (run from `backend/`)
```bash
cargo run             # start dev server (http://0.0.0.0:3000)
cargo test            # run all tests
cargo fmt             # format (100-char limit, 2024 edition)
cargo clippy -- -D warnings   # lint — must pass with zero warnings
```

### Frontend (run from `frontend/`)
```bash
pnpm dev              # start Vite dev server
pnpm build            # production build
pnpm test             # run vitest suite
pnpm lint             # ESLint — must pass
```

### Full-stack dev (from root)
```bash
pnpm dev              # starts backend + frontend concurrently
```

## Architecture

- **`backend/src/engine/`** — pure game logic (rules, combos, scoring, bot AI). No network deps. Fully unit-testable.
- **`backend/src/api/`** — Axum HTTP + WebSocket handlers.
- **`backend/src/matchmaking/`** — lobby and room management via Tokio channels.
- **`backend/src/db/`** — SQLx/SQLite repository layer.
- **`frontend/src/pages/`** — page-level components (Game, Lobby, Login, Register).
- **`frontend/src/components/`** — reusable UI components.
- **`frontend/src/lib/`** — WebSocket context, API client, client-side combo detection.

## Coding Conventions

- **TDD is mandatory.** Write failing tests first, then implement. A task is not done until automated tests cover the new behavior.
- **No `any` in TypeScript.** Use specific types, generics, or `unknown` with type narrowing. ESLint enforces this.
- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings` must both pass before a task is complete.
- **Isolate game logic from network logic** in the backend so the engine stays unit-testable.
- **Frontend tests**: `vitest` + `@testing-library/react`. **Backend tests**: `cargo test`.

## Workflow for New Features

1. Read relevant codebase context before writing anything.
2. Outline expected behavior and design test cases.
3. Write failing tests.
4. Implement to make tests pass.
5. Refactor: clean types, no `any`, lint/clippy green.

## Safety Guardrails

- **Never delete or modify existing tests** unless the test criteria itself is changing and the user has explicitly agreed.
- **Never overwrite `README.md` or `rules.md`** without explicit human approval.
- **Never touch SQLite DB files or schema migrations** without human validation.
- **Never add new Cargo or npm dependencies** without confirming compatibility and necessity with the user.
