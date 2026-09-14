# Waiting Room

> Pause side activities and bring Claude back to your attention the moment Claude Code needs you.

**Waiting Room** detects when a Claude Code agentic-coding session is **busy** vs. when it **needs human attention**. While Claude works, you play a side activity (Snake, math quiz, …) in a browser window; the instant Claude halts or needs input, the activity auto-pauses, the tab title flashes with a notification, and **Claude's terminal comes back to the front**.

No tmux. No panes. No launcher wrappers — just `claude` and a browser.

🚧 **Status:** pre-alpha, under active development. macOS is the supported platform this release. See the [roadmap](#roadmap).

---

## How it works

```
Claude Code hooks ──(async)──> waiting-room emit ──UDS──> [ Go daemon ]
                                                              │
                                  ┌───────────────────────────┼────────────┐
                                  ▼                           ▼            ▼
                          session registry            event bus        tmux ctrl
                          (keyed by session_id)       (snapshot +      (inert unless
                                                          stream)       you use tmux)
                                                              │
                                                              ▼
                              activity bridge (SDK, pane-less subscribe)
                                  │                    │
                                  ▼                    ▼
                     127.0.0.1 http + SSE      foreground Claude's terminal
                          │                     (macOS `open -a`, on pause)
                          ▼
                     browser page — game + banners + notification/beep
```

- **Claude Code hooks** (shipped as a plugin) call a one-shot `waiting-room emit` client; SessionStart also reports the session id so games bind to *your* Claude session.
- The **Go daemon** (Unix Domain Socket) keeps per-session state and broadcasts to activity clients. Its tmux internals are inert unless you happen to run Claude inside tmux.
- The **web bridge** (`@waiting-room/web-bridge`) turns any activity into a local web page: ephemeral loopback port, random URL token, SSE state stream, browser opened for you, process exits when the tab closes.
- **Pause/resume is the activity's job (SDK); attention is the bridge's job (notification + terminal bring-forward).**

Read the full design: [`docs/architecture.md`](docs/architecture.md) and [ADR-0004](docs/adr/0004-web-activities.md).

## Packages

| Package | Lang | Description |
| --- | --- | --- |
| [`daemon`](daemon) | Go | The background IPC daemon + `emit`/`status` CLI. |
| [`@waiting-room/sdk`](packages/sdk) | TS | Activity developer SDK (`onPause`, `onResume`, `focusAgentTerminal`). |
| [`@waiting-room/web-bridge`](packages/web-bridge) | TS | Serve any activity as a local web page (HTTP + SSE + browser client). |
| [`@waiting-room/plugin-claude`](packages/plugin-claude) | TS | Claude Code plugin (`hooks/hooks.json`, `wr-open` launcher). |
| [`@waiting-room/cli`](packages/cli) | TS | Binary distribution wrapper. |
| [`@waiting-room/game-snake`](packages/game-snake) | TS | Reference activity: Snake in the browser. |
| [`@waiting-room/exercise-math`](packages/exercise-math) | TS | Reference activity: math quiz in the browser. |

## Develop

**Prerequisites:** Go ≥ 1.23, Node ≥ 20, pnpm ≥ 10. (macOS: `brew install go node pnpm`. tmux is only needed for `make integration`.)

```bash
make build      # build the Go binary (daemon/bin/waiting-room) + all TS packages
make test       # Go + TS unit tests
make lint       # go vet + TS typecheck
make integration# real-tmux integration tests (daemon internals; requires tmux)
make plugin-pack# cross-compile 4 platform binaries + vendor into plugin-claude
```

## Try it

### As an enduser (after marketplace + npm publish)

```
/plugin marketplace add alifarooqi/waiting-room-marketplace
/plugin install waiting-room
npm install -g @waiting-room/game-snake @waiting-room/exercise-math
# inside Claude, anywhere (no tmux needed):
/waiting-room:start snake
```

Your browser opens on the game. When Claude stops and needs you, the game
pauses, you get a notification + beep (after your first click in the page),
and Claude's terminal window comes back to the front.

### From source (dev / no marketplace yet)

```bash
make build
claude --plugin-dir packages/plugin-claude
# The SessionStart hook will download the daemon on first launch.
# Then, inside Claude:
/waiting-room:start snake
```

See [`packages/plugin-claude`](packages/plugin-claude) for the full install story (skills, slash commands, troubleshooting).

## Write your own activity

See [`examples/writing-an-activity.md`](examples/writing-an-activity.md) for a minimal web activity (a dozen lines with `@waiting-room/web-bridge`) and the design rules (never throw on disconnect, retain state across reconnects, degrade every attention effect independently).

## Security

See [`docs/security-uds.md`](docs/security-uds.md) for the threat model, the peer-credential check, permissions, the web-bridge surface (loopback + URL token + Host check), and the documented v1 limitations (multi-user hosts are out of scope).

## Architecture

See [`docs/architecture.md`](docs/architecture.md) and the [ADR set](docs/adr/) for the design choices (polyglot monorepo, JSON-lines wire, web activities via per-game bridges, zero external Go dependencies, …).

## Releasing

See [`docs/releasing.md`](docs/releasing.md) for the cookbook. The repo has two release axes (npm via Changesets; binary tarballs via goreleaser tags); PRs add `.changeset/*.md` files to drive the npm side, and `make bump-waiting-room-version NEW_VERSION=vX.Y.Z` keeps the install-on-first-hook resolver aligned with the goreleaser tag axis.

## Roadmap

- [x] **M0** — Repo bootstrap
- [x] **M1** — Wire + UDS server
- [x] **M2** — Registry + bus + `emit`
- [x] **M3** — Tmux controller + focus
- [x] **M4** — SDK (TS)
- [x] **M5** — plugin-claude + CLI packaging
- [x] **M6** — Reference activities (Snake, math)
- [x] **M7** — Hardening + v1 release
- [x] **M8** — Web activities (browser games, tmux-free UX, macOS focus recovery) — [ADR-0004](docs/adr/0004-web-activities.md)
- [ ] **M9** — Daemon-side consolidation (optional; ADR-0004 sketch B), daemon tmux-code retirement, Windows-native support

## License

[MIT](LICENSE) © The Waiting Room Contributors
