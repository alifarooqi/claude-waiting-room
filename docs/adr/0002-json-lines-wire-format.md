# ADR-0002: JSON-lines wire format over a Unix Domain Socket

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The daemon speaks IPC with two kinds of clients: the `emit` one-shot client (hook-driven) and long-lived activity clients (SDK). We need a wire format and transport for v1, with a planned future path to browser-based clients.

## Decision

- **Transport:** Unix Domain Socket (no port conflicts, filesystem permissions, no network exposure).
- **Format:** JSON-lines — newline-delimited JSON objects, each a versioned envelope `{ "v": 1, "type": "…", … }`. Unknown `type` is ignored (forward compatibility).

## Alternatives considered

- **Protobuf** — rejected for v1. Event volume is human-scale (a few events/minute), so size/speed wins are irrelevant. JSON-lines is debuggable with `nc -U … | jq`, needs no codegen, and is trivially portable. Protobuf can be swapped in later behind the `wire` package without touching the bus or sessions.
- **WebSockets** — deferred. TUI clients need only a local socket. Because every message is a self-contained JSON object, a future WS gateway can bridge UDS↔WS (one message = one text frame) with **no message body changes** — this is why transport-agnosticism is preserved.

## Consequences

- Zero codegen dependency for v1; fast iteration.
- The envelope's `v` field carries schema versioning for future evolution.
- Browser activities (fast-follow) reuse the exact same protocol.
