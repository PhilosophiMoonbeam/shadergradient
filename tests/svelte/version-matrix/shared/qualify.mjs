import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const cell = process.cwd();
const shared = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(cell, 'package.json'));
const metadata = JSON.parse(await readFile('cell.json', 'utf8'));
await mkdir('results', { recursive: true });
// Preserve the previous complete run before any generated logs/HTML are replaced.
try {
  await readFile('results/result.json');
  await cp('results', resolve('results-history', `${Date.now()}-${randomUUID()}`), { recursive: true, errorOnExist: true, force: false });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const result = { schemaVersion: 1, cell: metadata.id, status: 'running', startedAt: new Date().toISOString(), node: process.version, packageManager: process.env.npm_config_user_agent ?? null, pins: metadata, resolutions: {}, lockSha256: null, steps: [], ssr: null, browser: null, finalCoreCertified: false, finalNativeCertified: false };
let server;
let browser;
let kitProcess;
let kitLog = '';
const digest = value => createHash('sha256').update(value).digest('hex');
const save = () => writeFile('results/result.json', JSON.stringify(result, null, 2) + '\n');
async function step(name, fn) {
  const item = { name, status: 'running', startedAt: new Date().toISOString() };
  result.steps.push(item);
  try { const value = await fn(); item.status = 'passed'; if (value !== undefined) item.output = value; return value; }
  catch (error) { item.status = 'failed'; item.error = error.stack ?? String(error); throw error; }
  finally { item.finishedAt = new Date().toISOString(); await save(); }
}
function command(name, args) {
  return step(name, () => new Promise((accept, reject) => {
    Object.assign(result.steps.at(-1), { command: [process.execPath, ...args], log: `${name}.log` });
    const child = spawn(process.execPath, args, { cwd: cell, env: process.env });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', async code => {
      await writeFile(`results/${name}.log`, output);
      if (code === 0) accept({ command: [process.execPath, ...args], log: `${name}.log`, exitCode: code });
      else reject(new Error(`${name} exited ${code}; see results/${name}.log`));
    });
  }));
}
try {
  await step('environment', async () => {
    for (const name of Object.keys({ ...JSON.parse(await readFile('package.json', 'utf8')).dependencies, ...JSON.parse(await readFile('package.json', 'utf8')).devDependencies })) {
      const pkg = JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8'));
      result.resolutions[name] = pkg.version;
    }
    const lock = await readFile('pnpm-lock.yaml');
    result.lockSha256 = digest(lock);
    return { platform: process.platform, architecture: process.arch, lock: 'pnpm-lock.yaml' };
  });
  await command('prepare-fixture', [resolve(shared, 'prepare.mjs')]);
  await command('raw-node', [resolve(shared, 'pure-node.mjs')]);
  const vite = await import(require.resolve('vite'));
  let html;
  let url;
  if (metadata.kind === 'plain') {
    await step('compiled-svelte-ssr', async () => {
      server = await vite.createServer({ root: cell, server: { middlewareMode: true }, appType: 'custom' });
      await writeFile('.fixture/ssr-entry.js', 'import { render } from "svelte/server"; import App from "./App.svelte"; export const renderFixture = () => render(App);\n');
      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = () => { requests++; throw new Error('Unexpected SSR asset request'); };
      let rendered;
      try {
        const module = await server.ssrLoadModule('/.fixture/ssr-entry.js');
        rendered = module.renderFixture();
      } finally { globalThis.fetch = originalFetch; }
      const body = rendered.body ?? rendered.html;
      assert.equal(typeof body, 'string');
      assert.match(body, /data-matrix-fallback/);
      assert.doesNotMatch(body, /<canvas\b/i);
      assert.equal(requests, 0);
      await writeFile('results/ssr-body.html', body);
      const template = await readFile('index.html', 'utf8');
      html = template.replace('<div id="app"></div>', `<div id="app">${body}</div>`);
      await writeFile('index.html', html);
      result.ssr = { kind: 'svelte-aware-compiled-render', bodyBytes: Buffer.byteLength(body), bodySha256: digest(body), canvasCount: 0, assetRequests: requests, command: 'Vite createServer().ssrLoadModule + svelte/server render', browserGlobals: 'absent in Node; Canvas and Scene instances gated by onMount', exactBody: 'results/ssr-body.html' };
      await server.close(); server = null;
    });
  }
  const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  await command('client-build', [viteCli, 'build']);
  if (metadata.kind === 'plain') {
    server = await vite.preview({ root: cell, preview: { host: '127.0.0.1', port: 0 } });
    url = server.resolvedUrls.local[0];
  } else {
    await step('kit-production-ssr', async () => {
      const net = await import('node:net');
      const lease = net.createServer();
      await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve));
      const port = lease.address().port;
      await new Promise(resolve => lease.close(resolve));
      kitProcess = spawn(process.execPath, ['--import', resolve(shared, 'ssr-guard.mjs'), 'build/index.js'], { cwd: cell, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ORIGIN: `http://127.0.0.1:${port}` } });
      kitProcess.stdout.on('data', data => { kitLog += data; });
      kitProcess.stderr.on('data', data => { kitLog += data; });
      url = `http://127.0.0.1:${port}/`;
      const deadline = Date.now() + 30000;
      let response;
      while (Date.now() < deadline) {
        if (kitProcess.exitCode !== null) throw new Error(`Kit server exited: ${kitLog}`);
        try { response = await fetch(url); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.ok(response?.ok, `Kit response failed: ${kitLog}`);
      html = await response.text();
      assert.match(html, /data-matrix-fallback/);
      assert.doesNotMatch(html, /<canvas\b/i);
      await writeFile('results/ssr-document.html', html);
      result.ssr = { kind: 'kit-3.1-production-node-response', documentSha256: digest(html), canvasCount: 0, assetRequests: 0, assetPolicy: 'production server fetch throws via ssr-guard.mjs', command: 'vite build; node --import ../shared/ssr-guard.mjs build/index.js', exactDocument: 'results/ssr-document.html' };
    });
  }
  await step('exact-hydration-and-twelve-shaders', async () => {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
    const diagnostics = { pageErrors: [], console: [], failedRequests: [], assetRequests: [], cases: [], hydrationExact: false, browserVersion: browser.version() };
    result.browser = diagnostics;
    page.on('pageerror', error => diagnostics.pageErrors.push(error.stack ?? String(error)));
    page.on('console', message => diagnostics.console.push({ type: message.type(), text: message.text() }));
    page.on('requestfailed', request => diagnostics.failedRequests.push({ url: request.url(), failure: request.failure() }));
    page.on('request', request => { if (/\.(?:hdr|exr)(?:\?|$)/i.test(request.url())) diagnostics.assetRequests.push(request.url()); });
    if (metadata.kind === 'plain') await page.addInitScript(() => { window.__matrixHoldHydration = true; });
    // Serve the exact HTML captured above, not a separately client-mounted approximation.
    if (metadata.kind === 'kit') await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(url);
    if (metadata.kind === 'plain') {
      await page.waitForFunction(() => typeof window.__matrixHydrate === 'function');
      const before = await page.locator('#app').innerHTML();
      const expected = await readFile('results/ssr-body.html', 'utf8');
      const normalizedExpected = await page.evaluate(body => {
        const container = document.createElement('div');
        container.innerHTML = body;
        return container.innerHTML;
      }, expected);
      assert.equal(before, normalizedExpected);
      assert.equal(await page.locator('canvas').count(), 0);
      assert.equal(await page.locator('[data-matrix-fallback]').count(), 1);
      await page.evaluate(() => window.__matrixHydrate());
    }
    await page.waitForSelector('canvas');
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal(await page.locator('[data-matrix-fallback]').count(), 0);
    const layout = await page.locator('[data-matrix-layout]').boundingBox();
    assert.equal(layout.width, 640); assert.equal(layout.height, 360);
    diagnostics.hydrationExact = true;
    for (const shader of ['defaults', 'positionMix', 'cosmic', 'glass']) for (const type of ['plane', 'sphere', 'waterPlane']) {
      const id = `${shader}:${type}`;
      await page.selectOption('[data-matrix-case]', id);
      await page.waitForFunction(id => Boolean(window.__matrixCases?.[id]), id);
      const observation = await page.evaluate(id => window.__matrixCases[id], id);
      const errors = [];
      if (observation.revision !== (metadata.three === '0.186.1' ? '186' : '180')) errors.push('Wrong Three REVISION');
      if (observation.glError !== 0) errors.push(`WebGL error ${observation.glError}`);
      if (!observation.nonzero || observation.maximum <= observation.minimum) errors.push('No nonuniform visible shader pixels');
      if (!observation.programs) errors.push('No compiled shader programs');
      if (!observation.shaderChunkUnchanged) errors.push('Global ShaderChunk mutation');
      diagnostics.cases.push({ id, status: errors.length ? 'failed' : 'passed', errors, ...observation });
      await page.locator('canvas').screenshot({ path: `results/${shader}-${type}.png` });
    }
    diagnostics.shaderErrors = await page.evaluate(() => window.__matrixShaderErrors ?? []);
    await page.click('[data-matrix-toggle]');
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 0);
    await page.click('[data-matrix-toggle]');
    await page.waitForSelector('canvas');
    diagnostics.remountCanvasCount = await page.locator('canvas').count();
    assert.equal(diagnostics.remountCanvasCount, 1);
    assert.equal(diagnostics.cases.length, 12);
    assert.ok(diagnostics.cases.every(item => item.status === 'passed'), 'At least one shader cell failed');
    assert.deepEqual(diagnostics.shaderErrors, []);
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(diagnostics.failedRequests, []);
    assert.deepEqual(diagnostics.assetRequests, []);
    assert.ok(!diagnostics.console.some(message => message.type === 'error' || /hydrat|mismatch|shader error/i.test(message.text)), 'Browser errors or hydration diagnostics');
  });
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) { if (server.close) await server.close(); else await new Promise(resolve => server.httpServer.close(resolve)); }
  if (kitProcess) {
    kitProcess.kill('SIGTERM');
    await writeFile('results/kit-server.log', kitLog);
  }
  result.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ cell: result.cell, status: result.status, result: 'results/result.json' }));
}
