// Build de produção: servidor em um único arquivo minificado + frontend com hash no nome.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });

await build({
  entryPoints: { server: 'server/index.ts', cli: 'server/cli.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['sharp'], // binário nativo: instalado na imagem final
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const web = await build({
  entryPoints: ['web/app.js', 'web/style.css'],
  outdir: 'dist/web',
  entryNames: '[name]-[hash]',
  bundle: true,
  minify: true,
  target: ['es2022', 'chrome100', 'firefox100', 'safari15'],
  metafile: true,
});

let html = await readFile('web/index.html', 'utf8');
for (const [out, meta] of Object.entries(web.metafile.outputs)) {
  const file = out.split('/').pop();
  const src = meta.entryPoint?.split('/').pop();
  if (src) html = html.replace(`/${src}"`, `/${file}"`);
}
await writeFile('dist/web/index.html', html);
await cp('web/favicon.svg', 'dist/web/favicon.svg');
await cp('web/bridge.mjs', 'dist/web/bridge.mjs'); // baixada pelo comando do painel "Local"
console.log('build ok');
