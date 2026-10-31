import { chromium } from '@playwright/test'
import { chromiumLaunchOptions } from '../browser/chromium.mjs'
import { captureAllocationWindow } from './allocation-capture.mjs'
import { createServer } from 'node:http'
import { mkdir, statfs, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

// Prospective detector controls, never SDK qualification or an explanation of
// historical unknown samples. Real-work arms issue no in-window CDP commands.
// The explicitly marked serialization arms intentionally contaminate capture.
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--output-dir' || !args[1])
  throw new Error(
    'Usage: node tests/svelte/allocation-controls.mjs --output-dir PATH'
  )
const outputRoot = resolve(args[1])
await mkdir(outputRoot, { recursive: true })
if (Number((await statfs(outputRoot)).type) === 0x01021994)
  throw new Error('Allocation evidence must reside on disk, not tmpfs')
const createdEpochMs = Date.now()
const owner = `F27causal-controls/${randomUUID()}`
const run = join(
  outputRoot,
  `allocation-controls-${createdEpochMs}-${owner.split('/')[1]}`
)
await mkdir(run)
const limits = {
  cases: 13,
  files: 16,
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  requests: 64,
  concurrentResponses: 4,
  sockets: 16,
  diagnostics: 32,
  deadlineMs: 120000,
  rootMaxAgeMs: 24 * 60 * 60 * 1000,
}
const parameters = {
  samplingInterval: 16384,
  includeObjectsCollectedByMinorGC: true,
  includeObjectsCollectedByMajorGC: true,
}
const definitions = [
  { name: 'named-js-allocating', durationMs: 2000, avoidable: true },
  { name: 'named-js-reused', durationMs: 2000 },
  { name: 'sync-native-api', durationMs: 2000, avoidable: true },
  {
    name: 'construct-retained-undefined',
    durationMs: 2000,
    contamination: true,
    avoidable: true,
  },
  {
    name: 'construct-returned-object',
    durationMs: 2000,
    contamination: true,
    avoidable: true,
  },
  {
    name: 'prepared-return-by-value',
    durationMs: 2000,
    contamination: true,
    avoidable: true,
  },
  { name: 'prepared-reference', durationMs: 2000, contamination: true },
  { name: 'prepared-primitive-string', durationMs: 2000, contamination: true },
  { name: 'async-redundant-four', durationMs: 2000, avoidable: true },
  { name: 'async-required-one-reused', durationMs: 2000 },
  { name: 'async-carry-in', durationMs: 2000, expectedIncomplete: true },
  { name: 'async-carry-out', durationMs: 1000, expectedIncomplete: true },
  {
    name: 'async-redundant-short-adversarial',
    durationMs: 1400,
    expectedIncomplete: true,
    avoidable: true,
  },
]
const contexts = new Set()
const sockets = new Set()
const responseTimers = new Set()
const activeResponses = new Set()
const cancellation = new AbortController()
let forcedCloseTimer
let browser
let server
let primaryError
let deadlineError
let filesWritten = 0
let bytesWritten = 0
let requestCount = 0
const records = Array.from({ length: 30000 }, (_, index) => ({
  index,
  value: `known-payload-${index}`,
}))
const jsonBody = JSON.stringify(records)
const expectedIndexSum = (30000 * 29999) / 2
const report = {
  schemaVersion: 1,
  purpose:
    'Prospective default-engine allocation detector sensitivity; not SDK attribution or universal-zero proof',
  status: 'RUNNING',
  run,
  owner,
  rootPolicy: {
    path: run,
    exclusiveNewRoot: true,
    maxBytes: limits.totalBytes,
    createdEpochMs,
    expiresEpochMs: createdEpochMs + limits.rootMaxAgeMs,
    oldEvidenceDeleted: false,
    enforcement:
      'Exclusive new run root; fail closed on age, byte or file budget, never delete previous evidence',
  },
  startedAt: new Date().toISOString(),
  limits,
  parameters,
  engine: {
    requested: 'default Chromium; no jitless and no VM-root whitelist',
    launchOptions: chromiumLaunchOptions,
  },
  historicalUnknowns:
    'The original six unknown leaves remain historical unknowns. No prospective control relabels them.',
  coverageRule:
    'Every initiated operation must start after start ACK plus clock margin and complete before stop REQUEST minus clock margin. Carry-in, pending-at-end, late and unresolved operations are INCOMPLETE, including redundant work.',
  allocationRule:
    'All raw nodes and samples, including VM roots and unknown ancestry, remain evidence. Known avoidable positives are rejected even when native samples have no JS initiating ancestry.',
  limitations: [
    'Poisson samples are not exact byte counts; no samples is not proof of zero allocation.',
    'Clock calibration bounds host/browser epoch uncertainty; operations overlapping that margin are not admitted.',
    'A control can demonstrate sensitivity without explaining unrelated SDK or historical engine samples.',
  ],
  cases: [],
  checks: [],
  diagnostics: [],
  cleanup: [],
}
function errorRecord(error) {
  return {
    name: error?.name,
    message: String(error?.message ?? error),
    stack: error?.stack,
    samplingPhase: error?.samplingPhase,
    cause: error?.cause ? String(error.cause) : undefined,
  }
}
function diagnostic(kind, value) {
  if (report.diagnostics.length >= limits.diagnostics) {
    primaryError ??= new Error('Control diagnostic budget exceeded')
    return
  }
  report.diagnostics.push({ epochMs: Date.now(), kind, ...value })
}
function check(name, passed, evidence) {
  report.checks.push({ name, passed: Boolean(passed), evidence })
  if (!passed) throw new Error(`Control assertion failed: ${name}`)
}
async function save(name, value) {
  const text = JSON.stringify(value, null, 2)
  const bytes = Buffer.byteLength(text)
  const isReport = name === 'report.json'
  const budget = isReport ? limits.totalBytes : limits.totalBytes - 1024 * 1024
  if (
    Date.now() - createdEpochMs > limits.rootMaxAgeMs ||
    bytes > (isReport ? 1024 * 1024 : limits.fileBytes) ||
    bytesWritten + bytes > budget ||
    filesWritten >= limits.files - (isReport ? 0 : 1)
  )
    throw new Error(`Control evidence age/byte/file budget exceeded: ${name}`)
  await writeFile(join(run, name), text, { flag: 'wx' })
  filesWritten++
  bytesWritten += bytes
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function registry() {
  return {
    contexts: contexts.size,
    sockets: sockets.size,
    responseTimers: responseTimers.size,
    activeResponses: activeResponses.size,
    requests: requestCount,
  }
}

// The server is an actual same-origin HTML page and bounded, delayed, streamed
// JSON. It does not depend on about:blank fetch, CORS, external assets or SDKs.
function handleRequest(request, response) {
  request.once('error', (error) => {
    primaryError ??= error
    diagnostic('http-request-error', errorRecord(error))
  })
  requestCount++
  if (requestCount > limits.requests) {
    const error = new Error('Control HTTP request budget exceeded')
    primaryError ??= error
    response.writeHead(503).end(error.message)
    return
  }
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(
      '<!doctype html><html><head><title>Allocation controls</title><link rel="icon" href="data:,"></head><body></body></html>'
    )
    return
  }
  if (url.pathname !== '/data') {
    response.writeHead(404).end('Unknown control resource')
    return
  }
  if (activeResponses.size >= limits.concurrentResponses) {
    primaryError ??= new Error('Control HTTP concurrency budget exceeded')
    response.writeHead(503).end('Response concurrency exceeded')
    return
  }
  activeResponses.add(response)
  const timers = new Set()
  const cancel = () => {
    for (const timer of timers) {
      clearTimeout(timer)
      responseTimers.delete(timer)
    }
    timers.clear()
    activeResponses.delete(response)
  }
  response.once('close', cancel)
  response.once('error', (error) => {
    primaryError ??= error
    diagnostic('http-response-error', errorRecord(error))
    cancel()
  })
  const later = (callback, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      responseTimers.delete(timer)
      callback()
    }, ms)
    timers.add(timer)
    responseTimers.add(timer)
  }
  const delayed =
    url.searchParams.get('late') === '1'
      ? 2100
      : url.searchParams.get('carry') === '1'
        ? 350
        : 100
  later(() => {
    if (response.destroyed) return
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonBody),
      'Cache-Control': 'no-store',
    })
    const split = Math.floor(jsonBody.length / 2)
    response.write(jsonBody.slice(0, split))
    later(() => {
      if (!response.destroyed) response.end(jsonBody.slice(split))
    }, 80)
  }, delayed)
}

