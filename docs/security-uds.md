# UDS security review

The daemon listens on a Unix Domain Socket and accepts messages from
clients on the same host. Threat model: a single-user workstation where
the daemon is a per-user background process — multi-tenant shared hosts
are out of scope.

## Defense in depth

1. **Filesystem permissions (always on)**
   - Base dir `~/.waiting-room` mode `0700` — created and `Chmod`'d
     explicitly (umask-independent).
   - Socket `~/.waiting-room/daemon.sock` mode `0600` — `Chmod`'d after
     listen so the listener fd is never readable by other users, even if
     umask was loose.
   - Info file `daemon.info` mode `0600`, written atomically (temp +
     rename) so partial writes can never leave it world-readable.

2. **Peer-credential check on accept (always on)**
   - Linux: `getsockopt(SO_PEERCRED)` → `Ucred.Uid`.
   - macOS: `getsockopt(SOL_LOCAL, LOCAL_PEERCRED)` → `xucred.Euid`.
   - Any connection whose uid differs from the daemon's is rejected
     silently, before reading a single byte. (`server/serve` in
     `internal/server/server.go`.)
   - Validity check on macOS is `errno==0 && optlen>=12` — *not* a version
     sentinel (verified empirically; current macOS sets `xu_version=0`
     on legitimate connections — see ADR-0003).

3. **Double-start guard (always on)**
   - `flock(LOCK_EX|LOCK_NB)` on `daemon.lock` at startup.
   - Liveness probe on the existing socket (DIAL_TIMEOUT → PING) — the
     *friendly* "already running" message; the flock is the race-safe
     fallback when the probe is racy.

4. **Path-jack defense**
   - Before binding the socket: assert the parent dir is owned by us and
     is not a symlink. A stale socket left behind by a crashed daemon is
     unlinked only after ownership verification.

5. **No data exposure by default**
   - Sessions are keyed by Claude's `session_id` — opaque to the daemon,
     not used as anything but a routing key.
   - `meta` fields from hook payloads are echoed in logs; payloads are
     not persisted.
   - No external network calls. The socket is local-only.

## Out of scope (documented limitations)

- **Multi-user hosts.** Two users on the same machine can each run a
  separate daemon in their own `~/.waiting-room`; the peer-cred check
  prevents cross-access within the same user's session, but a hostile
  co-located user with the same uid (e.g. a misconfigured shared build
  user) is not defended against. Mitigation: ship a per-user setup
  (the default) and don't share the daemon across users.
- **Symlink attacks during socket bind** are mitigated by the parent-dir
  ownership assertion above. Symlink *replacement* of the base dir
  itself between invocations is the responsibility of the filesystem
  permissions on `$HOME`.
- **TOCTOU between info-file read and socket dial.** The SDK does
  liveness probe (`DaemonAlive`) before trusting an advertised socket;
  the same probe is applied by `discoverSocket` in the CLI.
- **Resource exhaustion.** The daemon has no per-connection rate limit
  by default. If you want one, the bus's slow-consumer drop path is the
  natural place — but for a single-user process this is unnecessary.

## Audit points for v1

- [x] Peer-cred uid check (linux + macOS)
- [x] 0600 socket + 0700 dir perms, explicit `Chmod`
- [x] Atomic info-file write (temp + rename)
- [x] Double-start guard (liveness probe + flock)
- [x] Path-jack defense (parent dir owner + no-symlink check)
- [x] Fail-open contract for hooks (exit 0 silently when unreachable)
- [x] Stale info file detection (probe advertised socket; fall back)
- [ ] Optional token auth (config-gated): reserved for v2 if/when shared
  hosts become a real use case.

## Reporting

File security issues at the GitHub Security tab (private disclosure) or
email the maintainer (see README). Please do not open a public issue.
