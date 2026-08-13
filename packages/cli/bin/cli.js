#!/usr/bin/env node
// @waiting-room/cli — resolves and execs the platform-specific `waiting-room` binary.
//
// Milestone M0 placeholder. In M5 this will resolve the prebuilt binary from the
// matching `@waiting-room/cli-<platform>-<arch>` optionalDependency and exec it.
// Until then, point users at a from-source build.

process.stderr.write(
  [
    '@waiting-room/cli: no platform binary is bundled yet (milestone M5).',
    'Build the daemon from source:',
    '  make build-daemon    # -> daemon/bin/waiting-room',
    'Then either add it to PATH or copy it into this package: packages/cli/bin/.',
    '',
  ].join('\n'),
);
process.exit(1);
