import { createHash } from 'node:crypto'
import { createSourcePositionIndex } from './allocation-capture.mjs'

const identityFields = [
  'sessionKey',
  'debuggerId',
  'scriptId',
  'url',
  'executionContextId',
  'executionContextUniqueId',
  'contextKey',
  'contextEpoch',
  'protocolHash',
  'sha256',
  'capturedAt',
  'sourceEvidence',
]
const scriptId = (frame) => String(frame?.scriptId ?? '0')
const hasScript = (frame) => scriptId(frame) !== '0'
const rawFrame = (frame) => ({
  scriptId: scriptId(frame),
  url: (frame?.generated ?? frame)?.url ?? '',
  lineNumber: (frame?.generated ?? frame)?.lineNumber,
  columnNumber: (frame?.generated ?? frame)?.columnNumber,
})
const sameFrame = (left, right) => {
  const a = rawFrame(left)
  const b = rawFrame(right)
  return Object.keys(a).every((key) => a[key] === b[key])
}
const sameIdentity = (left, right) =>
  !!left &&
  !!right &&
  identityFields.every((key) => (left[key] ?? null) === (right[key] ?? null))

/**
 * Prospective capture readiness, never ownership or allocation acceptance.
 * Sources are the caller's existing captured/current script objects, not a
 * registry or an inferred caller. Index/hash caches live only for this call.
 */
