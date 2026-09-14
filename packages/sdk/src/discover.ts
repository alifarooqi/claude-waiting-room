/**
 * Socket discovery — mirrors the Go daemon's config.Default/discoverSocket:
 * $WAITING_ROOM_SOCKET, then the daemon.info file, then the default path.
 *
 * v2 also exposes the daemon's HTTP/WS URLs (when present) so browser
 * activities can subscribe via WebSocket instead of UDS.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonInfo {
  readonly pid: number;
  readonly socket_path: string;
  /** v2: HTTP base URL for browser-side activities (e.g. http://127.0.0.1:52131/). */
  readonly web_url?: string;
  /** v2: WebSocket endpoint for browser subscribers (e.g. ws://127.0.0.1:52131/ws). */
  readonly ws_url?: string;
  readonly version: string;
  readonly started_at: string;
}

/** Returns the WebSocket URL advertised by the daemon, or "" if absent. */
export function wsUrlFromInfo(): string {
  try {
    const info = JSON.parse(readFileSync(infoFilePath(), 'utf8')) as DaemonInfo;
    return info.ws_url ?? '';
  } catch {
    return '';
  }
}

/** The daemon's well-known state dir: $WAITING_ROOM_HOME or ~/.waiting-room. */
export function baseDir(): string {
  return process.env['WAITING_ROOM_HOME'] || join(homedir(), '.waiting-room');
}

export function infoFilePath(): string {
  return join(baseDir(), 'daemon.info');
}

/** Default socket path when nothing overrides it. */
export function defaultSocketPath(): string {
  const base = baseDir();
  const xdg = process.env['XDG_RUNTIME_DIR'];
  const runtimeDir =
    process.env['WAITING_ROOM_HOME'] || !xdg ? join(base, 'run') : xdg;
  return join(runtimeDir, 'waiting-room', 'daemon.sock');
}

/**
 * Candidate socket paths, most-specific first:
 * $WAITING_ROOM_SOCKET (authoritative), else the info file's advertised
 * socket, else the default path. Callers should probe each and treat a
 * dead advertised socket as stale (fall back to the default).
 */
export function socketCandidates(): [string] | [string, string] {
  const fromEnv = process.env['WAITING_ROOM_SOCKET'];
  if (fromEnv) return [fromEnv];
  const def = defaultSocketPath();
  try {
    const info = JSON.parse(readFileSync(infoFilePath(), 'utf8')) as DaemonInfo;
    if (info.socket_path && info.socket_path !== def) return [info.socket_path, def];
  } catch {
    // Absent or corrupt info file: default only.
  }
  return [def];
}
