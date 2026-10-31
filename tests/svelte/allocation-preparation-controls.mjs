import { chromium } from '@playwright/test'
import {
  captureAllocationWindow,
  createSourcePositionIndex,
} from './allocation-capture.mjs'
import {
  prepareAllocationMetadata,
  profileMetadata,
} from './allocation-metadata.mjs'
import { createServer } from 'node:http'
import {
  lstat,
  readdir,
  readFile,
  realpath,
  statfs,
  writeFile,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

// Standalone prospective controls only. The parent must register and create an
// empty disk-backed output root before running this CLI. No SDK verdict, source
// ownership of VM roots, historical waiver, retries, or zero-sample exemption.
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--output-dir' || !args[1])
  throw new Error(
    'Usage: node tests/svelte/allocation-preparation-controls.mjs --output-dir <registered-owned-new-root>'
  )
const outputRoot = resolve(args[1])
const rootStat = await lstat(outputRoot)
if (
  !rootStat.isDirectory() ||
  rootStat.isSymbolicLink() ||
  (await realpath(outputRoot)) !== outputRoot
)
  throw new Error(
    'Output root must be an existing real directory, not a symlink'
  )
if ((await readdir(outputRoot)).length !== 0)
  throw new Error(
    'Output root must be empty; previous evidence is never overwritten'
  )
if (Number((await statfs(outputRoot)).type) === 0x01021994)
  throw new Error('Allocation evidence must reside on disk, not tmpfs')

const limits = Object.freeze({
  cases: 12,
  repetitions: 3,
  concurrentBrowsers: 1,
  totalBrowsers: 12,
  files: 128,
  totalBytes: 32 * 1024 * 1024,
  rawProfileBytes: 8 * 1024 * 1024,
  evidenceJSONBytes: 16 * 1024 * 1024,
  summaryBytes: 1024 * 1024,
  scriptsPerCase: 128,
  sourceBytesPerCase: 2 * 1024 * 1024,
  requests: 72,
  sockets: 16,
  concurrentResponses: 4,
  deadlineMs: 180000,
  durationMs: 1000,
  timerDelayMs: 200,
  arrayElements: 4096,
  jsonRows: 4096,
})
const actualParameters = Object.freeze({
  samplingInterval: 16384,
  includeObjectsCollectedByMinorGC: true,
  includeObjectsCollectedByMajorGC: true,
})
const definitions = Object.freeze([
  {
    name: 'named-repeated-32',
    family: 'named',
    repeated: true,
    operations: 32,
    outputs: 32,
    identities: 32,
  },
  {
    name: 'named-reused-32',
    family: 'named',
    repeated: false,
    operations: 32,
    outputs: 32,
    identities: 1,
  },
  {
    name: 'json-redundant-four',
    family: 'json',
    repeated: true,
    operations: 4,
    outputs: 4,
    identities: 4,
  },
  {
    name: 'json-required-one-reused',
    family: 'json',
    repeated: false,
    operations: 1,
    outputs: 4,
    identities: 1,
    actualRequests: 0,
  },
])
const owner = randomUUID()
const startedEpochMs = Date.now()
const cancellation = new AbortController()
const sockets = new Set()
const requests = new Set()
const responses = new Set()
const httpRecords = []
let server
let activeBrowser
let totalBrowsers = 0
let filesWritten = 0
let bytesWritten = 0
let fatalError
const manifest = []
const report = {
  schemaVersion: 1,
  owner,
  outputRoot,
  startedEpochMs,
  limits,
  purpose:
    'Prepared fixed-warm prospective detector sensitivity and admission controls, never SDK qualification',
  status: 'RUNNING',
  actualParameters,
  warmProtocol:
    'Exactly one shared-helper 1000 ms / 1 byte capture of the same finite case workload, followed by exact metadata-key retention',
  actualProtocol:
    'Exactly one 1000 ms / 16384 byte capture; both collected-object flags; only start/stop CDP requests during capture',
  browserPolicy:
    'One fresh default installed Playwright Chromium per fixed case; headless; no launch arguments, JIT flags, retries or alternate browser',
  unknownRule:
    'All unresolved samples, including source-less/native/VM-root samples, remain UNKNOWN. Their presence never proves harmlessness or parser ownership.',
  historicalRule:
    'All historical failures and unknowns remain unchanged; controls cannot qualify an SDK or explain historical roots.',
  countRule:
    'Tree selfSize and weighted sample-vector bytes are separate measurements, never interchangeable exact allocation counts.',
  cases: Array.from({ length: limits.repetitions }, (_, repetition) =>
    definitions.map((definition) => ({
      id: `r${repetition + 1}-${definition.name}`,
      repetition: repetition + 1,
      ...definition,
      status: 'NOT_RUN',
    }))
  ).flat(),
  comparisons: [],
  cleanup: [],
  artifacts: manifest,
}
const payload = Array.from({ length: limits.jsonRows }, (_, index) => ({
  index,
  weight: index * 7 + 11,
  label: `prepared-json-row-${index}`,
  kind: 'deterministic-complete',
}))
const payloadText = JSON.stringify(payload)
const payloadSHA256 = sha(payloadText)

function sha(value) {
  return createHash('sha256').update(value).digest('hex')
}
function errorRecord(error) {
  return {
    name: error?.name,
    message: String(error?.message ?? error),
    stack: error?.stack,
    samplingPhase: error?.samplingPhase,
    artifactEvidence: error?.artifactEvidence,
  }
}
function demand(condition, message) {
  if (!condition) throw new Error(message)
}
function alive() {
  cancellation.signal.throwIfAborted()
  if (fatalError) throw fatalError
}
async function save(name, value, { profile = false, summary = false } = {}) {
  const text = JSON.stringify(value)
  const raw = Buffer.from(text)
  const rawLimit = summary
    ? limits.summaryBytes
    : profile
      ? limits.rawProfileBytes
      : limits.evidenceJSONBytes
  if (raw.length > rawLimit) {
    const error = new Error(`${name}: JSON exceeds ${rawLimit} byte limit`)
    error.artifactEvidence = {
      name,
      jsonBytes: raw.length,
      jsonSHA256: sha(raw),
      retained: false,
      reason: 'Bounded artifact overflow',
    }
    throw error
  }
  const compressed = name.endsWith('.gz')
  const bytes = compressed ? gzipSync(raw, { level: 6 }) : raw
  const reserve = summary ? 0 : limits.summaryBytes
  demand(
    bytes.length <=
      (profile ? limits.rawProfileBytes : limits.evidenceJSONBytes),
    `${name}: stored artifact exceeds file byte limit`
  )
  demand(
    filesWritten < limits.files - (summary ? 0 : 1),
    `${name}: file budget exceeded`
  )
  demand(
    bytesWritten + bytes.length <= limits.totalBytes - reserve,
    `${name}: total byte budget exceeded`
  )
  await writeFile(join(outputRoot, name), bytes, { flag: 'wx' })
  filesWritten++
  bytesWritten += bytes.length
  const reread = await readFile(join(outputRoot, name))
  demand(
    reread.length === bytes.length && sha(reread) === sha(bytes),
    `${name}: stored SHA/readback differs`
  )
  const decoded = compressed
    ? gunzipSync(reread, { maxOutputLength: rawLimit })
    : reread
  demand(
    sha(decoded) === sha(raw),
    `${name}: uncompressed SHA/readback differs`
  )
  const entry = {
    name,
    bytes: bytes.length,
    jsonBytes: raw.length,
    sha256: sha(reread),
    jsonSHA256: sha(decoded),
    readbackVerified: true,
  }
  if (!summary) manifest.push(entry)
  return entry
}

function fixtureSource(row, baseURL) {
  const urls = ['warm', 'actual'].map(
    (phase) => `${baseURL}data/${owner}/${row.id}/${phase}`
  )
  return `"use strict";
const sgPreparedState = {
  family: ${JSON.stringify(row.family)}, repeated: ${row.repeated}, operations: ${row.operations}, outputCount: ${row.outputs},
  phaseIndex: -1, urls: ${JSON.stringify(urls)}, outputs: new Array(${row.outputs}).fill(null), errors: new Array(4).fill(null),
  starts: new Float64Array(32), jsonStarts: new Float64Array(32), ends: new Float64Array(32),
  startOrdinals: new Int32Array(32), jsonOrdinals: new Int32Array(32), endOrdinals: new Int32Array(32),
  initiated: 0, completed: 0, pending: 0, errorCount: 0, requestCount: 0, parseCount: 0, arrayAllocations: 0, ordinal: 0,
  armEpochMs: 0, timerFiredEpochMs: 0, lastCompleteEpochMs: 0, timer: 0,
  reusedArray: ${row.family === 'named' && !row.repeated ? 'new Array(4096)' : 'null'}, reusedReference: null,
  reusedParsed: null, parsedReference: null
};
if (sgPreparedState.reusedArray) {
  for (let index = 0; index < 4096; index++) sgPreparedState.reusedArray[index] = index * 3 + 7;
  sgPreparedState.reusedReference = sgPreparedState.reusedArray;
}
function sgPreparedAllocateNamed(index) {
  const state = sgPreparedState;
  state.starts[index] = Date.now(); state.startOrdinals[index] = ++state.ordinal; state.initiated++;
  const output = new Array(4096);
  for (let element = 0; element < 4096; element++) output[element] = element * 3 + 7;
  state.arrayAllocations++; state.outputs[index] = output;
  state.ends[index] = Date.now(); state.endOrdinals[index] = ++state.ordinal; state.completed++;
}
function sgPreparedUseReused(index) {
  const state = sgPreparedState;
  state.starts[index] = Date.now(); state.startOrdinals[index] = ++state.ordinal; state.initiated++;
  state.outputs[index] = state.reusedArray;
  state.ends[index] = Date.now(); state.endOrdinals[index] = ++state.ordinal; state.completed++;
}
function sgPreparedUseParsedResult() {
  const state = sgPreparedState;
  if (state.reusedParsed === null) throw new Error('Required warm parsed control object is missing');
  if (state.phaseIndex === 1) {
    state.starts[0] = Date.now(); state.startOrdinals[0] = ++state.ordinal; state.initiated++;
  }
  for (let output = 0; output < state.outputCount; output++) state.outputs[output] = state.reusedParsed;
  if (state.phaseIndex === 1) {
    state.ends[0] = Date.now(); state.endOrdinals[0] = ++state.ordinal; state.completed++;
    state.lastCompleteEpochMs = Date.now();
  }
}
async function sgPreparedResponseJson(response, index) {
  const state = sgPreparedState;
  state.jsonStarts[index] = Date.now(); state.jsonOrdinals[index] = ++state.ordinal; state.parseCount++;
  return await response.json();
}
async function sgPreparedFetchAndParse(index) {
  const state = sgPreparedState;
  state.starts[index] = Date.now(); state.startOrdinals[index] = ++state.ordinal; state.initiated++; state.pending++;
  state.requestCount++;
  try {
    const response = await fetch(state.urls[state.phaseIndex], { cache: 'no-store' });
    if (!response.ok) throw new Error('Owned JSON response was not successful');
    const result = await sgPreparedResponseJson(response, index);
    if (state.repeated) state.outputs[index] = result;
    else {
      state.reusedParsed = result; state.parsedReference = result;
      sgPreparedUseParsedResult();
    }
    state.ends[index] = Date.now(); state.endOrdinals[index] = ++state.ordinal; state.completed++;
  } catch (error) {
    if (state.errorCount < state.errors.length) state.errors[state.errorCount] = String(error);
    state.errorCount++;
  } finally {
    state.pending--;
    if (state.pending === 0) state.lastCompleteEpochMs = Date.now();
  }
}
function sgPreparedDriver() {
  const state = sgPreparedState;
  state.timer = 0; state.timerFiredEpochMs = Date.now();
  if (state.family === 'named') {
    for (let index = 0; index < state.operations; index++) {
      if (state.repeated) sgPreparedAllocateNamed(index); else sgPreparedUseReused(index);
    }
    state.lastCompleteEpochMs = Date.now();
  } else if (!state.repeated && state.phaseIndex === 1) sgPreparedUseParsedResult();
  else for (let index = 0; index < state.operations; index++) void sgPreparedFetchAndParse(index);
}
function sgPreparedReset() {
  const state = sgPreparedState;
  if (state.pending !== 0 || state.timer !== 0) throw new Error('Warm work is still pending');
  if (state.phaseIndex >= 1) throw new Error('No repeated warm or actual phase is allowed');
  state.phaseIndex++;
  state.outputs.fill(null); state.errors.fill(null);
  state.starts.fill(0); state.jsonStarts.fill(0); state.ends.fill(0);
  state.startOrdinals.fill(0); state.jsonOrdinals.fill(0); state.endOrdinals.fill(0);
  state.initiated = 0; state.completed = 0; state.pending = 0; state.errorCount = 0;
  state.requestCount = 0; state.parseCount = 0; state.arrayAllocations = 0; state.ordinal = 0;
  state.armEpochMs = 0; state.timerFiredEpochMs = 0; state.lastCompleteEpochMs = 0;
}
function sgPreparedArm() {
  const state = sgPreparedState;
  if (state.pending !== 0 || state.timer !== 0 || state.initiated !== 0) throw new Error('Phase was not reset');
  state.armEpochMs = Date.now();
  state.timer = setTimeout(sgPreparedDriver, ${limits.timerDelayMs});
}
function sgPreparedSnapshot() {
  const state = sgPreparedState;
  const identityIndices = new Array(state.outputCount);
  for (let index = 0; index < state.outputCount; index++) identityIndices[index] = state.outputs.indexOf(state.outputs[index]);
  return {
    epochMs: Date.now(), phaseIndex: state.phaseIndex, outputs: state.outputs, identityIndices,
    reusedReferencePreserved: state.reusedArray === state.reusedReference,
    reusedParsedReferencePreserved: state.reusedParsed !== null && state.reusedParsed === state.parsedReference,
    starts: Array.from(state.starts), jsonStarts: Array.from(state.jsonStarts), ends: Array.from(state.ends),
    startOrdinals: Array.from(state.startOrdinals), jsonOrdinals: Array.from(state.jsonOrdinals), endOrdinals: Array.from(state.endOrdinals),
    initiated: state.initiated, completed: state.completed, pending: state.pending, timerPending: state.timer !== 0,
    errorCount: state.errorCount, errors: state.errors, requestCount: state.requestCount, parseCount: state.parseCount, arrayAllocations: state.arrayAllocations,
    armEpochMs: state.armEpochMs, timerFiredEpochMs: state.timerFiredEpochMs, lastCompleteEpochMs: state.lastCompleteEpochMs
  };
}
void 0;
`
}

function outputProof(snapshot, row) {
  let valid =
    Array.isArray(snapshot.outputs) && snapshot.outputs.length === row.outputs
  const hashes = []
  let valuesChecked = 0
  for (const output of snapshot.outputs ?? []) {
    if (
      !Array.isArray(output) ||
      output.length !==
        (row.family === 'named' ? limits.arrayElements : limits.jsonRows)
    ) {
      valid = false
      continue
    }
    for (let index = 0; index < output.length; index++) {
      if (row.family === 'named') {
        if (output[index] !== index * 3 + 7) valid = false
        valuesChecked++
      } else {
        const record = output[index]
        if (
          !record ||
          Object.keys(record).length !== 4 ||
          record.index !== index ||
          record.weight !== index * 7 + 11 ||
          record.label !== `prepared-json-row-${index}` ||
          record.kind !== 'deterministic-complete'
        )
          valid = false
        valuesChecked += 4
      }
    }
    hashes.push(sha(JSON.stringify(output)))
  }
  const expected =
    row.family === 'named'
      ? sha(
          JSON.stringify(
            Array.from(
              { length: limits.arrayElements },
              (_, index) => index * 3 + 7
            )
          )
        )
      : payloadSHA256
  const identities = new Set(snapshot.identityIndices).size
  return {
    valid:
      valid &&
      hashes.length === row.outputs &&
      hashes.every((hash) => hash === expected) &&
      identities === row.identities &&
      (row.repeated ||
        (row.family === 'named'
          ? snapshot.reusedReferencePreserved
          : snapshot.reusedParsedReferencePreserved)),
    valuesChecked,
    outputCount: snapshot.outputs?.length,
    identityIndices: snapshot.identityIndices,
    distinctIdentities: identities,
    expectedIdentities: row.identities,
    fullOutputSHA256: hashes,
    expectedOutputSHA256: expected,
    reusedReferencePreserved: snapshot.reusedReferencePreserved,
    reusedParsedReferencePreserved: snapshot.reusedParsedReferencePreserved,
  }
}
function admission(snapshot, timing, clock, row, phase, records) {
  const marginMs = clock.uncertaintyMs + 5
  const lower = timing.startAcknowledgedEpochMs + marginMs
  const upper = timing.stopRequestEpochMs - marginMs
  const expectedRequests =
    row.family !== 'json'
      ? 0
      : phase === 'actual' && !row.repeated
        ? 0
        : row.operations
  const operations = Array.from({ length: row.operations }, (_, index) => ({
    index,
    startedEpochMs: snapshot.starts[index],
    jsonStartedEpochMs: snapshot.jsonStarts[index],
    completedEpochMs: snapshot.ends[index],
    startOrdinal: snapshot.startOrdinals[index],
    jsonOrdinal: snapshot.jsonOrdinals[index],
    endOrdinal: snapshot.endOrdinals[index],
  }))
  const ownedHTTP = records.filter(
    (record) => record.caseId === row.id && record.phase === phase
  )
  const httpComplete =
    ownedHTTP.length === expectedRequests &&
    ownedHTTP.every(
      (record) =>
        record.receivedEpochMs > lower &&
        record.finishedEpochMs >= record.receivedEpochMs &&
        record.finishedEpochMs < upper &&
        !record.aborted
    )
  const complete =
    snapshot.phaseIndex === (phase === 'warm' ? 0 : 1) &&
    snapshot.initiated === row.operations &&
    snapshot.completed === row.operations &&
    snapshot.pending === 0 &&
    !snapshot.timerPending &&
    snapshot.errorCount === 0 &&
    snapshot.timerFiredEpochMs > lower &&
    snapshot.lastCompleteEpochMs < upper &&
    snapshot.requestCount === expectedRequests &&
    snapshot.parseCount === expectedRequests &&
    snapshot.arrayAllocations ===
      (row.family === 'named' && row.repeated ? 32 : 0) &&
    operations.every(
      (operation) =>
        operation.startedEpochMs > lower &&
        operation.completedEpochMs >= operation.startedEpochMs &&
        operation.completedEpochMs < upper &&
        operation.startOrdinal > 0 &&
        operation.endOrdinal > operation.startOrdinal &&
        (expectedRequests === 0 ||
          (operation.jsonStartedEpochMs >= operation.startedEpochMs &&
            operation.jsonStartedEpochMs <= operation.completedEpochMs &&
            operation.jsonOrdinal > operation.startOrdinal &&
            operation.endOrdinal > operation.jsonOrdinal))
    ) &&
    httpComplete
  return {
    status: complete ? 'COMPLETE' : 'INCOMPLETE',
    marginMs,
    strictStartEpochMs: lower,
    strictEndEpochMs: upper,
    operations,
    expectedRequests,
    observedRequests: snapshot.requestCount,
    observedParses: snapshot.parseCount,
    httpComplete,
    http: ownedHTTP,
  }
}

function analyze(profile, sourceMap, fixture, row) {
  demand(
    profile && profile.head && Array.isArray(profile.samples),
    'Malformed sampling profile'
  )
  const nodeMap = new Map()
  const duplicates = []
  const pending = [{ node: profile.head, path: [] }]
  const sources = new Map(sourceMap.map((source) => [source.scriptId, source]))
  const sites = []
  let treeBytes = 0
  while (pending.length) {
    const { node, path } = pending.pop()
    demand(
      node &&
        typeof node === 'object' &&
        Number.isSafeInteger(node.id) &&
        node.callFrame &&
        Array.isArray(node.children),
      'Malformed profile tree node'
    )
    demand(nodeMap.size < 65536, 'Profile tree exceeds node budget')
    if (nodeMap.has(node.id)) {
      duplicates.push(node.id)
      continue
    }
    demand(
      Number.isFinite(node.selfSize) && node.selfSize >= 0,
      'Invalid tree selfSize'
    )
    const fullPath = [...path, node.callFrame]
    const sourceFrames = fullPath.map((frame) => {
      const source = sources.get(frame.scriptId)
      const offset =
        source?.index.offsetAt(
          frame.lineNumber,
          frame.columnNumber,
          source.startLine,
          source.startColumn
        ) ?? null
      return {
        ...frame,
        sourceSHA256: source?.sha256 ?? null,
        offset,
        sourceBound: Boolean(
          source &&
          source.url === frame.url &&
          offset !== null &&
          source.contextBound
        ),
      }
    })
    const knownNamed = sourceFrames.some(
      (frame) =>
        frame.functionName === 'sgPreparedAllocateNamed' &&
        frame.scriptId === fixture.scriptId &&
        frame.url === fixture.url &&
        frame.sourceBound &&
        frame.offset >= fixture.namedStart &&
        frame.offset < fixture.namedEnd
    )
    const knownJSON = sourceFrames.some(
      (frame) =>
        frame.functionName === 'sgPreparedResponseJson' &&
        frame.scriptId === fixture.scriptId &&
        frame.url === fixture.url &&
        frame.sourceBound &&
        frame.offset >= fixture.jsonStart &&
        frame.offset < fixture.jsonEnd
    )
    const sourceBoundPath = sourceFrames.some((frame) => frame.sourceBound)
    const site = {
      nodeId: node.id,
      treeSelfSize: node.selfSize,
      zeroSelf: node.selfSize === 0,
      path: sourceFrames,
      knownNamedPath: knownNamed,
      knownJSONCallPath: knownJSON,
      sourceBoundPath,
      sourceUnresolved: !sourceFrames[sourceFrames.length - 1].sourceBound,
      weightedBytes: 0,
      sampleIndices: [],
    }
    sites.push(site)
    nodeMap.set(node.id, site)
    treeBytes += node.selfSize
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push({ node: node.children[index], path: fullPath })
  }
  const orphans = []
  const ordinals = new Set()
  const duplicateOrdinals = []
  let weightedBytes = 0
  for (let index = 0; index < profile.samples.length; index++) {
    const sample = profile.samples[index]
    demand(
      Number.isSafeInteger(sample.nodeId) &&
        Number.isFinite(sample.size) &&
        sample.size >= 0 &&
        Number.isSafeInteger(sample.ordinal),
      'Malformed sample-vector entry'
    )
    if (ordinals.has(sample.ordinal)) duplicateOrdinals.push(sample.ordinal)
    ordinals.add(sample.ordinal)
    weightedBytes += sample.size
    const site = nodeMap.get(sample.nodeId)
    if (site) {
      site.weightedBytes += sample.size
      site.sampleIndices.push(index)
    } else orphans.push({ rawSampleIndex: index, ...sample })
  }
  const sum = (predicate, field) =>
    sites.reduce(
      (total, site) => total + (predicate(site) ? site[field] : 0),
      0
    )
  const coverage = {
    complete:
      !duplicates.length && !orphans.length && !duplicateOrdinals.length,
    nodes: sites.length,
    zeroSelfNodes: sites.filter((site) => site.zeroSelf).length,
    sampleEntries: profile.samples.length,
    representedEntries: sites.reduce(
      (count, site) => count + site.sampleIndices.length,
      0
    ),
    duplicateTreeNodeIds: duplicates,
    orphanSamples: orphans,
    duplicateSampleOrdinals: duplicateOrdinals,
    zeroSelfSampleNodeIds: sites
      .filter((site) => site.zeroSelf && site.sampleIndices.length)
      .map((site) => site.nodeId),
  }
  return {
    family: row.family,
    treeBytes,
    weightedBytes,
    coverage,
    knownNamedTreeBytes: sum((site) => site.knownNamedPath, 'treeSelfSize'),
    knownNamedWeightedBytes: sum(
      (site) => site.knownNamedPath,
      'weightedBytes'
    ),
    knownJSONCallTreeBytes: sum(
      (site) => site.knownJSONCallPath,
      'treeSelfSize'
    ),
    knownJSONCallWeightedBytes: sum(
      (site) => site.knownJSONCallPath,
      'weightedBytes'
    ),
    unresolvedTreeBytes: sum((site) => site.sourceUnresolved, 'treeSelfSize'),
    unresolvedWeightedBytes: sum(
      (site) => site.sourceUnresolved,
      'weightedBytes'
    ),
    unresolvedSampleCount:
      sites.reduce(
        (total, site) =>
          total + (site.sourceUnresolved ? site.sampleIndices.length : 0),
        0
      ) + orphans.length,
    sites,
    rule: 'All tree nodes, zero-self ancestors, vector-only anomalies and unresolved roots retained. Source-less paths are UNKNOWN, not a native-function whitelist.',
  }
}
function totals(analysis) {
  if (!analysis) return null
  const { sites, ...rest } = analysis
  return rest
}

function handleHTTP(request, response) {
  requests.add(request)
  responses.add(response)
  request.once('close', () => requests.delete(request))
  request.once('error', (error) => {
    fatalError ??= error
  })
  response.once('close', () => responses.delete(response))
  response.once('error', (error) => {
    fatalError ??= error
  })
  if (httpRecords.length >= limits.requests) {
    fatalError ??= new Error('HTTP request budget exceeded')
    response.writeHead(503).end('Request budget exceeded')
    return
  }
  const url = new URL(request.url, 'http://127.0.0.1')
  const parts = url.pathname.split('/')
  const record = {
    path: url.pathname,
    receivedEpochMs: Date.now(),
    finishedEpochMs: 0,
    aborted: false,
  }
  httpRecords.push(record)
  response.once('finish', () => {
    record.finishedEpochMs = Date.now()
  })
  response.once('close', () => {
    if (!response.writableFinished) record.aborted = true
  })
  if (url.pathname === `/${owner}/`) {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(
      '<!doctype html><html><head><title>Prepared allocation controls</title><link rel="icon" href="data:,"></head><body></body></html>'
    )
  } else if (
    parts.length === 6 &&
    parts[1] === owner &&
    parts[2] === 'data' &&
    parts[3] === owner &&
    report.cases.some((row) => row.id === parts[4]) &&
    ['warm', 'actual'].includes(parts[5])
  ) {
    record.caseId = parts[4]
    record.phase = parts[5]
    if (responses.size > limits.concurrentResponses) {
      fatalError ??= new Error('Concurrent HTTP response budget exceeded')
      response.writeHead(503).end('Concurrency budget exceeded')
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(payloadText),
    })
    response.end(payloadText)
  } else {
    fatalError ??= new Error(`Unexpected owned HTTP request: ${url.pathname}`)
    response.writeHead(404).end('Unknown owned resource')
  }
}

