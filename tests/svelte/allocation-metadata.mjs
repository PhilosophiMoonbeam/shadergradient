import { captureAllocationWindow } from './allocation-capture.mjs'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

const SLOT = '__SG_PROFILER_METADATA_KEYS__'
const MAX_NAMES = 8192
const MAX_UTF8_BYTES = 1024 * 1024
const MAX_INPUT_NAMES = 65536
const MAX_PROFILE_NODES = 65536
const SYNTHETIC_LABELS = Object.freeze([
  '(root)',
  '(GC)',
  '(PARSER)',
  '(COMPILER)',
  '(BYTECODE_COMPILER)',
  '(V8 API)',
  '(EXTERNAL)',
  '(LOGGING)',
  '(IDLE_EXTERNAL)',
  '(IDLE)',
  '(JS)',
  '(deopt)',
])

function nameCollector() {
  const names = new Set()
  let bytes = 0
  return {
    add(name) {
      if (typeof name !== 'string') {
        throw new TypeError('Metadata names must be strings')
      }
      if (names.has(name)) return
      if (names.size === MAX_NAMES) {
        throw new RangeError(`Metadata exceeds ${MAX_NAMES} unique names`)
      }
      // UTF-16 length is a lower bound on UTF-8 bytes, including lone surrogates.
      if (name.length > MAX_UTF8_BYTES - bytes) {
        throw new RangeError('Metadata exceeds 1 MiB of unique UTF-8 strings')
      }
      const size = Buffer.byteLength(name, 'utf8')
      if (size > MAX_UTF8_BYTES - bytes) {
        throw new RangeError('Metadata exceeds 1 MiB of unique UTF-8 strings')
      }
      names.add(name)
      bytes += size
    },
    values() {
      return [...names]
    },
  }
}

/** Collect names only: no attribution, exclusions, or acceptance decision. */
export function profileMetadata(profile) {
  if (profile === null || typeof profile !== 'object' || !profile.head) {
    throw new TypeError('Expected a SamplingHeapProfile with a head node')
  }
  const names = nameCollector()
  for (const label of SYNTHETIC_LABELS) names.add(label)
  const resolvedScripts = new Map()
  const unresolvedScriptNodes = []
  const pending = [profile.head]
  const visited = new WeakSet()
  let nodes = 0
  while (pending.length !== 0) {
    const node = pending.pop()
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('Malformed sampling profile node')
    }
    if (visited.has(node)) {
      throw new TypeError(
        'Sampling profile is not a tree: repeated node reference'
      )
    }
    visited.add(node)
    if (++nodes > MAX_PROFILE_NODES) {
      throw new RangeError(
        `Sampling profile exceeds ${MAX_PROFILE_NODES} nodes`
      )
    }
    if (node.callFrame === null || typeof node.callFrame !== 'object') {
      throw new TypeError('Sampling profile node has no callFrame')
    }
    names.add(node.callFrame.functionName)
    names.add(node.callFrame.url)
    const frame = node.callFrame
    if (typeof frame.scriptId !== 'string')
      throw new TypeError('Missing sampled script identity')
    if (frame.scriptId !== '' && frame.scriptId !== '0') {
      if (
        Number.isSafeInteger(frame.lineNumber) &&
        frame.lineNumber >= 0 &&
        Number.isSafeInteger(frame.columnNumber) &&
        frame.columnNumber >= 0
      ) {
        const key = JSON.stringify([frame.scriptId, frame.url])
        if (!resolvedScripts.has(key))
          resolvedScripts.set(key, {
            scriptId: frame.scriptId,
            url: frame.url,
            nodeId: node.id,
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber,
          })
      } else unresolvedScriptNodes.push({ nodeId: node.id, frame })
    }
    if (!Array.isArray(node.children)) {
      throw new TypeError('Sampling profile node children must be an array')
    }
    if (node.children.length > MAX_PROFILE_NODES - nodes - pending.length) {
      throw new RangeError(
        `Sampling profile exceeds ${MAX_PROFILE_NODES} nodes`
      )
    }
    // Reverse push preserves source child order without recursive stack growth.
    for (let i = node.children.length - 1; i >= 0; --i) {
      pending.push(node.children[i])
    }
  }
  const collected = names.values()
  return {
    names: collected,
    // Conservative fail-closed exception: element-index keys do not prove interning.
    indexLikeNames: collected.filter((name) => /^(0|[1-9][0-9]*)$/.test(name)),
    resolvedScripts: [...resolvedScripts.values()],
    unresolvedScriptNodes,
  }
}

