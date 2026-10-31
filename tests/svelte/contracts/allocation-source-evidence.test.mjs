import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  assessAllocationSourceEvidence,
  assessAllocationSourceAdmission,
} from '../allocation-source-evidence.mjs'

const sessionKey = 'owned-renderer-session'
const debuggerId = 'owned-debugger'
const digest = (source) => createHash('sha256').update(source).digest('hex')
const rootFrame = () => ({
  functionName: '(root)',
  scriptId: '0',
  url: '',
  lineNumber: -1,
  columnNumber: -1,
})
const builtin = (name = 'Uint8Array') => ({
  functionName: name,
  scriptId: '0',
  url: '',
  lineNumber: -1,
  columnNumber: -1,
})
function capturedScript(id, source, options = {}) {
  const url = options.url ?? `http://fixture.test/script-${id}.js`
  const context = {
    key: 'owned-context-key',
    uniqueId: 'owned-context-unique',
    epoch: 0,
    retired: null,
    metadataUnavailable: false,
  }
  const sha256 = digest(source)
  const metadata = {
    key: `metadata-${id}`,
    sessionKey,
    scriptId: id,
    url,
    executionContextId: 7,
    context,
    protocolHash: `cdp-protocol-hash-${id}-not-the-utf8-sha256`,
    sha256,
    sourceCapturedAt: '2026-10-31T00:00:00.000Z',
    sourceEvidence: 'captured-sources.json',
    startLine: options.startLine ?? 0,
    startColumn: options.startColumn ?? 0,
  }
  const script = { scriptId: id, url, metadata, scriptSource: source, sha256 }
  const sourceIdentity = {
    sessionKey,
    debuggerId,
    scriptId: id,
    url,
    executionContextId: metadata.executionContextId,
    executionContextUniqueId: context.uniqueId,
    contextKey: context.key,
    contextEpoch: context.epoch,
    protocolHash: metadata.protocolHash,
    sha256,
    capturedAt: metadata.sourceCapturedAt,
    sourceEvidence: metadata.sourceEvidence,
  }
  const frame = {
    functionName: options.functionName ?? `recordedFunction${id}`,
    scriptId: id,
    url,
    lineNumber: metadata.startLine,
    columnNumber: metadata.startColumn,
    sourceIdentity: { ...sourceIdentity },
  }
  return { script, currentScript: script, sourceIdentity, frame }
}
function fixture(frames, captures, { selfSize = 16384 } = {}) {
  const root = rootFrame()
  const stack = [root, ...frames]
  const nodes = stack.map((frame, index) => {
    const position = frame.generated ?? frame
    return {
      id: index + 1,
      callFrame: {
        functionName: frame.functionName,
        scriptId: frame.scriptId,
        url: position.url,
        lineNumber: position.lineNumber,
        columnNumber: position.columnNumber,
      },
      selfSize: index === stack.length - 1 ? selfSize : 0,
      children: [],
    }
  })
  for (let index = 0; index < nodes.length - 1; index++)
    nodes[index].children.push(nodes[index + 1])
  const sample = { nodeId: nodes.at(-1).id, size: 16384, ordinal: 1 }
  const site = {
    nodeId: sample.nodeId,
    treeSelfSize: selfSize,
    bytes: selfSize,
    frame: stack.at(-1),
    stack,
    sampleVector: {
      weightedBytes: sample.size,
      entries: [{ rawSampleIndex: 0, sample }],
    },
  }
  return {
    profile: { head: nodes[0], samples: [sample] },
    sites: [site],
    sources: new Map(
      captures.map((capture) => [capture.script.scriptId, capture])
    ),
    sessionKey,
    debuggerId,
    closed: false,
    fatalError: null,
  }
}
const assess = (input) => assessAllocationSourceEvidence(input)
const onlySite = (result) => {
  assert.equal(result.sites.length, 1)
  return result.sites[0]
}
function pending(result) {
  assert.equal(result.qualificationStatus, 'pending-allocation-review')
  for (const site of result.sites)
    assert.equal(site.qualificationStatus, 'pending-allocation-review')
}

test('Script 0 builtin with exact nearest recorded JS source is ready, not qualified', () => {
  const caller = capturedScript(
    '11',
    'function render() { return new Uint8Array(8) }'
  )
  const result = assess(fixture([caller.frame, builtin()], [caller]))
  assert.equal(result.complete, true)
  const site = onlySite(result)
  assert.equal(site.evidenceKind, 'nearest-caller')
  assert.equal(site.nearestRecordedJSCaller.frame.scriptId, '11')
  assert.equal(
    site.nearestRecordedJSCaller.sha256,
    digest(caller.script.scriptSource)
  )
  assert.equal(site.nearestRecordedJSCaller.rawPosition.columnNumber, 0)
  assert.equal(site.nearestRecordedJSCaller.offsetUTF16, 0)
  assert.equal(site.nearestRecordedJSCaller.sourceCharacter, 'f')
  assert.notEqual(
    site.nearestRecordedJSCaller.protocolHash,
    site.nearestRecordedJSCaller.sha256
  )
  pending(result)
})

