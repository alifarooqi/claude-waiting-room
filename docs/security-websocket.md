# Security: WebSocket transport (v2)

## Threat model

The WebSocket transport is for **local browser games only**. It must
never accept connections from off-host, and must never let a third
party (a malicious site in another tab) drive the user's Waiting Room
subscription.

Out of scope:

- Multi-user hosts (covered by UDS peer-credential auth; the
  WebSocket listener binds to 127.0.0.1 only).
- Authentication of the browser client (it's the user's own browser,
  on the user's own machine).

## Mitigations

1. **Bind address.** The listener uses `127.0.0.1:0` by default. There
   is no environment variable that lets it bind to a public address —
   the v2 daemon refuses to listen on anything else. (A future v3 may
   add TLS + auth for cross-device; that's out of scope here.)

2. **Origin validation.** Every WebSocket upgrade request is checked:
   - No `Origin` header → allowed (non-browser clients like curl,
     the Node SDK).
   - `Origin` header present → must be `http://localhost:<port>` or
     `http://127.0.0.1:<port>` or `http://[::1]:<port>` where `<port>`
     is the listener's actual bound port.
   - Any other origin → 403 Forbidden.

   This prevents a malicious site loaded in the user's browser from
   driving their waiting-room subscription via fetch/WS. Same-origin
   policy would block this too, but we don't rely on it — a tab with
   permission to read `localhost:<port>` (via CORS) couldn't open a
   WS, since the WS handshake is its own origin check.

3. **No write endpoints.** The listener has no API surface beyond
   `GET /games/<name>/<asset>`, `GET /ws`, and `GET /healthz`. There
   is no PUT/POST/PATCH/DELETE — even if a request reached the
   listener, the only thing it could do is upgrade to a WS and send
   protocol messages, which the user already approved by being in the
   browser.

4. **Protocol safety.** The WS exchanges exactly the same envelope as
   the UDS transport. The server is the source of truth for game
   state; a malicious client cannot drive other games' state. (The
   server also doesn't expose `EmitMessage` over WS — only
   `SubscribeMessage`, `UnsubscribeMessage`, `StatusRequestMessage`,
   `PingMessage`, and `FocusRequestMessage`. Emits are one-shot UDS
   clients.)

5. **No filesystem leaks.** `/games/<name>/<asset>` resolves paths
   with `filepath.Clean` and rejects `..` traversal. The daemon
   refuses to serve anything outside `WAITING_ROOM_GAMES_DIR`.

6. **No secret material in bundles.** `window.__WAITING_ROOM__.ws_url`
   is the only runtime value injected; it points at the user's own
   loopback listener. Game bundles are built once and reused — no
   tokens, no signing keys, no secrets baked into the HTML/JS.

## When this isn't enough

If you need:

- **Cross-device subscription** (e.g. phone notification): wait for v3
  with TLS + auth, or proxy the daemon through a tunnel.
- **Hostile local users**: the daemon's UDS socket uses peer-credential
  auth (see `docs/security-uds.md`). The WS listener adds no
  additional risk because it can't escalate beyond what the user can
  already do in their own browser.
