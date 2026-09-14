// build-browser.mjs — bundle packages/exercise-math/src/browser.tsx into
// dist/web/{main.js,index.html,style.css} using esbuild. See
// packages/game-snake/scripts/build-browser.mjs for the full notes.

import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
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
  external: [
    'node:fs', 'node:os', 'node:path', 'node:net', 'node:crypto', 'node:child_process',
    '@waiting-room/sdk/discover.js',
    '@waiting-room/sdk/transport_ipc.js',
    '@waiting-room/sdk/ensure.js',
  ],
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

const tmplPath = join(pkgDir, 'src', 'web.html.tmpl');
if (existsSync(tmplPath)) {
  await copyFile(tmplPath, join(outDir, 'index.html'));
}

const cssPath = join(pkgDir, 'src', 'web.css');
if (existsSync(cssPath)) {
  await copyFile(cssPath, join(outDir, 'style.css'));
}

console.log(`build-browser: wrote ${outDir}/`);