async function evaluateInteger(cdp, expression, operation) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  })
  if (response === null || typeof response !== 'object') {
    throw new TypeError(`${operation}: malformed Runtime.evaluate response`)
  }
  if (Object.hasOwn(response, 'exceptionDetails')) {
    const details = response.exceptionDetails
    const message = details?.exception?.description ?? details?.text
    throw new Error(
      `${operation}: Runtime.evaluate exception${
        typeof message === 'string' ? `: ${message.slice(0, 2048)}` : ''
      }`
    )
  }
  const result = response.result
  if (
    result === null ||
    typeof result !== 'object' ||
    result.type !== 'number' ||
    !Number.isSafeInteger(result.value) ||
    Object.hasOwn(result, 'objectId') ||
    Object.hasOwn(result, 'unserializableValue')
  ) {
    throw new TypeError(`${operation}: expected a primitive integer result`)
  }
  return result.value
}

/**
 * Call and release outside sampling. This is an experimental priming operation,
 * not an SDK source registry or a root-sample exemption.
 *
 * Pinned V8 15.3.76.4 primary basis:
 * https://github.com/v8/v8/blob/15.3.76.4/src/objects/lookup-inl.h
 * PropertyKey's non-integer-name path and LookupIterator's named-property path
 * call InternalizeName. Dynamic own keys on a null-prototype object exercise
 * named-property creation; dictionary key matching requires unique Names:
 * https://github.com/v8/v8/blob/15.3.76.4/src/objects/dictionary-inl.h
 * BaseNameDictionaryShape::{IsMatch,Hash,AsHandle} assert IsUniqueName, and
 * Dictionary::SetEntry stores the key with a write barrier. Holding the object
 * therefore retains its named keys. Values also retain the supplied strings.
 * Integer-index strings may use element storage instead: this mechanism does
 * NOT prove that every possible string, or every later export, is allocation
 * free. Any causal effect and relevance to historical roots remain unproven.
 */
export async function retainMetadataKeys(cdp, names) {
  if (!cdp || typeof cdp.send !== 'function') {
    throw new TypeError('Expected a CDP session with send(method, parameters)')
  }
  if (!Array.isArray(names)) {
    throw new TypeError('Metadata names must be an array')
  }
  if (names.length > MAX_INPUT_NAMES) {
    throw new RangeError(`Metadata input exceeds ${MAX_INPUT_NAMES} entries`)
  }
  const collector = nameCollector()
  for (const name of names) collector.add(name)
  const uniqueNames = collector.values()
  const slot = JSON.stringify(SLOT)
  const owner = JSON.stringify(randomUUID())

  // The release closure captures the exact retained object. Even copying its
  // symbol and release function onto a replacement cannot delete it.
  // All descriptors are inspected without invoking a page-slot getter.
  const releaseExpression = `(() => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, ${slot});
    if (!descriptor) return 0;
    if (!Object.hasOwn(descriptor, 'value')) return 2;
    const held = descriptor.value;
    if (held === null || typeof held !== 'object') return 2;
    const marker = Object.getOwnPropertySymbols(held).find(
      (key) => key.description === ${owner}
    );
    if (!marker) return 2;
    const cleanup = Object.getOwnPropertyDescriptor(held, marker);
    if (!cleanup || typeof cleanup.value !== 'function') return 2;
    return Reflect.apply(cleanup.value, undefined, []);
  })()`
  const installExpression = `(() => {
    if (${slot} in globalThis) throw new Error('Metadata key slot already exists');
    const held = Object.create(null);
    const names = ${JSON.stringify(uniqueNames)};
    for (const name of names) {
      Object.defineProperty(held, name, { value: name, enumerable: true });
    }
    // Ownership uses a symbol, leaving the exact own string-key set equal to
    // the supplied metadata (even when names include 'owner' or 'release').
    Object.defineProperty(held, Symbol(${owner}), { value: () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, ${slot});
      if (!descriptor) return 0;
      if (!Object.hasOwn(descriptor, 'value') || descriptor.value !== held) return 2;
      if (!Reflect.deleteProperty(globalThis, ${slot})) {
        throw new Error('Unable to delete owned metadata key slot');
      }
      return 1;
    } });
    Object.defineProperty(globalThis, ${slot}, {
      value: held, configurable: true,
    });
    return names.length;
  })()`

  async function cleanup() {
    const status = await evaluateInteger(
      cdp,
      releaseExpression,
      'Release metadata keys'
    )
    if (status !== 0 && status !== 1 && status !== 2) {
      throw new TypeError('Release metadata keys: invalid cleanup status')
    }
    return status
  }

  try {
    const count = await evaluateInteger(
      cdp,
      installExpression,
      'Retain metadata keys'
    )
    if (count !== uniqueNames.length) {
      throw new Error(
        'Retain metadata keys: primitive count does not match input'
      )
    }
  } catch (error) {
    // Installation may have succeeded before a malformed/lost CDP response.
    // Status 2 is a no-op here: collision failure must not touch foreign slots.
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Metadata acquisition and cleanup failed'
      )
    }
    throw error
  }

  let released = false
  let pendingRelease
  return {
    count: uniqueNames.length,
    async release() {
      if (released) return
      if (!pendingRelease) {
        pendingRelease = cleanup()
          .then((status) => {
            if (status === 0) {
              throw new Error(
                'Metadata retention evidence lost before first confirmed release'
              )
            }
            if (status === 2) {
              throw new Error(
                'Metadata key slot ownership changed; foreign slot left untouched'
              )
            }
            released = true
          })
          .finally(() => {
            pendingRelease = undefined
          })
      }
      await pendingRelease
    },
  }
}
/**
 * One fixed diagnostic warm export, then exact metadata-key retention. This does
 * not suppress samples, eliminate forced GC or classify remaining VM roots.
 * The caller binds resolved scripts to its unchanged session/context/source map,
 * preserves profile/timing separately and releases only after actual stop.
 */
