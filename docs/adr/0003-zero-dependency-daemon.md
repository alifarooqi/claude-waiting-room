# ADR-0003: Zero external Go dependencies in the daemon

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

The daemon needs three low-level facilities that the Go standard library
does not obviously provide: `flock` (double-start guard), peer-credential
authentication on Unix Domain Sockets (`SO_PEERCRED` on Linux,
`LOCAL_PEERCRED` on macOS), and nothing else. The conventional answer is
`golang.org/x/sys`. During M1 the initial `go get` failed on a flaky
proxy.golang.org connection, prompting a re-evaluation.

## Decision

The daemon uses **only the Go standard library**:

- `syscall.Flock` — exists in stdlib on both darwin and linux.
- `syscall.GetsockoptUcred` + `SO_PEERCRED` — stdlib on linux.
- macOS `LOCAL_PEERCRED` — not in stdlib; implemented with a ~25-line raw
  `SYS_GETSOCKOPT` call against the stable `<sys/un.h>` `xucred` ABI
  (`daemon/internal/server/auth_darwin.go`).

Note from verification on macOS 15: `xu_version` is `0` on legitimate
credentials — validity must be judged by `errno == 0 && optlen >= 12`, not
by a version sentinel.

## Consequences

- `go.mod` has zero requires; builds need no module proxy at all —
  reproducible, offline-friendly, faster CI, and no supply-chain surface
  for a process that owns a user-writable socket.
- Platform-specific code stays behind two tiny files
  (`auth_linux.go` / `auth_darwin.go`), swappable for `golang.org/x/sys`
  later if the daemon ever needs more of it.
- The raw syscall is annotated with the ABI it depends on; if it ever
  breaks on a future macOS, the fix is local.