test('a fresh-object factory caller is still only evidence readiness', () => {
  const caller = capturedScript(
    '12',
    'function factory() { return { fresh: new Uint8Array(8) } }'
  )
  const result = assess(fixture([caller.frame, builtin()], [caller]))
  assert.equal(result.complete, true)
  assert.equal(onlySite(result).readyForAdjudication, true)
  pending(result)
})

test('ambiguous builtin causality remains pending without calling the recorded frame allocating', () => {
  const outer = capturedScript(
    '13',
    'function outer(callback) { return callback() }'
  )
  const nearest = capturedScript(
    '14',
    'function callback() { return indirectOperation() }'
  )
  const result = assess(
    fixture([outer.frame, nearest.frame, builtin('Array')], [outer, nearest])
  )
  assert.equal(result.complete, true)
  const site = onlySite(result)
  assert.equal(site.nearestRecordedJSCaller.frame.scriptId, '14')
  assert.equal(site.requiredNonzeroAncestry.length, 2)
  pending(result)
})

test('invalid nearest recorded JS position cannot be replaced by a valid farther ancestor', () => {
  const farther = capturedScript('15', 'function farther() { return nearer() }')
  const nearest = capturedScript(
    '16',
    'function nearer() { return operation() }'
  )
  nearest.frame.columnNumber = 1000
  const result = assess(
    fixture([farther.frame, nearest.frame, builtin()], [farther, nearest])
  )
  assert.equal(result.complete, false)
  const site = onlySite(result)
  assert.equal(site.evidenceKind, 'invalid-nearest')
  assert.equal(site.nearestRecordedJSCaller.frame.scriptId, '16')
  assert.equal(site.requiredNonzeroAncestry[0].ready, true)
  assert.equal(
    site.reasons.includes('invalid-nearest-recorded-js-caller'),
    true
  )
  pending(result)
})

test('a nonzero leaf must own its source and cannot fall back to a good caller', () => {
  const caller = capturedScript('17', 'function caller() { return leaf() }')
  const leaf = capturedScript('18', 'function leaf() { return {} }')
  const result = assess(fixture([caller.frame, leaf.frame], [caller]))
  assert.equal(result.complete, false)
  const site = onlySite(result)
  assert.equal(site.evidenceKind, 'leaf-source')
  assert.equal(site.leafSource.ready, false)
  assert.equal(site.nearestRecordedJSCaller, null)
  assert.equal(site.reasons.includes('leaf-source-unavailable'), true)
})

test('a sampled root with no recorded JS caller fails', () => {
  const result = assess(fixture([], []))
  assert.equal(result.complete, false)
  const site = onlySite(result)
  assert.equal(site.evidenceKind, 'no-caller')
  assert.equal(site.nearestRecordedJSCaller, null)
  assert.equal(site.reasons.includes('no-recorded-js-caller'), true)
})

test('a valid nearest caller does not hide a missing required SDK ancestor', () => {
  const sdk = capturedScript('19', 'function sdk() { return renderer() }', {
    url: 'http://fixture.test/packages/shadergradient-svelte/src/runtime.js',
  })
  const nearest = capturedScript(
    '20',
    'function renderer() { return new Uint8Array(8) }'
  )
  const result = assess(
    fixture([sdk.frame, nearest.frame, builtin()], [nearest])
  )
  assert.equal(result.complete, false)
  const site = onlySite(result)
  assert.equal(site.nearestRecordedJSCaller.ready, true)
  assert.equal(site.requiredNonzeroAncestry[0].ready, false)
  assert.equal(site.reasons.includes('missing-ancestry-source'), true)
})

test('sampled zero-self sites are evaluated and cannot be dropped', () => {
  const caller = capturedScript(
    '21',
    'function render() { return new Uint8Array(8) }'
  )
  const input = fixture([caller.frame, builtin()], [caller], { selfSize: 0 })
  const result = assess(input)
  assert.equal(result.complete, true)
  assert.equal(onlySite(result).treeSelfSize, 0)
  assert.deepEqual(onlySite(result).rawSampleIndices, [0])
  const dropped = assess({ ...input, sites: [] })
  assert.equal(dropped.complete, false)
  assert.deepEqual(dropped.rawCoverage.missingSiteNodeIds, [3])
  assert.deepEqual(dropped.rawCoverage.missingSampleIndices, [0])
})