export async function prepareAllocationMetadata(
  cdp,
  { durationMs = 1000 } = {}
) {
  const parameters = {
    samplingInterval: 1,
    includeObjectsCollectedByMinorGC: true,
    includeObjectsCollectedByMajorGC: true,
  }
  const { profile, timing } = await captureAllocationWindow(
    cdp,
    durationMs,
    parameters
  )
  let metadata
  let lease
  try {
    metadata = profileMetadata(profile)
    if (metadata.indexLikeNames.length) {
      throw new Error(
        'Metadata preparation cannot prove integer-index string interning'
      )
    }
    // Best-effort coverage supplies additional exact metadata strings, not a
    // complete function inventory or evidence of position/line-end warming.
    // One query only; enabling/disabling Profiler would have broader effects.
    const snapshot = {
      method: 'Profiler.getBestEffortCoverage',
      requestEpochMs: Date.now(),
      acknowledgedEpochMs: null,
      scope:
        'Best-effort additional names only; may omit functions after GC and differs for some debug names/URLs. No coverage-mode toggle, allocation waiver or position proof.',
    }
    metadata.bestEffortSnapshot = snapshot
    const response = await cdp.send('Profiler.getBestEffortCoverage')
    snapshot.acknowledgedEpochMs = Date.now()
    const serialized = JSON.stringify(response)
    snapshot.rawResponseBytes = Buffer.byteLength(serialized)
    snapshot.rawResponseSHA256 = createHash('sha256')
      .update(serialized)
      .digest('hex')
    if (snapshot.rawResponseBytes > 8 * 1024 * 1024)
      throw new RangeError('Best-effort metadata response exceeds 8 MiB')
    snapshot.raw = response
    if (!Array.isArray(response?.result) || response.result.length > 65536)
      throw new TypeError('Invalid or oversized best-effort script snapshot')
    const collected = nameCollector()
    for (const name of metadata.names) collected.add(name)
    const unprovenIndexNames = new Set()
    const add = (name) => {
      if (typeof name !== 'string')
        throw new TypeError('Best-effort metadata name must be a string')
      if (/^(0|[1-9][0-9]*)$/.test(name)) unprovenIndexNames.add(name)
      else collected.add(name)
    }
    let functions = 0
    for (const script of response.result) {
      if (
        typeof script.scriptId !== 'string' ||
        typeof script.url !== 'string' ||
        !Array.isArray(script.functions)
      )
        throw new TypeError('Malformed best-effort script metadata')
      add(script.url)
      for (const fn of script.functions) {
        if (++functions > 65536)
          throw new RangeError('Best-effort metadata exceeds 65536 functions')
        add(fn.functionName)
      }
    }
    snapshot.scriptCount = response.result.length
    snapshot.functionCount = functions
    snapshot.excludedIndexLikeNames = [...unprovenIndexNames]
    snapshot.positionCoverageSource =
      'successful warm allocation-tree positions only'
    metadata.names = collected.values()
    lease = await retainMetadataKeys(cdp, metadata.names)
  } catch (error) {
    error.metadataPreparation = {
      profile,
      timing,
      parameters,
      metadata: metadata ?? null,
    }
    throw error
  }
  const names = new Set(metadata.names)
  const scripts = new Set(
    metadata.resolvedScripts.map((frame) =>
      JSON.stringify([frame.scriptId, frame.url])
    )
  )
  return {
    profile,
    timing,
    parameters,
    metadata,
    validate(actualProfile) {
      const actual = profileMetadata(actualProfile)
      const missingNames = actual.names.filter((name) => !names.has(name))
      const missingScripts = actual.resolvedScripts.filter(
        (frame) => !scripts.has(JSON.stringify([frame.scriptId, frame.url]))
      )
      return {
        complete:
          missingNames.length === 0 &&
          missingScripts.length === 0 &&
          actual.unresolvedScriptNodes.length === 0 &&
          actual.indexLikeNames.length === 0,
        missingNames,
        missingScripts,
        unresolvedActualScriptNodes: actual.unresolvedScriptNodes,
        indexLikeNames: actual.indexLikeNames,
        scope:
          'Export metadata read-set coverage only; not source ownership or allocation acceptance.',
      }
    },
    release: () => lease.release(),
  }
}