async function calibrateClock(page) {
  const observations = []
  for (let index = 0; index < 3; index++) {
    const before = Date.now()
    const epoch = await page.evaluate(
      () => performance.timeOrigin + performance.now()
    )
    const after = Date.now()
    observations.push({
      before,
      browserEpochMs: epoch,
      after,
      roundTripMs: after - before,
      hostMinusBrowserMinMs: before - epoch,
      hostMinusBrowserMaxMs: after - epoch,
    })
  }
  const selected = observations.reduce((best, item) =>
    item.roundTripMs < best.roundTripMs ? item : best
  )
  return {
    observations,
    hostMinusBrowserMs:
      (selected.hostMinusBrowserMinMs + selected.hostMinusBrowserMaxMs) / 2,
    uncertaintyMs: selected.roundTripMs / 2 + 2,
    conservativeExtraMarginMs: 5,
  }
}

// All side-channel arrays, payload preparation and callback creation occur
// before sampling. Stable ticks mutate existing storage; no independent RAF.
async function prepare(page, name) {
  await page.evaluate((name) => {
    const s = (window.control = {
      name,
      timeOrigin: performance.timeOrigin,
      started: new Float64Array(32),
      ended: new Float64Array(32),
      jsonStarted: new Float64Array(32),
      outputs: new Array(32).fill(null),
      initiated: 0,
      completed: 0,
      errors: new Array(4).fill(null),
      errorCount: 0,
      prepared: Array.from({ length: 30000 }, (_, index) => ({
        index,
        value: `known-payload-${index}`,
      })),
      reused: new Array(8192).fill(7),
      identityPreserved: true,
      tick: 0,
    })
    s.primitive = JSON.stringify(s.prepared)
    function begin() {
      const id = s.initiated++
      s.started[id] = performance.now()
      return id
    }
    function finish(id, value) {
      s.outputs[id] = value
      s.ended[id] = performance.now()
      s.completed++
    }
    function fixtureAllocateNamedFrame() {
      const id = begin()
      const result = new Array(8192).fill(7)
      finish(id, result)
    }
    function fixtureReuseNamedFrame() {
      const id = begin()
      s.reused.fill(7)
      finish(id, s.reused)
    }
    function fixtureSyncNativeAPI() {
      const id = begin()
      const result = JSON.parse(s.primitive)
      finish(id, result)
    }
    function fixtureConstructAndTraverse(returnObject) {
      const id = begin()
      const result = new Array(30000)
      for (let index = 0; index < result.length; index++)
        result[index] = { index, value: `known-payload-${index}` }
      let sum = 0
      for (let index = 0; index < result.length; index++)
        sum += result[index].index
      if (sum !== 449985000)
        throw new Error('Construct/traverse content mismatch')
      finish(id, result)
      return returnObject ? result : undefined
    }
    function fixturePreparedResult(mode) {
      const id = begin()
      s.identityPreserved =
        (s.identityPreserved && s.prepared === s.outputs[0]) || id === 0
      finish(id, s.prepared)
      return mode === 'string' ? s.primitive : s.prepared
    }
    function fixtureAsyncResponseJSON(late) {
      const id = begin()
      fetch(
        late
          ? '/data?late=1'
          : s.name === 'async-carry-in'
            ? '/data?carry=1'
            : '/data'
      )
        .then((response) => {
          if (!response.ok) throw new Error(`Control HTTP ${response.status}`)
          s.jsonStarted[id] = performance.now()
          return response.json()
        })
        .then((value) => {
          finish(id, value)
          if (s.name === 'async-required-one-reused') {
            s.outputs[1] = value
            s.outputs[2] = value
            s.outputs[3] = value
          }
        })
        .catch((error) => {
          if (s.errorCount < s.errors.length)
            s.errors[s.errorCount++] = String(error?.stack ?? error)
        })
    }
    function finiteTick() {
      if (s.name === 'named-js-allocating') fixtureAllocateNamedFrame()
      else if (s.name === 'named-js-reused') fixtureReuseNamedFrame()
      else fixtureSyncNativeAPI()
      s.tick++
      if (s.tick < (s.name === 'sync-native-api' ? 8 : 32))
        setTimeout(finiteTick, 8)
    }
    function initiateAsyncBatch() {
      const count =
        s.name === 'async-redundant-four' ||
        s.name === 'async-redundant-short-adversarial'
          ? 4
          : 1
      for (let index = 0; index < count; index++)
        fixtureAsyncResponseJSON(
          s.name === 'async-carry-out' ||
            (s.name === 'async-redundant-short-adversarial' && index === 3)
        )
    }
    s.construct = fixtureConstructAndTraverse
    s.readPrepared = fixturePreparedResult
    if (s.name === 'async-carry-in') fixtureAsyncResponseJSON(false)
    else if (s.name.startsWith('async-')) setTimeout(initiateAsyncBatch, 350)
    else if (s.name.startsWith('named-js-') || s.name === 'sync-native-api')
      setTimeout(finiteTick, 350)
  }, name)
}

