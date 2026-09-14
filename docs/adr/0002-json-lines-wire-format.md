# ADR-0002: JSON-lines wire format over a Unix Domain Socket

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The daemon speaks IPC with three kinds of clients: the `emit` one-shot client (hook-driven), long-lived activity clients (SDK over UDS, Node), and browser-based activity clients (SDK over WebSocket, browser). The wire format is transport-agnostic — every message is a self-contained JSON object, and one message = one text frame on either transport.

## Decision

- **Transport:** Unix Domain Socket (no port conflicts, filesystem permissions, no network exposure).
- **Format:** JSON-lines — newline-delimited JSON objects, each a versioned envelope `{ "v": 1, "type": "…", … }`. Unknown `type` is ignored (forward compatibility).

## Alternatives considered

- **Protobuf** — rejected for v1. Event volume is human-scale (a few events/minute), so size/speed wins are irrelevant. JSON-lines is debuggable with `nc -U … | jq`, needs no codegen, and is trivially portable. Protobuf can be swapped in later behind the `wire` package without touching the bus or sessions.
- **WebSockets** — **shipping in v2.** v2's browser activities subscribe via the daemon's HTTP+WS listener; every message is one text frame. Because every message is a self-contained JSON object, the WS bridge carries messages verbatim with **no body changes** — this is why transport-agnosticism is preserved.

## Consequences

- Zero codegen dependency for v1; fast iteration.
- The envelope's `v` field carries schema versioning for future evolution.
- Browser activities (fast-follow) reuse the exact same protocol.
