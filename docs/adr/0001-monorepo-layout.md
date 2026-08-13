# ADR-0001: Polyglot monorepo with pnpm workspaces + a root Makefile

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Waiting Room is polyglot: a **Go** daemon and several **TypeScript** packages (SDK, plugin, CLI wrapper, reference activities). We need a layout and task runner that build/test/release both languages without friction and stay approachable for open-source contributors who may arrive as either Go or Node people.

## Decision

- A single repository (monorepo).
- **pnpm workspaces** manage the TS side (`packages/*`).
- The **Go daemon** lives in `daemon/` with its own `go.mod` (self-contained, so `go install` / GoReleaser never see TS).
- The **root `Makefile` is the single source of truth** for build/test/lint/fmt/integration/release, with thin `package.json` scripts shelling out to `make` so JS-native workflows (`npm run build`) still work.
- **Skip Turborepo for v1.** The cross-language dependency edges are only "build TS" and "build daemon", which a Makefile expresses in a few lines.

## Consequences

- One `git clone`, one `make build` builds everything.
- Go contributors use `cd daemon && go …`; Node contributors use `pnpm -r …`; both also work via `make`.
- Turborepo can be adopted later if the TS package count grows and cached, dependency-ordered builds become valuable.
