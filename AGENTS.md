# Project Overview
Carioca is an online, multiplayer implementation of the traditional Chilean Rummy-style card game. The project is structured as a pnpm monorepo consisting of a high-performance Rust backend (using Axum, SQLx, and WebSockets) and a modern React frontend (using Vite and TypeScript). The high-level goal is to provide a robust, strictly-typed multiplayer gaming experience with decoupling between the core rules engine and network logic.

## Project Structure
- `/backend`: Contains the Rust server module, handling WebSocket matchmaking, SQLite database operations, and the core game rules engine.
- `/frontend`: Contains the React/Vite web application, including UI components, state management, and API integration.
- `rules.md`: Documents the specific rules, combinations (Tríos/Escalas), and game flow of Carioca.
- `package.json` & `pnpm-workspace.yaml`: Define the monorepo workspace configuration and orchestrate global scripts.

## Setup & Development Commands

### Installation
```bash
# Install all workspace dependencies
pnpm install
```

### Backend (Rust/Axum)
```bash
cd backend
# Run development server
cargo run
# Run formatter
cargo fmt
# Run linter (must pass without warnings)
cargo clippy -- -D warnings
# Run tests
cargo test
```

### Frontend (React/Vite)
```bash
cd frontend
# Run development server
pnpm dev
# Build for production
pnpm build
# Run linter
pnpm lint
# Run tests
pnpm test
```

## Coding & Style Conventions
- **Strict Typing:** Usage of `any` is strictly prohibited. You must use specific types, generics, or `unknown` with proper type narrowing. The TypeScript frontend enforces strict `tsconfig` settings, and ESLint will fail on `any` types.
- **Test-Driven Development (TDD):** TDD is mandatory. Think about test criteria first and do not assume a task is complete until there are tests (unit, integration, or E2E) validating the behavior.
- **Rust Formatting & Linting:** Use `cargo fmt` with the defined `rustfmt.toml` (100-character line limit, 2024 edition). `cargo clippy` warnings are treated as errors.
- **TypeScript/React Formatting:** Follow standard `eslint` rules defined in `eslint.config.js` and structure components clearly with Hooks.

## Do's and Don'ts
- **Do** practice Test-Driven Development (TDD) for every new feature or bug fix.
- **Do** isolate game logic from network logic in the Rust backend for testability.
- **Do** use `vitest` and `@testing-library/react` for frontend testing and `cargo test` for backend testing.
- **Don't** use `any` types in TypeScript.
- **Don't** leave linter or formatting errors unaddressed before completing a task.
- **Don't** assume a feature works without writing automated tests for it.

## Common Workflows and Scripts
- **Adding a Feature:**
  1. Read relevant codebase context.
  2. Outline expected behavior and design test cases.
  3. Write failing test cases.
  4. Implement the feature to make tests pass.
  5. Refactor ensuring strict typings, no `any`, and clean lint/clippy passes.
- **Full Stack Dev:** Run `pnpm dev` from the project root to start both backend and frontend concurrently (as configured in root `package.json`), or run them in separate terminals using `cargo run` and `pnpm dev`.

## Safety & Guardrails
- **Testing:** Never modify or delete existing tests unless explicitly updating test criteria agreed upon by the human developer. Always ensure existing tests pass after modifications.
- **Documentation:** Never overwrite or remove architectural decisions from the `README.md` or `rules.md` without human review.
- **Database:** Do not manually delete or alter SQLite databases or schema files without human validation.
- **Dependencies:** Do not add new top-level dependencies (in Cargo.toml or package.json) without verifying compatibility and necessity with the human developer.