async function snapshot(page) {
  return page.evaluate(() => {
    const s = window.control
    let valid = true
    let valuesChecked = 0
    let indexSum = 0
    let identityPreserved = s.identityPreserved
    const outputs = s.name === 'async-required-one-reused' ? 4 : s.completed
    for (let slot = 0; slot < outputs; slot++) {
      const value = s.outputs[slot]
      if (!value) {
        valid = false
        continue
      }
      if (s.name.startsWith('named-js-')) {
        valid = valid && value.length === 8192
        for (let index = 0; index < value.length; index++) {
          valid = valid && value[index] === 7
          valuesChecked++
        }
      } else {
        valid = valid && value.length === 30000
        for (let index = 0; index < value.length; index++) {
          valid =
            valid &&
            value[index].index === index &&
            value[index].value === `known-payload-${index}`
          indexSum += value[index].index
          valuesChecked++
        }
      }
      if (
        s.name === 'named-js-reused' ||
        s.name === 'async-required-one-reused' ||
        s.name.startsWith('prepared-')
      )
        identityPreserved = identityPreserved && value === s.outputs[0]
    }
    let distinctOutputs = 0
    for (let slot = 0; slot < outputs; slot++) {
      if (!s.outputs[slot]) continue
      let first = true
      for (let earlier = 0; earlier < slot; earlier++)
        if (s.outputs[slot] === s.outputs[earlier]) first = false
      if (first) distinctOutputs++
    }
    return {
      timeOrigin: s.timeOrigin,
      initiated: s.initiated,
      completed: s.completed,
      events: Array.from({ length: s.initiated }, (_, id) => ({
        id,
        initiatedPerformanceMs: s.started[id],
        jsonStartedPerformanceMs: s.jsonStarted[id] || null,
        completedPerformanceMs: s.ended[id] || null,
      })),
      errors: s.errors.slice(0, s.errorCount),
      output: {
        valid,
        valuesChecked,
        indexSum,
        distinctOutputs,
        identityPreserved,
        outputSlots: outputs,
      },
    }
  })
}
function coverage(timing, clock, atStop, eventual) {
  const marginMs = clock.uncertaintyMs + clock.conservativeExtraMarginMs
  const strictStartEpochMs = timing.startAcknowledgedEpochMs + marginMs
  const strictEndEpochMs = timing.stopRequestEpochMs - marginMs
  const convert = (time) =>
    time === null ? null : eventual.timeOrigin + time + clock.hostMinusBrowserMs
  const operations = eventual.events.map((event) => {
    const initiatedEpochMs = convert(event.initiatedPerformanceMs)
    const jsonStartedEpochMs = convert(event.jsonStartedPerformanceMs)
    const completedEpochMs = convert(event.completedPerformanceMs)
    const carryIn = initiatedEpochMs < timing.startRequestEpochMs - marginMs
    const unresolved = completedEpochMs === null
    const lateCompletion =
      completedEpochMs !== null &&
      completedEpochMs > timing.stopAcknowledgedEpochMs + marginMs
    const initiationBoundaryUncertain =
      !carryIn && initiatedEpochMs <= strictStartEpochMs
    const completionOutsideConservativeWindow =
      completedEpochMs !== null && completedEpochMs >= strictEndEpochMs
    return {
      ...event,
      initiatedEpochMs,
      jsonStartedEpochMs,
      completedEpochMs,
      carryIn,
      unresolved,
      lateCompletion,
      initiationBoundaryUncertain,
      completionOutsideConservativeWindow,
      admitted:
        initiatedEpochMs > strictStartEpochMs &&
        initiatedEpochMs < strictEndEpochMs &&
        !unresolved &&
        completedEpochMs < strictEndEpochMs,
    }
  })
  const pendingAtEnd = operations.filter(
    (event) =>
      event.initiatedEpochMs < timing.stopRequestEpochMs &&
      (event.completedEpochMs === null ||
        event.completedEpochMs >= strictEndEpochMs)
  ).length
  return {
    status:
      operations.length > 0 && operations.every((event) => event.admitted)
        ? 'COMPLETE'
        : 'INCOMPLETE',
    strictStartEpochMs,
    strictEndEpochMs,
    marginMs,
    clock,
    operations,
    pendingAtEnd,
    completedAtPostStopSnapshot: atStop.completed,
    eventualCompleted: eventual.completed,
    pendingAtPostStopSnapshot: atStop.initiated - atStop.completed,
    carryInCount: operations.filter((event) => event.carryIn).length,
    lateCompletionCount: operations.filter((event) => event.lateCompletion)
      .length,
    unresolvedAtFinal: operations.filter((event) => event.unresolved).length,
  }
}
function summarize(profile) {
  let sampledBytes = 0
  let vmRootBytes = 0
  let jsInitiatingBytes = 0
  let namedJSFrameBytes = 0
  let syncNativeInitiatingFrameBytes = 0
  const initiatingFunctions = new Set()
  let nodeCount = 0
  function visit(node, hasVMRoot, hasJS, namedJS, syncNative) {
    nodeCount++
    const frame = node.callFrame
    const vm =
      hasVMRoot ||
      frame.functionName === '(V8 API)' ||
      frame.functionName === '(VM)' ||
      frame.functionName === '(GC)'
    const js = hasJS || Boolean(frame.url && frame.scriptId !== '0')
    const named = namedJS || frame.functionName === 'fixtureAllocateNamedFrame'
    const native = syncNative || frame.functionName === 'fixtureSyncNativeAPI'
    sampledBytes += node.selfSize
    if (vm) vmRootBytes += node.selfSize
    if (js) jsInitiatingBytes += node.selfSize
    if (named) namedJSFrameBytes += node.selfSize
    if (native) syncNativeInitiatingFrameBytes += node.selfSize
    if (node.selfSize && frame.functionName)
      initiatingFunctions.add(frame.functionName)
    for (const child of node.children) visit(child, vm, js, named, native)
  }
  visit(profile.head, false, false, false, false)
  return {
    sampledBytes,
    vmRootBytes,
    jsInitiatingBytes,
    namedJSFrameBytes,
    syncNativeInitiatingFrameBytes,
    unknownAncestryBytes: sampledBytes - jsInitiatingBytes,
    nodeCount,
    sampleCount: profile.samples.length,
    initiatingFunctions: [...initiatingFunctions],
  }
}
function validateRecords(value) {
  if (!Array.isArray(value) || value.length !== 30000)
    throw new Error('Serialized output is not the full expected array')
  for (let index = 0; index < value.length; index++)
    if (
      value[index].index !== index ||
      value[index].value !== `known-payload-${index}`
    )
      throw new Error(`Serialized output differs at record ${index}`)
}

