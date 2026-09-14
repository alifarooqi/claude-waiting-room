/** Bundle the web UI into dist/web with esbuild + copy static assets. */
import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const outdir = 'dist/web';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: ['src/web/main.web.tsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  outfile: `${outdir}/app.js`,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await cp('web/index.html', `${outdir}/index.html`);
await cp('web/style.css', `${outdir}/style.css`);
