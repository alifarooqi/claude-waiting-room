#!/usr/bin/env node
// @waiting-room/cli — resolves and execs the platform-specific `waiting-room`
// binary from the matching @waiting-room/cli-<platform>-<arch> optional
// dependency (installed only for the current platform, offline-friendly).
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgName = `@waiting-room/cli-${process.platform}-${process.arch}`;

let binPath;
try {
  const pkgJson = require.resolve(`${pkgName}/package.json`);
  binPath = join(dirname(pkgJson), 'bin', 'waiting-room');
} catch {
  process.stderr.write(
    `@waiting-room/cli: no binary for ${pkgName}. ` +
      'Build the daemon from source with `make build-daemon` and put it on PATH.\n',
  );
  process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  process.stderr.write(`@waiting-room/cli: failed to run binary: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