test('orphan raw sample-vector nodes fail even when the other source is exact', () => {
  const leaf = capturedScript('22', 'function leaf() { return {} }')
  const input = fixture([leaf.frame], [leaf])
  const orphan = { nodeId: 999, size: 32768, ordinal: 2 }
  input.profile.samples.push(orphan)
  input.sites.push({
    nodeId: 999,
    treeSelfSize: null,
    frame: null,
    stack: [],
    sampleVector: {
      weightedBytes: orphan.size,
      entries: [{ rawSampleIndex: 1, sample: orphan }],
    },
  })
  const result = assess(input)
  assert.equal(result.complete, false)
  assert.deepEqual(result.rawCoverage.orphanSampleVectorNodeIds, [999])
  assert.equal(
    result.sites.every((site) => site.reasons.includes('raw-coverage')),
    true
  )
})

test('duplicate raw tree node IDs fail independently of valid source identities', () => {
  const leaf = capturedScript('23', 'function leaf() { return {} }')
  const input = fixture([leaf.frame], [leaf])
  const duplicate = { ...input.profile.head.children[0], children: [] }
  input.profile.head.children.push(duplicate)
  const result = assess(input)
  assert.equal(result.complete, false)
  assert.deepEqual(result.rawCoverage.duplicateTreeNodeIds, [2])
})

test('omitting a raw nonzero ancestor from a saved site fails raw coverage', () => {
  const sdk = capturedScript('24', 'function sdk() { return renderer() }')
  const nearest = capturedScript(
    '25',
    'function renderer() { return operation() }'
  )
  const input = fixture([sdk.frame, nearest.frame, builtin()], [nearest])
  input.sites[0].stack.splice(1, 1)
  const result = assess(input)
  assert.equal(result.complete, false)
  assert.deepEqual(result.rawCoverage.mismatchedSiteNodeIds, [4])
})

test('exact nonzero leaf source is ready without an invented caller', () => {
  const leaf = capturedScript('26', 'function leaf() { return {} }')
  const result = assess(fixture([leaf.frame], [leaf]))
  assert.equal(result.complete, true)
  const site = onlySite(result)
  assert.equal(site.leafSource.ready, true)
  assert.equal(site.nearestRecordedJSCaller, null)
  pending(result)
})

test('mapped frames use generated raw script coordinates, not mapped display positions', () => {
  const leaf = capturedScript('27', 'function leaf() { return {} }')
  const generated = { url: leaf.frame.url, lineNumber: 0, columnNumber: 9 }
  leaf.frame = {
    ...leaf.frame,
    generated,
    url: 'original.ts',
    lineNumber: 999,
    columnNumber: 999,
  }
  const result = assess(fixture([leaf.frame], [leaf]))
  assert.equal(result.complete, true)
  assert.equal(onlySite(result).leafSource.sourceCharacter, 'l')
  const invalid = {
    ...leaf.frame,
    generated: { ...generated, columnNumber: 1000 },
    lineNumber: 0,
    columnNumber: 0,
  }
  const rejected = assess(fixture([invalid], [leaf]))
  assert.equal(rejected.complete, false)
  assert.equal(onlySite(rejected).leafSource.offsetUTF16, null)
})

test('strict positions respect UTF-16, nonzero origins and every ECMAScript line ending', () => {
  const body = 'ab😀\r\ncd\ref\u2028gh\u2029ij\n'
  for (const [lineNumber, columnNumber, character] of [
    [10, 9, '\ud83d'],
    [11, 1, 'd'],
    [12, 1, 'f'],
    [13, 1, 'h'],
    [14, 1, 'j'],
  ]) {
    const leaf = capturedScript('28', body, { startLine: 10, startColumn: 7 })
    Object.assign(leaf.frame, { lineNumber, columnNumber })
    const result = assess(fixture([leaf.frame], [leaf]))
    assert.equal(result.complete, true)
    assert.equal(onlySite(result).leafSource.sourceCharacter, character)
  }
  for (const [lineNumber, columnNumber] of [
    [10, 11],
    [10, 12],
    [11, 2],
    [12, 2],
    [13, 2],
    [14, 2],
    [15, 0],
    [9, 7],
    [10, 6],
  ]) {
    const leaf = capturedScript('29', body, { startLine: 10, startColumn: 7 })
    Object.assign(leaf.frame, { lineNumber, columnNumber })
    const result = assess(fixture([leaf.frame], [leaf]))
    assert.equal(result.complete, false)
    assert.equal(onlySite(result).leafSource.offsetUTF16, null)
  }
})