export function assessAllocationSourceEvidence({
  profile,
  sites,
  sources,
  sessionKey,
  debuggerId,
  closed = false,
  fatalError = null,
}) {
  const sourceCache = new Map()
  function validateSource(frame, frameIndex) {
    const position = rawFrame(frame)
    const captured = sources.get(position.scriptId)
    const script = captured?.script
    let cached = script && sourceCache.get(script)
    if (!cached) {
      const reasons = []
      const identity = captured?.sourceIdentity
      const metadata = script?.metadata
      const context = metadata?.context
      if (
        closed ||
        fatalError ||
        typeof sessionKey !== 'string' ||
        !sessionKey ||
        !script ||
        captured.currentScript !== script ||
        !metadata ||
        !context ||
        context.retired ||
        context.metadataUnavailable
      )
        reasons.push('missing-or-retired-exact-captured-script')
      if (
        !identity ||
        identity.sessionKey !== sessionKey ||
        identity.debuggerId !== debuggerId ||
        identity.scriptId !== script?.scriptId ||
        identity.url !== script?.url ||
        identity.executionContextId !== metadata?.executionContextId ||
        identity.executionContextUniqueId !== context?.uniqueId ||
        identity.contextKey !== context?.key ||
        identity.contextEpoch !== context?.epoch ||
        metadata?.sessionKey !== sessionKey ||
        metadata?.scriptId !== script?.scriptId ||
        metadata?.url !== script?.url ||
        !Number.isSafeInteger(metadata?.executionContextId) ||
        typeof context?.key !== 'string' ||
        !context.key ||
        !Number.isSafeInteger(context?.epoch) ||
        context.epoch < 0
      )
        reasons.push('captured-source-session-or-context-identity-mismatch')
      if (
        typeof metadata?.protocolHash !== 'string' ||
        !metadata.protocolHash ||
        identity?.protocolHash !== metadata.protocolHash
      )
        reasons.push('protocol-hash-identity-unavailable-or-changed')
      let sha256 = null
      let bytesUTF8 = null
      let index = null
      if (typeof script?.scriptSource !== 'string')
        reasons.push('exact-captured-source-body-unavailable')
      else {
        sha256 = createHash('sha256').update(script.scriptSource).digest('hex')
        bytesUTF8 = Buffer.byteLength(script.scriptSource)
        index = createSourcePositionIndex(script.scriptSource)
        if (
          sha256 !== identity?.sha256 ||
          sha256 !== script.sha256 ||
          sha256 !== metadata?.sha256 ||
          typeof metadata?.sourceCapturedAt !== 'string' ||
          !metadata.sourceCapturedAt ||
          identity?.capturedAt !== metadata.sourceCapturedAt ||
          typeof metadata?.sourceEvidence !== 'string' ||
          !metadata.sourceEvidence ||
          (identity?.sourceEvidence ?? null) !==
            (metadata?.sourceEvidence ?? null)
        )
          reasons.push('captured-utf8-source-sha256-or-provenance-mismatch')
      }
      cached = { reasons, identity, metadata, sha256, bytesUTF8, index }
      if (script) sourceCache.set(script, cached)
    }
    const reasons = [...cached.reasons]
    if (
      frame.sourceCaptureError ||
      !sameIdentity(frame.sourceIdentity, cached.identity) ||
      position.scriptId !== script?.scriptId ||
      position.url !== script?.url
    )
      reasons.push('frame-does-not-own-exact-captured-source-identity')
    const originKnown =
      Number.isSafeInteger(cached.metadata?.startLine) &&
      cached.metadata.startLine >= 0 &&
      Number.isSafeInteger(cached.metadata?.startColumn) &&
      cached.metadata.startColumn >= 0
    const offsetUTF16 = originKnown
      ? cached.index?.offsetAt(
          position.lineNumber,
          position.columnNumber,
          cached.metadata.startLine,
          cached.metadata.startColumn
        ) ?? null
      : null
    if (offsetUTF16 === null)
      reasons.push('raw-position-does-not-identify-a-source-character')
    return {
      frameIndex,
      frame,
      ready: reasons.length === 0,
      reasons,
      sourceIdentity: cached.identity ?? null,
      rawPosition: position,
      offsetUTF16,
      sha256: cached.sha256,
      protocolHash: cached.identity?.protocolHash ?? null,
      bytesUTF8: cached.bytesUTF8,
      sourceCharacter:
        offsetUTF16 === null ? null : script.scriptSource[offsetUTF16],
      sourceExcerpt:
        offsetUTF16 === null
          ? null
          : script.scriptSource.slice(
              Math.max(0, offsetUTF16 - 80),
              offsetUTF16 + 160
            ),
    }
  }

  const tree = new Map()
  const duplicateTreeNodeIds = []
  const invalidTreeNodes = []
  const visited = new WeakSet()
  function walk(node, ancestors) {
    if (!node || typeof node !== 'object' || visited.has(node)) {
      invalidTreeNodes.push(node?.id ?? null)
      return
    }
    visited.add(node)
    if (tree.has(node.id)) duplicateTreeNodeIds.push(node.id)
    const stack = [...ancestors, node.callFrame]
    tree.set(node.id, { node, stack })
    if (!node.callFrame || !Array.isArray(node.children)) {
      invalidTreeNodes.push(node.id)
      return
    }
    for (const child of node.children) walk(child, stack)
  }
  walk(profile?.head, [])
  const samples = profile?.samples ?? []
  const expectedVectors = new Map()
  const orphanSampleVectorNodeIds = []
  for (const [index, sample] of samples.entries()) {
    if (!tree.has(sample.nodeId)) orphanSampleVectorNodeIds.push(sample.nodeId)
    const vector = expectedVectors.get(sample.nodeId) ?? []
    vector.push(index)
    expectedVectors.set(sample.nodeId, vector)
  }
  const retained = new Set(
    [...tree]
      .filter(([id, { node }]) => node.selfSize || expectedVectors.has(id))
      .map(([id]) => id)
  )
  const seenSites = new Set()
  const duplicateSiteNodeIds = []
  const unexpectedSiteNodeIds = []
  const mismatchedSiteNodeIds = []
  const representedSampleIndices = new Set()
  const invalidSampleIndices = []
  const duplicateSampleIndices = []
  for (const site of sites) {
    if (seenSites.has(site.nodeId)) duplicateSiteNodeIds.push(site.nodeId)
    seenSites.add(site.nodeId)
    const raw = tree.get(site.nodeId)
    if (!retained.has(site.nodeId)) unexpectedSiteNodeIds.push(site.nodeId)
    if (
      !raw ||
      site.treeSelfSize !== raw.node.selfSize ||
      !Array.isArray(site.stack) ||
      site.stack.length !== raw.stack.length ||
      !site.stack.every((frame, index) => sameFrame(frame, raw.stack[index])) ||
      !sameFrame(site.frame, raw.node.callFrame)
    )
      mismatchedSiteNodeIds.push(site.nodeId)
    const entries = site.sampleVector?.entries ?? []
    const expected = expectedVectors.get(site.nodeId) ?? []
    if (
      entries.length !== expected.length ||
      (entries.length > 0 &&
        site.sampleVector.weightedBytes !==
          expected.reduce((sum, index) => sum + samples[index].size, 0))
    )
      mismatchedSiteNodeIds.push(site.nodeId)
    for (const entry of entries) {
      const index = entry.rawSampleIndex
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !samples[index] ||
        samples[index].nodeId !== site.nodeId ||
        JSON.stringify(entry.sample) !== JSON.stringify(samples[index])
      )
        invalidSampleIndices.push(index)
      if (representedSampleIndices.has(index))
        duplicateSampleIndices.push(index)
      representedSampleIndices.add(index)
    }
  }
  const missingSiteNodeIds = [...retained].filter((id) => !seenSites.has(id))
  const missingSampleIndices = samples
    .map((_, index) => index)
    .filter((index) => !representedSampleIndices.has(index))
  const coverageFailures = {
    duplicateTreeNodeIds,
    invalidTreeNodes,
    orphanSampleVectorNodeIds,
    duplicateSiteNodeIds,
    unexpectedSiteNodeIds,
    mismatchedSiteNodeIds,
    missingSiteNodeIds,
    invalidSampleIndices,
    duplicateSampleIndices,
    missingSampleIndices,
  }
  const rawCoverage = {
    complete: Object.values(coverageFailures).every(
      (values) => values.length === 0
    ),
    rawSampleEntries: samples.length,
    retainedTreeSites: retained.size,
    evaluatedSites: sites.length,
    representedSampleEntries: representedSampleIndices.size,
    ...coverageFailures,
  }
  const evidenceSites = sites.map((site) => {
    const stack = Array.isArray(site.stack) ? site.stack : []
    const ancestry = stack.flatMap((frame, index) =>
      hasScript(frame) ? [validateSource(frame, index)] : []
    )
    const reasons = []
    let leafSource = null
    let nearestRecordedJSCaller = null
    let evidenceKind
    if (!rawCoverage.complete) reasons.push('raw-coverage')
    if (hasScript(site.frame)) {
      evidenceKind = 'leaf-source'
      leafSource = validateSource(site.frame, stack.length - 1)
      if (!leafSource.ready) reasons.push('leaf-source-unavailable')
    } else {
      const nearest = ancestry.findLast(
        (entry) => entry.frameIndex < stack.length - 1
      )
      if (!nearest) {
        evidenceKind = 'no-caller'
        reasons.push('no-recorded-js-caller')
      } else {
        nearestRecordedJSCaller = nearest
        evidenceKind = nearest.ready ? 'nearest-caller' : 'invalid-nearest'
        if (!nearest.ready) reasons.push('invalid-nearest-recorded-js-caller')
      }
    }
    if (ancestry.some((entry) => !entry.ready))
      reasons.push('missing-ancestry-source')
    return {
      nodeId: site.nodeId,
      treeSelfSize: site.treeSelfSize,
      rawSampleIndices: (site.sampleVector?.entries ?? []).map(
        (entry) => entry.rawSampleIndex
      ),
      readyForAdjudication: reasons.length === 0,
      evidenceKind,
      reasons,
      leafSource,
      nearestRecordedJSCaller,
      requiredNonzeroAncestry: ancestry,
      qualificationStatus: 'pending-allocation-review',
    }
  })
  return {
    complete:
      rawCoverage.complete &&
      evidenceSites.every((site) => site.readyForAdjudication),
    qualificationStatus: 'pending-allocation-review',
    scope:
      'Prospective sampled source/caller evidence readiness only. A nearest recorded JS caller is neither an allocating/direct causal caller nor proof of necessity, ownership, zero allocation, or acceptance. Every Script 0 site remains mandatory allocation review; unresolved native ownership blocks native qualification. A descriptive legacy comparison offers no allocation-ownership certificate.',
    sessionKey,
    debuggerId,
    rawCoverage,
    sites: evidenceSites,
  }
}

