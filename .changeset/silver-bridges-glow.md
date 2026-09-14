---
"@waiting-room/web-bridge": minor
---

New package: serve a Waiting Room side activity as a local web page. `startWebActivity()` subscribes to the daemon over the existing UDS SDK (pane-less), serves the game's static bundle plus a live SSE state stream on an ephemeral `127.0.0.1` port behind a random URL token, opens the OS browser, prints a JSON ready-line for launchers, and exits when the tab closes. A zero-Node browser client (`@waiting-room/web-bridge/browser`) provides live state, focus/quit POSTs, and "Claude needs you" attention effects (title flash, red favicon, notification, beep — each degrading independently). macOS is the supported platform; first release.