async function runCase(row, baseURL) {
  let browser, context, cdp, browserSession, prepared
  const commands = []
  const scripts = new Map()
  const contexts = new Map()
  const lifecycle = []
  const failures = []
  const sourceMap = new Map()
  let contextId,
    contextUniqueId,
    sessionKey,
    active = false,
    phase = 'setup',
    identityInvalid = false
  let warmCapture,
    actualCapture,
    warmSnapshot,
    actualSnapshot,
    warmAnalysis,
    actualAnalysis,
    readSnapshot,
    fixtureInput
  let emergencyCapture, failedSnapshot
  row.status = 'RUNNING'
  row.cleanup = []
  const recordFailure = (error) => {
    if (failures.length < 16) failures.push(errorRecord(error))
    else fatalError ??= new Error('Browser failure-record budget exceeded')
  }
  try {
    alive()
    demand(
      !activeBrowser && responses.size === 0,
      'Prior browser or HTTP work remains active'
    )
    totalBrowsers++
    demand(
      totalBrowsers <= limits.totalBrowsers,
      'Browser acquisition budget exceeded'
    )
    browser = await chromium.launch({ headless: true, timeout: 15000 })
    activeBrowser = browser
    browserSession = await browser.newBrowserCDPSession()
    row.actualVersion = await browserSession.send('Browser.getVersion')
    row.browserVersion = browser.version()
    const targetSessionId = randomUUID()
    row.browserIdentity = {
      owner,
      acquisitionOrdinal: totalBrowsers,
      targetSessionId,
    }
    await browserSession.detach()
    browserSession = undefined
    context = await browser.newContext()
    context.setDefaultTimeout(10000)
    const page = await context.newPage()
    page.on('pageerror', recordFailure)
    page.on('requestfailed', (request) =>
      recordFailure(
        new Error(`${request.url()}: ${request.failure()?.errorText}`)
      )
    )
    cdp = await context.newCDPSession(page)
    sessionKey = `${owner}/${row.id}/${randomUUID()}`
    cdp.on('Runtime.executionContextCreated', ({ context: created }) => {
      contexts.set(created.id, created)
      if (contexts.size > 8) identityInvalid = true
    })
    cdp.on('Runtime.executionContextDestroyed', (event) => {
      if (
        event.executionContextId === contextId ||
        event.executionContextUniqueId === contextUniqueId
      )
        identityInvalid = true
      if (lifecycle.length < 16) lifecycle.push({ type: 'destroyed', ...event })
      else identityInvalid = true
    })
    cdp.on('Runtime.executionContextsCleared', () => {
      if (contextId !== undefined) identityInvalid = true
    })
    cdp.on('Debugger.scriptParsed', (parsed) => {
      if (
        scripts.size >= limits.scriptsPerCase &&
        !scripts.has(parsed.scriptId)
      ) {
        identityInvalid = true
        return
      }
      if (scripts.has(parsed.scriptId)) identityInvalid = true
      scripts.set(parsed.scriptId, parsed)
    })
    await cdp.send('Runtime.enable')
    await cdp.send('Debugger.enable', {
      maxScriptsCacheSize: limits.sourceBytesPerCase,
    })
    await page.goto(baseURL, { waitUntil: 'load', timeout: 10000 })
    const mainContexts = [...contexts.values()].filter(
      (value) =>
        value.auxData?.isDefault && value.origin === new URL(baseURL).origin
    )
    demand(
      mainContexts.length === 1,
      'Default owned execution context is ambiguous'
    )
    contextId = mainContexts[0].id
    contextUniqueId = mainContexts[0].uniqueId
    demand(
      typeof contextUniqueId === 'string' && contextUniqueId.length > 0,
      'Execution-context unique identity is unavailable'
    )
    row.contextIdentity = {
      sessionKey,
      executionContextId: contextId,
      executionContextUniqueId: contextUniqueId,
      target: (await cdp.send('Target.getTargetInfo')).targetInfo,
    }
    const tracked = {
      send: async (method, parameters) => {
        demand(commands.length < 128, 'CDP command audit budget exceeded')
        if (active && method !== 'HeapProfiler.stopSampling')
          throw new Error(`Forbidden in-window CDP request: ${method}`)
        const entry = {
          phase,
          method,
          requestEpochMs: Date.now(),
          activeBeforeRequest: active,
        }
        commands.push(entry)
        if (method === 'HeapProfiler.startSampling') active = true
        try {
          const result = await cdp.send(method, parameters)
          entry.acknowledgedEpochMs = Date.now()
          if (method === 'HeapProfiler.stopSampling') active = false
          return result
        } catch (error) {
          entry.error = errorRecord(error)
          throw error
        }
      },
    }
    async function compile(name, expression) {
      const url = `sg-prepared-allocation://${owner}/${row.id}/${name}.js`
      const result = await tracked.send('Runtime.compileScript', {
        expression,
        sourceURL: url,
        persistScript: true,
        executionContextId: contextId,
      })
      demand(
        result.scriptId && !result.exceptionDetails,
        `Compilation failed: ${name}: ${JSON.stringify(result.exceptionDetails)}`
      )
      return {
        scriptId: result.scriptId,
        url,
        expression,
        kind: 'single-use-compiled-fixture',
      }
    }
    function command(name, expression) {
      const url = `sg-prepared-allocation://${owner}/${row.id}/${name}.js`
      return {
        url,
        expression: `${expression}\n//# sourceURL=${url}`,
        kind: 'outside-sampling-evaluation',
      }
    }
    async function run(script) {
      // Persisted inspector scripts are consumed by runScript. Only the fixture
      // is run once; repeated commands call its existing functions outside sampling.
      const result =
        script.kind === 'outside-sampling-evaluation'
          ? await tracked.send('Runtime.evaluate', {
              expression: script.expression,
              contextId,
              returnByValue: true,
              awaitPromise: false,
            })
          : await tracked.send('Runtime.runScript', {
              scriptId: script.scriptId,
              executionContextId: contextId,
              returnByValue: true,
              awaitPromise: false,
            })
      demand(
        !result.exceptionDetails,
        `Compiled script failed: ${script.url}: ${JSON.stringify(result.exceptionDetails)}`
      )
      return result.result.value
    }
    const fixture = await compile('fixture', fixtureSource(row, baseURL))
    const reset = command('reset', 'sgPreparedReset(); void 0;')
    const arm = command('arm', 'sgPreparedArm(); void 0;')
    const snapshot = command('snapshot', 'sgPreparedSnapshot();')
    fixture.namedStart = fixture.expression.indexOf(
      'function sgPreparedAllocateNamed('
    )
    fixture.namedEnd = fixture.expression.indexOf(
      'function sgPreparedUseReused('
    )
    fixture.jsonStart = fixture.expression.indexOf(
      'async function sgPreparedResponseJson('
    )
    fixture.jsonEnd = fixture.expression.indexOf(
      'async function sgPreparedFetchAndParse('
    )
    await save(`${row.id}.inputs.json.gz`, {
      owner,
      row: { ...row },
      contextIdentity: row.contextIdentity,
      sources: [fixture, reset, arm, snapshot],
      payloadSHA256,
      parameters: actualParameters,
      limits,
    })
    await run(fixture)
    fixtureInput = fixture
    readSnapshot = () => run(snapshot)
    const clockObservations = []
    for (let index = 0; index < 3; index++) {
      const before = Date.now()
      const value = await run(snapshot)
      const after = Date.now()
      clockObservations.push({
        before,
        browserEpochMs: value.epochMs,
        after,
        offsetLowMs: value.epochMs - after,
        offsetHighMs: value.epochMs - before,
      })
    }
    const low = Math.max(...clockObservations.map((value) => value.offsetLowMs))
    const high = Math.min(
      ...clockObservations.map((value) => value.offsetHighMs)
    )
    demand(low <= high, 'Host/browser epoch clock bounds are inconsistent')
    row.clock = {
      observations: clockObservations,
      offsetLowMs: low,
      offsetHighMs: high,
      uncertaintyMs: Math.max(Math.abs(low), Math.abs(high)),
    }
    async function captureSources(scriptIds) {
      for (const scriptId of new Set(scriptIds)) {
        if (!scriptId || scriptId === '0') continue
        const parsed = scripts.get(scriptId)
        demand(parsed, `No scriptParsed identity for ${scriptId}`)
        const { scriptSource } = await tracked.send(
          'Debugger.getScriptSource',
          { scriptId }
        )
        demand(
          typeof scriptSource === 'string',
          `No source text for ${scriptId}`
        )
        const textBytes = Buffer.byteLength(scriptSource)
        const previous = sourceMap.get(scriptId)
        const hash = sha(scriptSource)
        if (previous)
          demand(
            previous.sha256 === hash &&
              previous.url === parsed.url &&
              previous.executionContextId === parsed.executionContextId,
            `Source identity changed: ${scriptId}`
          )
        else {
          demand(
            [...sourceMap.values()].reduce(
              (total, source) => total + source.bytes,
              0
            ) +
              textBytes <=
              limits.sourceBytesPerCase,
            'Captured source byte budget exceeded'
          )
          sourceMap.set(scriptId, {
            sessionKey,
            scriptId,
            url: parsed.url,
            executionContextId: parsed.executionContextId,
            executionContextUniqueId:
              contexts.get(parsed.executionContextId)?.uniqueId ?? null,
            contextBound:
              parsed.executionContextId === contextId &&
              contexts.get(parsed.executionContextId)?.uniqueId ===
                contextUniqueId,
            startLine: parsed.startLine,
            startColumn: parsed.startColumn,
            protocolHash: parsed.hash,
            sha256: hash,
            bytes: textBytes,
            source: scriptSource,
            index: createSourcePositionIndex(scriptSource),
          })
        }
      }
    }
    const compiledInputs = [fixture]
    row.outsideSamplingCommands = [reset, arm, snapshot].map(
      ({ url, expression, kind }) => ({
        url,
        expressionSHA256: sha(expression),
        kind,
      })
    )
    await captureSources(compiledInputs.map((script) => script.scriptId))
    row.compiledSourceReadback = compiledInputs.map((script) => ({
      scriptId: script.scriptId,
      url: script.url,
      inputSHA256: sha(script.expression),
      capturedSHA256: sourceMap.get(script.scriptId)?.sha256 ?? null,
      equal: sourceMap.get(script.scriptId)?.source === script.expression,
    }))
    demand(
      row.compiledSourceReadback.every((source) => source.equal),
      'Compiled input/source readback differs before warm'
    )
    await run(reset)
    const warmBefore = await run(snapshot)
    demand(
      warmBefore.pending === 0 &&
        warmBefore.initiated === 0 &&
        warmBefore.outputs.every((value) => value === null),
      'Warm phase did not begin empty'
    )
    await run(arm)
    phase = 'warm'
    row.preparationTiming = {
      startedEpochMs: Date.now(),
      completedEpochMs: null,
      durationMs: null,
      scope:
        'Warm capture plus metadata-key retention only, excluded from the actual measurement',
    }
    try {
      prepared = await prepareAllocationMetadata(tracked, {
        durationMs: limits.durationMs,
      })
      warmCapture = {
        profile: prepared.profile,
        timing: prepared.timing,
        parameters: prepared.parameters,
        metadata: prepared.metadata,
      }
    } catch (error) {
      warmCapture = error.metadataPreparation
      throw error
    } finally {
      row.preparationTiming.completedEpochMs = Date.now()
      row.preparationTiming.durationMs =
        row.preparationTiming.completedEpochMs -
        row.preparationTiming.startedEpochMs
    }
    phase = 'between'
    warmSnapshot = await run(snapshot)
    row.warmTiming = warmCapture.timing
    row.warmAdmission = admission(
      warmSnapshot,
      warmCapture.timing,
      row.clock,
      row,
      'warm',
      httpRecords
    )
    row.warmOutput = outputProof(warmSnapshot, row)
    demand(
      row.warmAdmission.status === 'COMPLETE' && row.warmOutput.valid,
      'Warm operations incomplete or incorrect; no actual capture is admitted'
    )
    await captureSources([
      ...prepared.metadata.resolvedScripts.map((value) => value.scriptId),
      fixture.scriptId,
    ])
    warmAnalysis = analyze(
      warmCapture.profile,
      [...sourceMap.values()],
      fixture,
      row
    )
    demand(
      warmAnalysis.coverage.complete,
      'Warm sample-vector/tree coverage is incomplete'
    )
    row.warmMetadataBinding = prepared.metadata.resolvedScripts.map(
      (frame) => ({
        ...frame,
        sourceSHA256: sourceMap.get(frame.scriptId)?.sha256 ?? null,
        contextBound: sourceMap.get(frame.scriptId)?.contextBound ?? false,
      })
    )
    demand(
      row.warmMetadataBinding.every((frame) => frame.contextBound),
      'Warm sampled script identity is not bound to the unchanged owned context'
    )
    await run(reset)
    const actualBefore = await run(snapshot)
    row.actualReset = {
      phaseIndex: actualBefore.phaseIndex,
      initiated: actualBefore.initiated,
      completed: actualBefore.completed,
      pending: actualBefore.pending,
      timerPending: actualBefore.timerPending,
      requestCount: actualBefore.requestCount,
      parseCount: actualBefore.parseCount,
      arrayAllocations: actualBefore.arrayAllocations,
      outputSlotsEmpty: actualBefore.outputs.every((value) => value === null),
      reusedReferencePreserved: actualBefore.reusedReferencePreserved,
      reusedParsedReferencePreserved:
        actualBefore.reusedParsedReferencePreserved,
      explicitRetainedControl: row.repeated
        ? null
        : row.family === 'named'
          ? 'Preexisting array'
          : 'One required warm parsed JSON object',
    }
    demand(
      actualBefore.phaseIndex === 1 &&
        actualBefore.initiated === 0 &&
        actualBefore.completed === 0 &&
        actualBefore.pending === 0 &&
        !actualBefore.timerPending &&
        actualBefore.requestCount === 0 &&
        actualBefore.parseCount === 0 &&
        actualBefore.arrayAllocations === 0 &&
        row.actualReset.outputSlotsEmpty &&
        responses.size === 0 &&
        requests.size === 0,
      'Warm carry-in or counters/outputs survived reset'
    )
    alive()
    await run(arm)
    phase = 'actual'
    actualCapture = await captureAllocationWindow(tracked, limits.durationMs, {
      ...actualParameters,
      signal: cancellation.signal,
    })
    phase = 'postactual'
    actualSnapshot = await run(snapshot)
    row.actualTiming = actualCapture.timing
    row.actualAdmission = admission(
      actualSnapshot,
      actualCapture.timing,
      row.clock,
      row,
      'actual',
      httpRecords
    )
    row.actualOutput = outputProof(actualSnapshot, row)
    row.metadataCoverage = prepared.validate(actualCapture.profile)
    const actualMetadata = profileMetadata(actualCapture.profile)
    await captureSources([
      ...sourceMap.keys(),
      ...actualMetadata.resolvedScripts.map((value) => value.scriptId),
    ])
    actualAnalysis = analyze(
      actualCapture.profile,
      [...sourceMap.values()],
      fixture,
      row
    )
    row.sourceIdentityStable =
      !identityInvalid && contexts.get(contextId)?.uniqueId === contextUniqueId
    row.actualProtocolCommands = commands.filter(
      (command) => command.phase === 'actual'
    )
    const actualOnlyStartStop =
      row.actualProtocolCommands.length === 2 &&
      row.actualProtocolCommands[0].method === 'HeapProfiler.startSampling' &&
      row.actualProtocolCommands[1].method === 'HeapProfiler.stopSampling'
    row.protocolComplete =
      actualOnlyStartStop &&
      row.sourceIdentityStable &&
      row.metadataCoverage.complete &&
      row.actualAdmission.status === 'COMPLETE' &&
      row.actualOutput.valid &&
      actualAnalysis.coverage.complete &&
      failures.length === 0
    const namedDetected =
      actualAnalysis.knownNamedTreeBytes > 0 &&
      actualAnalysis.knownNamedWeightedBytes > 0
    const asyncNativeUnresolvedObserved =
      actualAnalysis.unresolvedTreeBytes > 0 &&
      actualAnalysis.unresolvedWeightedBytes > 0
    const positiveObserved =
      row.family === 'named' ? namedDetected : asyncNativeUnresolvedObserved
    row.oracle = {
      verdict: !row.protocolComplete
        ? 'INCOMPLETE'
        : row.repeated
          ? positiveObserved
            ? 'REJECT_KNOWN_AVOIDABLE_WORK'
            : 'DETECTOR_NOT_DEMONSTRATED'
          : row.family === 'named'
            ? 'REUSED_ARRAY_COMPARATOR'
            : 'WARM_REQUIRED_PARSE_REUSED_WITH_ZERO_ACTUAL_REQUESTS',
      detectorDemonstrated: row.repeated
        ? row.protocolComplete && positiveObserved
        : null,
      namedExactSourcePathDetected: namedDetected,
      asyncAdmittedUnresolvedNativePathsObserved:
        row.family === 'json' ? asyncNativeUnresolvedObserved : null,
      nativeRootSourceOwnership: 'UNKNOWN',
      allocationAcceptable: null,
      sdkQualified: false,
      unresolvedSamplesPresent: actualAnalysis.unresolvedSampleCount > 0,
      allocationInterpretation:
        actualAnalysis.unresolvedSampleCount > 0
          ? 'INCONCLUSIVE_UNKNOWN_SAMPLES_RETAINED'
          : 'DESCRIPTIVE_ONLY_NOT_ZERO_ALLOCATION_PROOF',
      reason:
        row.family === 'named'
          ? 'Named positive requires sampled paths through the exact source-bound allocator function span. Reused outputs do not exempt unrelated samples.'
          : 'Known redundant requests/parses are rejected as avoidable work; native/root samples are correlated admitted evidence, not proof of parser source ownership. All unresolved samples remain UNKNOWN.',
    }
    row.status =
      row.protocolComplete && (!row.repeated || positiveObserved)
        ? 'COMPLETE_DESCRIPTIVE_CONTROL'
        : 'FAILED_CLOSED'
  } catch (error) {
    row.status = 'FAILED_CLOSED'
    row.error = errorRecord(error)
  } finally {
    const failedPhase = phase
    phase = 'cleanup'
    // Release metadata only after actual stop (or after a failed warm with no
    // actual sampler). A still-active sampler is stopped before any release RPC.
    if (active && cdp) {
      try {
        const stopRequestEpochMs = Date.now()
        const result = await cdp.send('HeapProfiler.stopSampling')
        active = false
        emergencyCapture = {
          profile: result.profile,
          phase: failedPhase,
          stopRequestEpochMs,
          stopAcknowledgedEpochMs: Date.now(),
        }
        row.cleanup.push({ emergencySamplerStopped: true })
      } catch (error) {
        row.cleanup.push({ emergencyStopError: errorRecord(error) })
      }
    }
    if (!active && readSnapshot) {
      try {
        if (actualCapture && !actualSnapshot)
          actualSnapshot = await readSnapshot()
        else if (warmCapture && !warmSnapshot)
          warmSnapshot = await readSnapshot()
        else if (emergencyCapture) failedSnapshot = await readSnapshot()
      } catch (error) {
        row.cleanup.push({ failedOutputCaptureError: errorRecord(error) })
      }
    }
    if (fixtureInput) {
      try {
        if (warmCapture?.profile && !warmAnalysis)
          warmAnalysis = analyze(
            warmCapture.profile,
            [...sourceMap.values()],
            fixtureInput,
            row
          )
        if (actualCapture?.profile && !actualAnalysis)
          actualAnalysis = analyze(
            actualCapture.profile,
            [...sourceMap.values()],
            fixtureInput,
            row
          )
      } catch (error) {
        row.analysisError = errorRecord(error)
        row.status = 'FAILED_CLOSED'
      }
    }
    if (prepared && !active) {
      try {
        await prepared.release()
        row.cleanup.push({ metadataReleased: true })
      } catch (error) {
        row.cleanup.push({ metadataReleaseError: errorRecord(error) })
        row.status = 'FAILED_CLOSED'
      }
    }
    if (browserSession) {
      try {
        await browserSession.detach()
      } catch (error) {
        row.cleanup.push({ browserSessionDetachError: errorRecord(error) })
        row.status = 'FAILED_CLOSED'
      }
    }
    if (cdp) {
      try {
        await cdp.detach()
        row.cleanup.push({ sessionDetached: true })
      } catch (error) {
        row.cleanup.push({ sessionDetachError: errorRecord(error) })
        row.status = 'FAILED_CLOSED'
      }
    }
    if (context) {
      try {
        await context.close()
        row.cleanup.push({ contextClosed: true })
      } catch (error) {
        row.cleanup.push({ contextCloseError: errorRecord(error) })
        row.status = 'FAILED_CLOSED'
      }
    }
    if (browser) {
      try {
        await browser.close()
        row.cleanup.push({ browserClosed: true })
        activeBrowser = undefined
      } catch (error) {
        row.cleanup.push({ browserCloseError: errorRecord(error) })
        row.status = 'FAILED_CLOSED'
        fatalError ??= error
      }
    }
    row.warmSamples = totals(warmAnalysis)
    row.actualSamples = totals(actualAnalysis)
    row.browserFailures = failures
    row.http = httpRecords.filter((record) => record.caseId === row.id)
    row.identityLifecycle = lifecycle
    const artifacts = []
    row.persistenceErrors = []
    const persist = async (name, value, options) => {
      try {
        artifacts.push(await save(name, value, options))
      } catch (error) {
        row.persistenceErrors.push(errorRecord(error))
        row.status = 'FAILED_CLOSED'
        fatalError ??= error
      }
    }
    if (warmCapture?.profile)
      await persist(`${row.id}.warm.heapprofile.json.gz`, warmCapture.profile, {
        profile: true,
      })
    if (actualCapture?.profile)
      await persist(
        `${row.id}.actual.heapprofile.json.gz`,
        actualCapture.profile,
        { profile: true }
      )
    if (emergencyCapture?.profile)
      await persist(
        `${row.id}.emergency.heapprofile.json.gz`,
        emergencyCapture.profile,
        { profile: true }
      )
    await persist(`${row.id}.evidence.json.gz`, {
      owner,
      caseId: row.id,
      contextIdentity: row.contextIdentity,
      commands,
      failures,
      lifecycle,
      warm: {
        timing: warmCapture?.timing,
        parameters: warmCapture?.parameters,
        metadata: warmCapture?.metadata,
        snapshot: warmSnapshot,
        analysis: warmAnalysis,
      },
      actual: {
        timing: actualCapture?.timing,
        parameters: actualParameters,
        metadataCoverage: row.metadataCoverage,
        snapshot: actualSnapshot,
        analysis: actualAnalysis,
      },
      failed: emergencyCapture
        ? {
            phase: emergencyCapture.phase,
            stopRequestEpochMs: emergencyCapture.stopRequestEpochMs,
            stopAcknowledgedEpochMs: emergencyCapture.stopAcknowledgedEpochMs,
            snapshot: failedSnapshot,
          }
        : null,
      http: row.http,
      row,
    })
    await persist(`${row.id}.sources.json.gz`, {
      owner,
      caseId: row.id,
      sessionKey,
      parsedScripts: [...scripts.values()],
      contexts: [...contexts.values()],
      capturedSources: [...sourceMap.values()].map(
        ({ index, ...source }) => source
      ),
    })
    row.artifactNames = artifacts.map((artifact) => artifact.name)
  }
}

