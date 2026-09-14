# Waiting Room

> Pause side activities and snap focus back to Claude the moment it needs your input.

**Waiting Room** detects when a Claude Code agentic-coding session is **busy** vs. when it **needs human attention**. While Claude works, you run a side activity (browser Snake, math quiz, …); the instant Claude halts or needs input, the activity auto-pauses and **your terminal comes back to the foreground**.

🚧 **Status:** pre-alpha, under active development. See the [roadmap](#roadmap).

---

## How it works

```
Claude Code hooks ──(async)──> waiting-room emit ──UDS──> [ Go daemon ]
                                                              │
                                  ┌───────────────────────────┼───────────────────┐
                                  ▼                           ▼                   ▼
                          session registry            event bus (pub/sub)    focus controller
                          (keyed by session_id)       (snapshot + stream)    (osascript on macOS)
                                                              │
                                                              ▼
                                            browser activities (SDK) ──> pause/resume
```

- **Claude Code hooks** (shipped as a plugin) call a one-shot `waiting-room emit` client.
- The **Go daemon** keeps per-session state, broadcasts to activity clients, and triggers **OS-level focus recovery**.
- The **SDK** lets activity authors subscribe and react with `onPause()` / `onResume()`.
- **Focus recovery is the daemon's job; pause/resume is the activity's job.**

The daemon speaks two transports: a **Unix Domain Socket** for the local `emit` / `watch` / `status` CLIs and SDK clients, and **HTTP + WebSocket** on `127.0.0.1` for browser-based activities. The protocol envelope is identical on both transports.

Read the full design: [`docs/architecture.md`](docs/architecture.md).

## Packages

| Package | Lang | Description |
| --- | --- | --- |
| `daemon` | Go | Background daemon (UDS + HTTP+WS) and CLI. |
| [`@waiting-room/sdk`](packages/sdk) | TS | Activity developer SDK (`onPause`, `onResume`, `focusClaude`). |
| [`@waiting-room/plugin-claude`](packages/plugin-claude) | TS | Claude Code plugin (`hooks/hooks.json`, slash skills). |
| [`@waiting-room/cli`](packages/cli) | TS | Binary distribution wrapper. |
| [`@waiting-room/game-snake`](packages/game-snake) | TS | Reference activity: Snake (Ink TUI + browser canvas). |
| [`@waiting-room/exercise-math`](packages/exercise-math) | TS | Reference activity: math quiz (Ink TUI + browser DOM). |

## Develop

**Prerequisites:** Go ≥ 1.23, Node ≥ 20, pnpm ≥ 10. (macOS only for v2 focus recovery — Linux/Windows work for everything else but won't auto-focus the terminal.)

```bash
make build       # Go binary + TS packages + browser bundles
make test        # Go + TS unit tests
make lint        # go vet + TS typecheck
make plugin-pack # cross-compile 4 platform binaries + vendor into plugin-claude
```

## Try it

### As an enduser (after marketplace + npm publish)

```
/plugin marketplace add alifarooqi/waiting-room-marketplace
/plugin install waiting-room
npm install -g @waiting-room/game-snake
# inside Claude:
/waiting-room:start snake
```

### From source (dev / no marketplace yet)

```bash
make build
claude --plugin-dir packages/plugin-claude
# The SessionStart hook will download the daemon on first launch.
```

See [`packages/plugin-claude`](packages/plugin-claude) for the full install story (skills, slash commands, troubleshooting).

## Write your own activity

See [`examples/writing-an-activity.md`](examples/writing-an-activity.md) for a minimal example and the design rules (don't throw on disconnect, retain last-known state across reconnects, hand focus back on quit).

## Security

- [`docs/security-uds.md`](docs/security-uds.md) — peer-credential auth on the UDS socket, permissions, threat model.
- [`docs/security-websocket.md`](docs/security-websocket.md) — localhost binding, Origin validation, no cross-origin writes.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) and the [ADR set](docs/adr/) for the design choices (polyglot monorepo, transport-agnostic JSON-lines wire, OS-level focus controller, zero external Go dependencies, …).

## Releasing

See [`docs/releasing.md`](docs/releasing.md) for the cookbook. The repo has two release axes (npm via Changesets; binary tarballs via goreleaser tags); PRs add `.changeset/*.md` files to drive the npm side, and `make bump-waiting-room-version NEW_VERSION=vX.Y.Z` keeps the install-on-first-hook resolver aligned with the goreleaser tag axis.

## Roadmap

- [x] **M0** — Repo bootstrap
- [x] **M1** — Wire + UDS server
- [x] **M2** — Registry + bus + `emit`
- [x] **M3** — Controller + focus (v1: tmux; v2: OS-level)
- [x] **M4** — SDK (TS)
- [x] **M5** — plugin-claude + CLI packaging
- [x] **M6** — Reference activities (Snake, math)
- [x] **M7** — Hardening + v1 release
- [x] **v2** — Drop tmux, browser-based activities, dual-transport daemon

## License

[MIT](LICENSE) © The Waiting Room Contributors
