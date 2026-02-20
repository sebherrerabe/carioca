# Overview
This file, `AGENTS.md`, is an open standard to help objective agentic LLMs (like yourself) navigate and develop in this codebase.
You should read these instructions carefully before performing any implementation or refactoring tasks.

# Development Principles

## 1. Test-Driven Development (TDD)
- **TDD is mandatory:** You must practice Test-Driven Development. Think about the test criteria first.
- **Success Criteria:** Do not assume a task is complete until there are tests (unit, integration, or E2E) that validate the specific requirements, and all tests pass.
- **Frontend (React/Vite):** Use `vitest`, `@testing-library/react` for unit and integration testing. Use Playwright for end-to-end testing if applicable.
- **Backend (Rust):** Use built-in `cargo test`. All logic must be well-tested at the module level before exposing it through handlers.

## 2. Strong Typing & Strictness
- **No `any` Types Allowed:** We enforce strict type boundaries. Usage of `any` is strictly prohibited. You must use specific types, generics, or `unknown` with proper type narrowing when you do not know the type.
- **TypeScript:** The frontend relies on strict `tsconfig` settings (`strict: true`, `noImplicitAny: true`). Furthermore, ESLint is configured to fail if any `any` types are detected.
- **Rust:** The backend is in Rust, which is inherently strongly typed. You must ensure `cargo clippy -- -D warnings` passes without warnings. 

## 3. Linting and Formatting
- Always run linters and ensure there are no errors before finalizing a task.
- Frontend: Run `pnpm lint` (or `npm run lint`) inside the `frontend` folder.
- Backend: Run `cargo fmt` and `cargo clippy -- -D warnings` inside the `backend` folder.

## 4. Workflows
When starting a new feature:
1. Read the relevant codebase context.
2. Outline the expected behavior and design the test cases.
3. Write the test cases (they should fail initially).
4. Implement the feature to make the tests pass.
5. Ensure typings are strict, no `any` is used, and linting/clippy passes.
6. Refactor as needed.

## Directory Structure
- `/frontend`: React + Vite + TypeScript.
- `/backend`: Rust (Axum framework).