await save('owner.json', {
  owner,
  outputRoot,
  createdEpochMs: startedEpochMs,
  limits,
  parentRegistrationRequired: true,
})
const deadline = setTimeout(
  () => {
    fatalError ??= new Error(
      `Prepared allocation controls exceeded ${limits.deadlineMs}ms deadline`
    )
    cancellation.abort(fatalError)
    if (activeBrowser)
      void activeBrowser
        .close()
        .catch((error) =>
          report.cleanup.push({ deadlineBrowserCloseError: errorRecord(error) })
        )
    for (const request of requests) request.destroy()
    for (const response of responses) response.destroy()
    for (const socket of sockets) socket.destroy()
    server?.closeAllConnections()
  },
  Math.max(1, limits.deadlineMs - (Date.now() - startedEpochMs))
)
try {
  await save('payload.json.gz', {
    rows: payload,
    rowsSHA256: payloadSHA256,
    rowCount: payload.length,
    bodyBytes: Buffer.byteLength(payloadText),
  })
  server = createServer(handleHTTP)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    if (sockets.size > limits.sockets) {
      fatalError ??= new Error('HTTP socket budget exceeded')
      socket.destroy()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  server.on('error', (error) => {
    fatalError ??= error
  })
  const baseURL = `http://127.0.0.1:${server.address().port}/${owner}/`
  report.server = {
    baseURL,
    payloadSHA256,
    payloadRows: payload.length,
    responseJSONIsNative: true,
  }
  for (const row of report.cases) {
    if (fatalError || cancellation.signal.aborted) {
      row.status = 'NOT_RUN_FAILED_CLOSED'
      row.error = errorRecord(fatalError ?? cancellation.signal.reason)
      continue
    }
    await runCase(row, baseURL)
  }
  for (let repetition = 1; repetition <= limits.repetitions; repetition++) {
    for (const family of ['named', 'json']) {
      const repeated = report.cases.find(
        (row) =>
          row.repetition === repetition && row.family === family && row.repeated
      )
      const reused = report.cases.find(
        (row) =>
          row.repetition === repetition &&
          row.family === family &&
          !row.repeated
      )
      report.comparisons.push({
        repetition,
        family,
        repeatedCase: repeated.id,
        reusedCase: reused.id,
        complete:
          repeated.status === 'COMPLETE_DESCRIPTIVE_CONTROL' &&
          reused.status === 'COMPLETE_DESCRIPTIVE_CONTROL',
        requiredOutputsEqual: Boolean(
          repeated.actualOutput?.valid &&
          reused.actualOutput?.valid &&
          repeated.actualOutput.expectedOutputSHA256 ===
            reused.actualOutput.expectedOutputSHA256 &&
          repeated.actualOutput.outputCount === reused.actualOutput.outputCount
        ),
        expectedIdentities: [repeated.identities, reused.identities],
        observedIdentities: [
          repeated.actualOutput?.distinctIdentities ?? null,
          reused.actualOutput?.distinctIdentities ?? null,
        ],
        warmRequestCounts: [
          repeated.warmAdmission?.observedRequests ?? null,
          reused.warmAdmission?.observedRequests ?? null,
        ],
        actualRequestCounts: [
          repeated.actualAdmission?.observedRequests ?? null,
          reused.actualAdmission?.observedRequests ?? null,
        ],
        warmParseCounts: [
          repeated.warmAdmission?.observedParses ?? null,
          reused.warmAdmission?.observedParses ?? null,
        ],
        actualParseCounts: [
          repeated.actualAdmission?.observedParses ?? null,
          reused.actualAdmission?.observedParses ?? null,
        ],
        repeatedTreeBytes: repeated.actualSamples?.treeBytes ?? null,
        reusedTreeBytes: reused.actualSamples?.treeBytes ?? null,
        repeatedWeightedBytes: repeated.actualSamples?.weightedBytes ?? null,
        reusedWeightedBytes: reused.actualSamples?.weightedBytes ?? null,
        repeatedKnownNamedPathBytes:
          repeated.actualSamples?.knownNamedTreeBytes ?? null,
        reusedKnownNamedPathBytes:
          reused.actualSamples?.knownNamedTreeBytes ?? null,
        repeatedKnownJSONCallPathBytes:
          repeated.actualSamples?.knownJSONCallTreeBytes ?? null,
        reusedKnownJSONCallPathBytes:
          reused.actualSamples?.knownJSONCallTreeBytes ?? null,
        repeatedUnresolvedRootBytes:
          repeated.actualSamples?.unresolvedTreeBytes ?? null,
        reusedUnresolvedRootBytes:
          reused.actualSamples?.unresolvedTreeBytes ?? null,
        knownNamedPathContrastObserved:
          family === 'named'
            ? Boolean(
                repeated.actualSamples?.knownNamedTreeBytes > 0 &&
                reused.actualSamples?.knownNamedTreeBytes === 0
              )
            : null,
        admittedUnresolvedPathDirectionalContrast:
          family === 'json' && repeated.actualSamples && reused.actualSamples
            ? repeated.actualSamples.unresolvedTreeBytes >
              reused.actualSamples.unresolvedTreeBytes
            : null,
        nativeRootSourceOwnership: family === 'json' ? 'UNKNOWN' : null,
        scope:
          'Fixed paired content/identity/work-count contrast; no equal Poisson counts required and no unresolved roots excluded',
      })
    }
  }
} catch (error) {
  fatalError ??= error
} finally {
  if (activeBrowser) {
    try {
      await activeBrowser.close()
      activeBrowser = undefined
      report.cleanup.push({ finalBrowserClosed: true })
    } catch (error) {
      fatalError ??= error
      report.cleanup.push({ finalBrowserCloseError: errorRecord(error) })
    }
  }
  const socketClosures = [...sockets].map(
    (socket) => new Promise((resolve) => socket.once('close', resolve))
  )
  for (const request of requests) request.destroy()
  for (const response of responses) response.destroy()
  for (const socket of sockets) socket.destroy()
  await Promise.all(socketClosures)
  if (server) {
    try {
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
      report.cleanup.push({ serverClosed: true })
    } catch (error) {
      fatalError ??= error
      report.cleanup.push({ serverCloseError: errorRecord(error) })
    }
  }
  clearTimeout(deadline)
  report.finishedEpochMs = Date.now()
  report.durationMs = report.finishedEpochMs - startedEpochMs
  report.totalBrowsersAcquired = totalBrowsers
  report.registryAfterCleanup = {
    browser: Boolean(activeBrowser),
    serverListening: server?.listening ?? false,
    requests: requests.size,
    responses: responses.size,
    sockets: sockets.size,
  }
  const cleanupComplete =
    !activeBrowser &&
    !server?.listening &&
    requests.size === 0 &&
    responses.size === 0 &&
    sockets.size === 0
  report.cleanupComplete = cleanupComplete
  report.status =
    !fatalError &&
    cleanupComplete &&
    report.durationMs <= limits.deadlineMs &&
    totalBrowsers === limits.totalBrowsers &&
    report.cases.every(
      (row) => row.status === 'COMPLETE_DESCRIPTIVE_CONTROL'
    ) &&
    report.comparisons.length === 6 &&
    report.comparisons.every(
      (pair) => pair.complete && pair.requiredOutputsEqual
    )
      ? 'COMPLETE_DESCRIPTIVE_CONTROLS_ONLY'
      : 'FAILED_CLOSED'
  if (fatalError) report.error = errorRecord(fatalError)
  report.evidenceBudget = {
    filesBeforeSummary: filesWritten,
    bytesBeforeSummary: bytesWritten,
    summaryReservedBytes: limits.summaryBytes,
  }
  try {
    await save('summary.json', report, { summary: true })
  } catch (error) {
    report.status = 'FAILED_CLOSED'
    report.summaryPersistenceError = errorRecord(error)
    process.stderr.write(
      `${JSON.stringify({ outputRoot, status: report.status, summaryWriteError: report.summaryPersistenceError })}\n`
    )
    process.exitCode = 1
  }
  process.stdout.write(
    `${JSON.stringify({ outputRoot, status: report.status, cases: report.cases.length, browsers: totalBrowsers, cleanupComplete })}\n`
  )
  if (report.status !== 'COMPLETE_DESCRIPTIVE_CONTROLS_ONLY')
    process.exitCode = 1
}
