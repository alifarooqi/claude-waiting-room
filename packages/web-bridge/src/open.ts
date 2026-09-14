/**
 * Best-effort OS browser/app launching. macOS (`open`) is the supported
 * path; the rest is a small untested fallback chain so the bridge doesn't
 * dead-end on other platforms. Failures are always non-fatal — the URL is
 * already printed for manual opening.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Resolve the launcher command for a URL on this platform. */
function urlLauncher(): { cmd: string; args: (url: string) => string[] } | undefined {
  const browser = process.env['BROWSER'];
  if (browser) return { cmd: browser, args: (u) => [u] };
  switch (process.platform) {
    case 'darwin':
      return { cmd: 'open', args: (u) => [u] };
    case 'win32':
      return { cmd: 'cmd', args: (u) => ['/c', 'start', '', u] };
    default: {
      // Linux: WSL forwards to the Windows browser when possible.
      if (
        existsSync('/proc/version') &&
        readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
      ) {
        return existsSync('/usr/bin/wslview')
          ? { cmd: '/usr/bin/wslview', args: (u) => [u] }
          : { cmd: 'explorer.exe', args: (u) => [u] };
      }
      return { cmd: 'xdg-open', args: (u) => [u] };
    }
  }
}

/**
 * Open a URL in the user's browser. Resolves true if a launcher was
 * spawned (not proof the page loaded); false if launching failed.
 */
export function openBrowser(url: string): Promise<boolean> {
  return spawnLauncher(urlLauncher(), url);
}

/**
 * Bring an application to the foreground (macOS `open -a <name>`), e.g.
 * the terminal running Claude when attention is needed. Resolves false
 * if unsupported on this platform or the launch failed. Never throws.
 */
export function activateApp(appName: string): Promise<boolean> {
  if (!appName) return Promise.resolve(false);
  if (process.platform === 'darwin') {
    // Foreground the app — this is the "snap focus back to Claude's
    // terminal" moment; no -g (that would background it).
    return spawnLauncher({ cmd: 'open', args: () => ['-a', appName] }, '');
  }
  return Promise.resolve(false);
}

function spawnLauncher(
  launcher: { cmd: string; args: (u: string) => string[] } | undefined,
  url: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!launcher) return resolve(false);
    try {
      const child = spawn(launcher.cmd, launcher.args(url), {
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', () => resolve(false)); // e.g. ENOENT (async)
      child.unref();
      resolve(true); // spawned without a synchronous error
    } catch {
      resolve(false);
    }
  });
}
