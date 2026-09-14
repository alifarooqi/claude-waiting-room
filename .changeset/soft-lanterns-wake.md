---
"@waiting-room/sdk": minor
"@waiting-room/web-bridge": patch
---

`Activity` exposes `live` — `false` in degraded mode (daemon unreachable), so UIs can show their "auto-pause unavailable" state honestly at startup; degraded mode never fires `onDisconnect`. The web bridge seeds its offline flag from it: with the daemon down, game pages now show the offline banner immediately instead of pretending everything is fine.
