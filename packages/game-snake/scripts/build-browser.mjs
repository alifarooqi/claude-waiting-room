// build-browser.mjs — bundle packages/game-snake/src/browser.tsx into
// dist/web/{main.js,index.html,style.css} using esbuild.
//
// The bash shim (wr-open) replaces the {{WR_CONFIG}} placeholder in
// index.html at runtime with the daemon's actual ws_url. So the
// bundle has no secrets baked in and no build-time env vars.
//
// Run: `node scripts/build-browser.mjs`

import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..');
const outDir = join(pkgDir, 'dist', 'web');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [join(pkgDir, 'src', 'browser.tsx')],
  bundle: true,
  outfile: join(outDir, 'main.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  // Mark node:* builtins as external — they're only imported via the
  // dynamic-import() path that runs in Node, never in the browser.
  // esbuild's static analysis can't see that, so we explicitly tell it
  // not to try to resolve them.
  external: ['node:fs', 'node:os', 'node:path', 'node:net', 'node:crypto', 'node:child_process'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

// Copy index.html template (no substitution; wr-open does it).
const tmplPath = join(pkgDir, 'src', 'web.html.tmpl');
if (existsSync(tmplPath)) {
  await copyFile(tmplPath, join(outDir, 'index.html'));
}

// Copy style.css verbatim.
const cssPath = join(pkgDir, 'src', 'web.css');
if (existsSync(cssPath)) {
  await copyFile(cssPath, join(outDir, 'style.css'));
}

console.log(`build-browser: wrote ${outDir}/`);