async function runCase(definition, baseURL) {
  const row = { ...definition, status: 'RUNNING', inWindowCDP: [], cleanup: [] }
  report.cases.push(row)
  let context
  let contaminationTask
  let contaminationError
  try {
    check(
      `${definition.name}: prior context registry clean`,
      contexts.size === 0,
      registry()
    )
    row.registryBeforeAcquisition = registry()
    context = await browser.newContext()
    contexts.add(context)
    context.setDefaultTimeout(10000)
    const page = await context.newPage()
    const failures = []
    page.on('pageerror', (error) => {
      failures.push(errorRecord(error))
      if (failures.length > 8) void page.close()
    })
    page.on('requestfailed', (request) => {
      failures.push({
        message: request.failure()?.errorText,
        url: request.url(),
      })
      if (failures.length > 8) void page.close()
    })
    await page.goto(baseURL, { waitUntil: 'load', timeout: 10000 })
    const cdp = await context.newCDPSession(page)
    row.clock = await calibrateClock(page)
    await prepare(page, definition.name)
    if (definition.name === 'async-carry-in') await wait(40)
    const contamination = async () => {
      await wait(100)
      for (let index = 0; index < 4; index++) {
        let expression
        if (definition.name.startsWith('construct-'))
          expression = `control.construct(${definition.name === 'construct-returned-object'})`
        else
          expression = `control.readPrepared(${JSON.stringify(definition.name === 'prepared-primitive-string' ? 'string' : 'object')})`
        const command = {
          method: 'Runtime.evaluate',
          explicitlyControlOnly: true,
          expression,
          returnByValue: definition.name !== 'prepared-reference',
          requestEpochMs: Date.now(),
        }
        row.inWindowCDP.push(command)
        try {
          const response = await cdp.send('Runtime.evaluate', {
            expression,
            returnByValue: command.returnByValue,
            objectGroup: 'allocation-control',
          })
          command.acknowledgedEpochMs = Date.now()
          if (response.exceptionDetails)
            throw new Error(
              `Control evaluation failed: ${JSON.stringify(response.exceptionDetails)}`
            )
          const value = response.result
          command.result = {
            type: value.type,
            subtype: value.subtype,
            hasObjectId: Boolean(value.objectId),
            hasValue: Object.hasOwn(value, 'value'),
          }
          if (definition.name === 'construct-retained-undefined') {
            if (value.type !== 'undefined')
              throw new Error('Retained construction must return undefined')
          } else if (definition.name === 'prepared-reference') {
            if (
              value.type !== 'object' ||
              !value.objectId ||
              Object.hasOwn(value, 'value')
            )
              throw new Error(
                'Reference retrieval unexpectedly serialized content'
              )
          } else {
            const output =
              definition.name === 'prepared-primitive-string'
                ? JSON.parse(value.value)
                : value.value
            validateRecords(output)
            command.result.recordsChecked = output.length
            command.result.contentEqual = true
          }
        } catch (error) {
          command.error = errorRecord(error)
          throw error
        }
      }
    }
    // The adapter only launches the deliberately contaminating control task.
    // captureAllocationWindow itself still sends start/stop and uses a host timer.
    const captureCDP = definition.contamination
      ? {
          send: async (method, params) => {
            const result = await cdp.send(method, params)
            if (method === 'HeapProfiler.startSampling') {
              contaminationTask = contamination().catch((error) => {
                contaminationError = error
              })
            }
            return result
          },
        }
      : cdp
    let captured
    try {
      captured = await captureAllocationWindow(
        captureCDP,
        definition.durationMs,
        { ...parameters, signal: cancellation.signal }
      )
    } finally {
      if (contaminationTask) await contaminationTask
    }
    row.timing = captured.timing
    row.rawProfile = `${definition.name}.heapprofile.json`
    await save(row.rawProfile, captured.profile)
    row.samples = summarize(captured.profile)
    if (contaminationError) throw contaminationError
    row.atStop = await snapshot(page)
    const expectedOperations = definition.name.startsWith('named-js-')
      ? 32
      : definition.name === 'sync-native-api'
        ? 8
        : definition.contamination ||
            definition.name === 'async-redundant-four' ||
            definition.name === 'async-redundant-short-adversarial'
          ? 4
          : 1
    let completionWaitError
    try {
      await page.waitForFunction(
        (count) => control.completed >= count || control.errorCount > 0,
        expectedOperations,
        { timeout: 7000 }
      )
    } catch (error) {
      completionWaitError = error
      row.completionWaitError = errorRecord(error)
    }
    try {
      row.eventual = await snapshot(page)
    } catch (error) {
      throw completionWaitError ?? error
    }
    row.coverage = coverage(row.timing, row.clock, row.atStop, row.eventual)
    row.errors = failures
    if (completionWaitError) throw completionWaitError
    check(
      `${definition.name}: no browser/network errors`,
      !failures.length && !row.eventual.errors.length,
      { failures, asyncErrors: row.eventual.errors }
    )
    check(
      `${definition.name}: every required operation completed`,
      row.eventual.initiated === expectedOperations &&
        row.eventual.completed === expectedOperations,
      row.eventual
    )
    const output = row.eventual.output
    const outputSlots =
      definition.name === 'async-required-one-reused' ? 4 : expectedOperations
    const isJS = definition.name.startsWith('named-js-')
    check(
      `${definition.name}: full output content preserved`,
      output.valid &&
        output.valuesChecked === outputSlots * (isJS ? 8192 : 30000) &&
        (isJS || output.indexSum === outputSlots * expectedIndexSum),
      output
    )
    if (
      definition.name === 'named-js-reused' ||
      definition.name === 'async-required-one-reused' ||
      definition.name.startsWith('prepared-')
    )
      check(
        `${definition.name}: output identity reused`,
        output.identityPreserved && output.distinctOutputs === 1,
        output
      )
    if (
      definition.name === 'named-js-allocating' ||
      definition.name === 'sync-native-api' ||
      definition.name === 'async-redundant-four' ||
      definition.name.startsWith('construct-')
    )
      check(
        `${definition.name}: intentional fresh outputs established`,
        output.distinctOutputs === expectedOperations,
        output
      )
    if (definition.contamination) {
      const lower = row.coverage.strictStartEpochMs
      const upper = row.coverage.strictEndEpochMs
      check(
        `${definition.name}: contamination commands fully inside strict window`,
        row.inWindowCDP.length === 4 &&
          row.inWindowCDP.every(
            (command) =>
              command.requestEpochMs > lower &&
              command.acknowledgedEpochMs < upper
          ),
        row.inWindowCDP
      )
    }
    if (definition.expectedIncomplete) {
      check(
        `${definition.name}: incomplete coverage rejected`,
        row.coverage.status === 'INCOMPLETE',
        row.coverage
      )
      if (definition.name === 'async-carry-in') {
        check(
          'carry-in initiation before sampler with JSON completion strictly inside',
          row.coverage.carryInCount === 1 &&
            row.coverage.operations[0].initiatedEpochMs <
              row.timing.startRequestEpochMs - row.coverage.marginMs &&
            row.coverage.operations[0].jsonStartedEpochMs >
              row.coverage.strictStartEpochMs &&
            row.coverage.operations[0].completedEpochMs <
              row.coverage.strictEndEpochMs,
          row.coverage
        )
        check(
          'carry-in JSON allocation detected despite out-of-window initiation',
          row.samples.sampledBytes > 0,
          row.samples
        )
      } else {
        check(
          `${definition.name}: pending/late work identified`,
          row.coverage.pendingAtEnd > 0 &&
            row.coverage.pendingAtPostStopSnapshot > 0 &&
            row.coverage.lateCompletionCount > 0,
          row.coverage
        )
      }
      if (definition.name === 'async-redundant-short-adversarial')
        check(
          'short redundant arm preserves three-of-four adversarial evidence',
          row.atStop.completed === 3 && row.eventual.completed === 4,
          row.coverage
        )
      row.oracle = {
        verdict: 'INCOMPLETE',
        allocationAcceptable: false,
        reason:
          'Work crosses the actual sampling boundary; no no-allocation pass is possible',
      }
    } else {
      check(
        `${definition.name}: operations admitted inside strict window`,
        row.coverage.status === 'COMPLETE',
        row.coverage
      )
      if (definition.avoidable) {
        check(
          `${definition.name}: positive allocation detected without root exemptions`,
          row.samples.sampledBytes > 0,
          row.samples
        )
        row.oracle = {
          verdict: 'REJECT_AVOIDABLE_ALLOCATION',
          allocationAcceptable: false,
          reason:
            'Known intentionally avoidable control allocation; VM-root ancestry cannot excuse it',
          attributedToSDK: false,
        }
      } else
        row.oracle = {
          verdict:
            definition.name === 'async-required-one-reused'
              ? 'REQUIRED_WORK_REUSED'
              : 'STABLE_COMPARATOR',
          allocationAcceptable: null,
          reason:
            'Output-equivalent comparator, not proof of universal zero allocation',
          attributedToSDK: false,
        }
    }
    row.status = 'PASSED_CONTROL'
  } catch (error) {
    row.status = 'FAILED'
    row.error = errorRecord(error)
    throw error
  } finally {
    if (context) {
      try {
        await context.close()
        contexts.delete(context)
        row.cleanup.push({ contextClosed: true })
      } catch (error) {
        row.cleanup.push({ error: errorRecord(error) })
        primaryError ??= error
      }
    }
  }
}

