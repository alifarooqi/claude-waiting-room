/**
 * Socket discovery — mirrors the Go daemon's config.Default/discoverSocket:
 * $WAITING_ROOM_SOCKET, then the daemon.info file, then the default path.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonInfo {
  readonly pid: number;
  readonly socket_path: string;
  readonly version: string;
  readonly started_at: string;
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

/** Resolve the daemon socket path (env override > info file > default). */
export function resolveSocketPath(): string {
  const fromEnv = process.env['WAITING_ROOM_SOCKET'];
  if (fromEnv) return fromEnv;
  try {
    const info = JSON.parse(readFileSync(infoFilePath(), 'utf8')) as DaemonInfo;
    if (info.socket_path) return info.socket_path;
  } catch {
    // Absent or corrupt info file: fall through to the default path.
  }
  return defaultSocketPath();
}
