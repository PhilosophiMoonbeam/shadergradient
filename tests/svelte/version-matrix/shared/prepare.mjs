import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const cell = process.cwd();
const shared = dirname(fileURLToPath(import.meta.url));
const repo = resolve(shared, '../../../..');
const require = createRequire(resolve(cell, 'package.json'));
const { build } = await import(require.resolve('esbuild'));
const metadata = JSON.parse(await readFile(resolve(cell, 'cell.json'), 'utf8'));
await mkdir(resolve(cell, '.fixture'), { recursive: true });
await mkdir(resolve(cell, 'results'), { recursive: true });
const material = resolve(repo, 'packages/shadergradient-vue/src/material.ts');
// Resolve the real public core dependency through its migrated Vue consumer.
const pure = await build({
  stdin: { contents: "export { shaders, presets, presetsArray } from '@shadergradient/core';", resolveDir: resolve(repo, 'packages/shadergradient-vue') },
  bundle: true, format: 'esm', platform: 'neutral',
  outfile: resolve(cell, '.fixture/pure.mjs'), metafile: true
});
const adapted = await build({
  entryPoints: [material], bundle: true, format: 'esm', platform: 'browser',
  external: ['three'],
  outfile: resolve(cell, '.fixture/material.js'), metafile: true
});
for (const name of ['App.svelte', 'Scene.svelte', 'context.js']) {
  await cp(resolve(shared, name), resolve(cell, '.fixture', name));
}
const sourcePaths = [...new Set([...Object.keys(pure.metafile.inputs), ...Object.keys(adapted.metafile.inputs)])].filter(path => path !== '<stdin>').sort();
const sources = [];
for (const path of sourcePaths) {
  const absolute = resolve(cell, path);
  sources.push({ path: relative(repo, absolute), sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') });
}
const provenance = {
  schemaVersion: 1, kind: 'canonical-public-core-fixture',
  finalCoreCertified: false, finalNativeCertified: false,
  builtAt: new Date().toISOString(), node: process.version, sources,
  output: { pure: '.fixture/pure.mjs', material: '.fixture/material.js' }
};
await writeFile(resolve(cell, 'results/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
if (metadata.kind === 'kit') {
  await mkdir(resolve(cell, 'src/routes'), { recursive: true });
  await writeFile(resolve(cell, 'src/routes/+page.svelte'), '<script>import App from "../../.fixture/App.svelte";</script>\n<App />\n');
  await writeFile(resolve(cell, 'src/app.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8" />%sveltekit.head%</head><body data-sveltekit-preload-data="hover"><div style="display: contents">%sveltekit.body%</div></body></html>\n');
  await writeFile(resolve(cell, 'tsconfig.json'), JSON.stringify({ extends: '$app/tsconfig', include: ['src', '.fixture'], exclude: ['src/service-worker'], compilerOptions: { allowJs: true, checkJs: false, strict: true, moduleResolution: 'bundler', rewriteRelativeImportExtensions: true } }, null, 2) + '\n');
  // Kit 3's own sync CLI bootstraps and generates node_modules/$app/tsconfig.json.
  // Do not hand-write a fake generated config or use removed Kit 2 config files.
  await new Promise((accept, reject) => {
    const sync = spawn(process.execPath, [resolve(cell, 'node_modules/@sveltejs/kit/svelte-kit.js'), 'sync'], {
      cwd: cell,
      stdio: 'inherit'
    });
    sync.on('error', reject);
    sync.on('close', code => code === 0 ? accept() : reject(new Error(`Kit sync exited ${code}`)));
  });
} else {
  await writeFile(resolve(cell, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shader compatibility</title></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>\n');
  await writeFile(resolve(cell, 'main.js'), 'import { hydrate } from "svelte";\nimport App from "./.fixture/App.svelte";\nwindow.__matrixBeforeHydrate = document.getElementById("app").innerHTML;\nwindow.__matrixHydrate = () => hydrate(App, { target: document.getElementById("app"), recover: false });\nif (!window.__matrixHoldHydration) window.__matrixHydrate();\n');
}
console.log(JSON.stringify({ prepared: metadata.id, provenance: 'results/provenance.json' }));
