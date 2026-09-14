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
  // Mark node:* builtins AND the SDK's Node-only modules as external.
  // The browser bundle never executes the Node transport path, so these
  // imports are dead code — leaving them external prevents esbuild from
  // pulling their source (and the Node builtins they reference) into
  // the bundle. If the runtime ever does hit that path, it'll throw a
  // meaningful "module not found" instead of silently running broken code.
  external: [
    'node:fs', 'node:os', 'node:path', 'node:net', 'node:crypto', 'node:child_process',
    // SDK's Node-only modules — kept external so the browser bundle
    // doesn't pull in node:net etc. via tree-shaking through them.
    '@waiting-room/sdk/discover.js',
    '@waiting-room/sdk/transport_ipc.js',
    '@waiting-room/sdk/ensure.js',
  ],
  // Also treat string literals that match the Node-only modules as
  // external (esbuild sees them through dynamic import paths even when
  // they're in unreachable branches).
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(build) {
        build.onResolve({ filter: /^node:|^@waiting-room\/sdk\/(discover|transport_ipc|ensure)\.js$/ },
          () => ({ path: 'external', external: true }));
      },
    },
  ],
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