test('source body, frame identity, protocol hash and live session/context cannot drift', () => {
  for (const mutate of [
    (capture) => {
      capture.script.scriptSource += ' altered'
    },
    (capture) => {
      capture.frame.sourceIdentity.sha256 = 'wrong'
    },
    (capture) => {
      capture.script.metadata.protocolHash = 'changed-protocol-hash'
    },
    (capture) => {
      capture.currentScript = { ...capture.script }
    },
    (capture) => {
      capture.script.metadata.context.retired = { reason: 'destroyed' }
    },
    (capture) => {
      capture.script.metadata.sessionKey = 'other-session'
    },
    (capture) => {
      capture.script.metadata.context.key = 'other-context'
    },
    (capture) => {
      delete capture.script.metadata.startLine
    },
  ]) {
    const leaf = capturedScript('30', 'function leaf() { return {} }')
    mutate(leaf)
    const result = assess(fixture([leaf.frame], [leaf]))
    assert.equal(result.complete, false)
    assert.equal(onlySite(result).leafSource.ready, false)
  }
})

test('a frame missing its own identity cannot borrow the captured descriptor identity', () => {
  const leaf = capturedScript('31', 'function leaf() { return {} }')
  delete leaf.frame.sourceIdentity
  const result = assess(fixture([leaf.frame], [leaf]))
  assert.equal(result.complete, false)
  assert.equal(
    onlySite(result).reasons.includes('leaf-source-unavailable'),
    true
  )
})

test('duplicate and altered raw sample vectors cannot claim complete source evidence', () => {
  for (const kind of ['duplicate', 'altered']) {
    const leaf = capturedScript('32', 'function leaf() { return {} }')
    const input = fixture([leaf.frame], [leaf])
    if (kind === 'duplicate') {
      input.sites[0].sampleVector.entries.push(
        input.sites[0].sampleVector.entries[0]
      )
      input.sites[0].sampleVector.weightedBytes *= 2
    } else {
      input.sites[0].sampleVector.entries[0].sample = {
        ...input.profile.samples[0],
        size: 1,
      }
    }
    const result = assess(input)
    assert.equal(result.complete, false)
    assert.equal(onlySite(result).reasons.includes('raw-coverage'), true)
  }
})

test('a caller-less sample blocks native qualification but remains unknown descriptive comparator cost', () => {
  const evidence = assess(fixture([builtin('')], []))
  assert.equal(evidence.complete, false)
  const native = assessAllocationSourceAdmission(evidence, 'native')
  const comparator = assessAllocationSourceAdmission(evidence, 'vue')
  assert.equal(native.admitted, false)
  assert.equal(comparator.admitted, true)
  assert.equal(comparator.sourceReadinessComplete, false)
  assert.deepEqual(comparator.unattributedNodeIds, [evidence.sites[0].nodeId])
  assert.equal(evidence.sites[0].readyForAdjudication, false)
  pending(evidence)
})

test('an unattributed comparator cannot excuse corrupt raw sample coverage', () => {
  const input = fixture([builtin('')], [])
  input.sites[0].sampleVector.entries.push(
    input.sites[0].sampleVector.entries[0]
  )
  const evidence = assess(input)
  assert.equal(evidence.rawCoverage.complete, false)
  assert.equal(assessAllocationSourceAdmission(evidence, 'vue').admitted, false)
})

test('a comparator cannot excuse a captured source identity mismatch', () => {
  const leaf = capturedScript('33', 'function leaf() { return {} }')
  leaf.frame.sourceIdentity.sha256 = 'not-the-captured-source'
  const evidence = assess(fixture([leaf.frame], [leaf]))
  assert.equal(assessAllocationSourceAdmission(evidence, 'vue').admitted, false)
})

test('a comparator cannot replace an invalid nearest source with an absent-caller limit', () => {
  const caller = capturedScript(
    '34',
    'function caller() { return operation() }'
  )
  caller.frame.columnNumber = 1000
  const evidence = assess(fixture([caller.frame, builtin()], [caller]))
  assert.equal(assessAllocationSourceAdmission(evidence, 'vue').admitted, false)
})

test('an undeclared consumer cannot acquire descriptive-comparator admission', () => {
  const evidence = assess(fixture([builtin('')], []))
  assert.equal(
    assessAllocationSourceAdmission(evidence, 'another-consumer').admitted,
    false
  )
})

test('source-ready native and comparator captures remain pending ownership review', () => {
  const caller = capturedScript(
    '35',
    'function caller() { return operation() }'
  )
  const evidence = assess(fixture([caller.frame, builtin()], [caller]))
  for (const consumer of ['native', 'vue']) {
    const result = assessAllocationSourceAdmission(evidence, consumer)
    assert.equal(result.admitted, true)
    assert.equal(result.sourceReadinessComplete, true)
    assert.deepEqual(result.unattributedNodeIds, [])
  }
  pending(evidence)
})