const deadline = setTimeout(() => {
  deadlineError = new Error(
    `Allocation controls exceeded ${limits.deadlineMs}ms deadline`
  )
  primaryError ??= deadlineError
  cancellation.abort(deadlineError)
  forcedCloseTimer = setTimeout(() => {
    if (browser)
      void browser.close().catch((error) => {
        report.cleanup.push({ deadlineCloseError: errorRecord(error) })
      })
    if (server) server.closeAllConnections()
  }, 2000)
}, limits.deadlineMs)
try {
  report.registryBeforeAcquisition = {
    owner,
    rootPolicy: report.rootPolicy,
    ...registry(),
  }
  // Persist the empty-owned-registry baseline before acquiring browser/server.
  await save(
    'registry-before-acquisition.json',
    report.registryBeforeAcquisition
  )
  server = createServer(handleRequest)
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    if (sockets.size > limits.sockets) {
      primaryError ??= new Error('Control HTTP socket budget exceeded')
      socket.destroy()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  server.on('error', (error) => {
    primaryError ??= error
    diagnostic('http-server-error', errorRecord(error))
  })
  const baseURL = `http://127.0.0.1:${server.address().port}/`
  report.server = {
    baseURL,
    sameOrigin: true,
    payloadRecords: records.length,
    payloadBytes: Buffer.byteLength(jsonBody),
    streamedChunks: 2,
  }
  browser = await chromium.launch({
    ...chromiumLaunchOptions,
    headless: true,
    timeout: 30000,
  })
  report.engine.browserVersion = browser.version()
  const versionSession = await browser.newBrowserCDPSession()
  try {
    report.engine.protocolVersion =
      await versionSession.send('Browser.getVersion')
  } finally {
    await versionSession.detach()
  }
  for (const definition of definitions) {
    if (primaryError || deadlineError) throw primaryError ?? deadlineError
    await runCase(definition, baseURL)
  }
  const byName = (name) => report.cases.find((row) => row.name === name)
  const value = byName('prepared-return-by-value')
  const reference = byName('prepared-reference')
  const primitive = byName('prepared-primitive-string')
  report.serializationContrast = {
    returnByValue: value.samples,
    reference: reference.samples,
    primitive: primitive.samples,
    rule: 'Directional high-volume contrast, never equal/exact Poisson byte expectations; no root nodes removed',
  }
  check(
    'prepared-object serialization contamination contrast observed',
    value.samples.sampledBytes > reference.samples.sampledBytes &&
      value.samples.sampledBytes > primitive.samples.sampledBytes,
    report.serializationContrast
  )
  const redundant = byName('async-redundant-four')
  const reused = byName('async-required-one-reused')
  check(
    'redundant/native allocation cannot pass because it lands at VM roots',
    redundant.coverage.status === 'COMPLETE' &&
      redundant.oracle.verdict === 'REJECT_AVOIDABLE_ALLOCATION' &&
      redundant.samples.sampledBytes > 0,
    redundant.samples
  )
  check(
    'four redundant outputs equal one required reused result',
    redundant.eventual.output.valid &&
      reused.eventual.output.valid &&
      redundant.eventual.output.indexSum === reused.eventual.output.indexSum &&
      redundant.eventual.output.valuesChecked ===
        reused.eventual.output.valuesChecked &&
      redundant.eventual.output.distinctOutputs === 4 &&
      reused.eventual.output.distinctOutputs === 1,
    { redundant: redundant.eventual.output, reused: reused.eventual.output }
  )
  const allocating = byName('named-js-allocating')
  const stable = byName('named-js-reused')
  check(
    'named allocating and reused frames preserve equivalent full output',
    allocating.eventual.output.valid &&
      stable.eventual.output.valid &&
      allocating.eventual.output.valuesChecked ===
        stable.eventual.output.valuesChecked,
    { allocating: allocating.eventual.output, stable: stable.eventual.output }
  )
  const retained = byName('construct-retained-undefined')
  const returned = byName('construct-returned-object')
  report.constructionContrast = {
    retained: retained.samples,
    returned: returned.samples,
    outputEquivalent:
      retained.eventual.output.valid &&
      returned.eventual.output.valid &&
      retained.eventual.output.valuesChecked ===
        returned.eventual.output.valuesChecked &&
      retained.eventual.output.indexSum === returned.eventual.output.indexSum,
  }
  check(
    'retained undefined and returned construction preserve identical traversed content',
    report.constructionContrast.outputEquivalent,
    report.constructionContrast
  )
  check(
    'native API and JS positive controls are both detected',
    allocating.samples.sampledBytes > 0 &&
      byName('sync-native-api').samples.sampledBytes > 0,
    { js: allocating.samples, native: byName('sync-native-api').samples }
  )
  check(
    'named JS allocation has sampled initiating-frame evidence',
    allocating.samples.namedJSFrameBytes > 0,
    allocating.samples
  )
  check(
    'synchronous native JSON parsing has sampled initiating-frame evidence',
    byName('sync-native-api').samples.syncNativeInitiatingFrameBytes > 0,
    byName('sync-native-api').samples
  )
  report.status = 'PASSED_DETECTOR_CONTROLS'
} catch (error) {
  primaryError ??= error
  report.status = 'FAILED'
  report.error = errorRecord(primaryError)
  if (error !== primaryError) report.observedFailure = errorRecord(error)
} finally {
  clearTimeout(deadline)
  clearTimeout(forcedCloseTimer)
  for (const context of contexts) {
    try {
      await context.close()
      contexts.delete(context)
    } catch (error) {
      report.cleanup.push({ contextCloseError: errorRecord(error) })
      primaryError ??= error
    }
  }
  if (browser) {
    try {
      await browser.close()
      report.cleanup.push({ browserClosed: true })
    } catch (error) {
      report.cleanup.push({ browserCloseError: errorRecord(error) })
      primaryError ??= error
    }
  }
  for (const timer of responseTimers) clearTimeout(timer)
  responseTimers.clear()
  if (server) {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
        for (const socket of sockets) socket.destroy()
      })
      report.cleanup.push({ serverClosed: true })
    } catch (error) {
      report.cleanup.push({ serverCloseError: errorRecord(error) })
      primaryError ??= error
    }
  }
  // Let socket/response close events retire their own registry entries.
  await new Promise((resolve) => setImmediate(resolve))
  report.registryAfterCleanup = registry()
  if (
    contexts.size ||
    sockets.size ||
    activeResponses.size ||
    responseTimers.size
  )
    primaryError ??= new Error(
      'Control resource registries are not empty after cleanup'
    )
  if (primaryError) {
    report.status = 'FAILED'
    report.error ??= errorRecord(primaryError)
    process.exitCode = 1
  }
  report.finishedAt = new Date().toISOString()
  report.evidenceBudget = {
    filesBeforeReport: filesWritten,
    bytesBeforeReport: bytesWritten,
  }
  await save('report.json', report)
  console.log(
    JSON.stringify({
      status: report.status,
      report: join(run, 'report.json'),
      cases: report.cases.length,
    })
  )
}
