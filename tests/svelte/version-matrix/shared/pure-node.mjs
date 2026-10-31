import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Independent raw Node process: no Svelte compiler, browser condition or GLSL loader.
for (const name of ['window', 'document', 'WebGLRenderingContext', 'WebGL2RenderingContext', 'Image', 'ResizeObserver']) {
  Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error(`Pure entry accessed ${name}`); } });
}
globalThis.fetch = () => { throw new Error('Pure entry initiated an asset request'); };
const { shaders, presets, presetsArray } = await import(pathToFileURL(resolve('.fixture/pure.mjs')).href);
assert.equal(Object.keys(presets).length, 10);
assert.equal(presetsArray.length, 10);
const cases = [];
for (const shader of ['defaults', 'positionMix', 'cosmic', 'glass']) {
  for (const type of ['plane', 'sphere', 'waterPlane']) {
    assert.equal(typeof shaders[shader][type].vertex, 'string');
    assert.equal(typeof shaders[shader][type].fragment, 'string');
    assert.ok(shaders[shader][type].vertex.includes('void main'));
    assert.ok(shaders[shader][type].fragment.includes('void main'));
    cases.push(`${shader}:${type}`);
  }
}
console.log(JSON.stringify({ kind: 'raw-node-neutral-fixture-import', node: process.version, cases, presets: Object.keys(presets), finalCoreCertified: false }));
