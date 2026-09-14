#!/usr/bin/env node
/** @waiting-room/exercise-math — math quiz as a Waiting Room web
 *  activity. Serves the browser UI via @waiting-room/web-bridge and
 *  exits when the tab closes. Debug flags: --no-open, --port=<n>. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startWebActivity } from '@waiting-room/web-bridge';

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) {
    return argv[i + 1];
  }
  return undefined;
}

const noOpen = process.argv.includes('--no-open');
const portArg = argValue('--port');
const port = portArg !== undefined ? Number(portArg) : undefined;

const web = await startWebActivity({
  staticDir: join(dirname(fileURLToPath(import.meta.url)), 'web'),
  title: 'Math',
  openBrowser: !noOpen,
  port: Number.isFinite(port) ? port : undefined,
});

await web.done;
process.exit(0);