/**
 * Native qualification requires complete source readiness. The legacy
 * comparator offers only descriptive totals: an absent caller may limit
 * attribution, never excuse corrupt raw data or an invalid captured source.
 */
export function assessAllocationSourceAdmission(evidence, consumer) {
  const native = consumer === 'native'
  const comparator = consumer === 'vue'
  const attributionOnly = evidence.sites.every(
    (site) =>
      site.readyForAdjudication ||
      (site.evidenceKind === 'no-caller' &&
        site.reasons.length === 1 &&
        site.reasons[0] === 'no-recorded-js-caller' &&
        site.requiredNonzeroAncestry.length === 0 &&
        site.leafSource === null &&
        site.nearestRecordedJSCaller === null)
  )
  return {
    consumer,
    admitted:
      (native || comparator) &&
      evidence.rawCoverage.complete &&
      (evidence.complete || (comparator && attributionOnly)),
    sourceReadinessComplete: evidence.complete,
    allocationCertificate: native
      ? 'pending-native-owning-source-review'
      : 'not-offered-descriptive-comparison',
    unattributedNodeIds: evidence.sites
      .filter((site) => !site.readyForAdjudication)
      .map((site) => site.nodeId),
    scope:
      'Prospective role-specific admission only. Native source readiness remains mandatory. A comparator-only absent caller remains UNKNOWN, included in raw totals and mandatory review; it is not an ownership, necessity, avoidability, overhead, or native-qualification finding.',
  }
}
