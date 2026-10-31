import { setTimeout as delay } from 'node:timers/promises'

// V8 source positions use UTF-16 units and recognize all ECMAScript line endings.
// Attribution is stricter than engine display positions: no terminators or EOF.
export function createSourcePositionIndex(source) {
  const starts = [0]
  const ends = []
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index)
    if (code === 13 || code === 10 || code === 8232 || code === 8233) {
      ends.push(index)
      if (code === 13 && source.charCodeAt(index + 1) === 10) index++
      starts.push(index + 1)
    }
  }
  ends.push(source.length)
  return {
    offsetAt(line, column, startLine = 0, startColumn = 0) {
      if (
        !Number.isSafeInteger(line) ||
        line < 0 ||
        !Number.isSafeInteger(column) ||
        column < 0 ||
        !Number.isSafeInteger(startLine) ||
        startLine < 0 ||
        !Number.isSafeInteger(startColumn) ||
        startColumn < 0
      )
        return null
      const localLine = line - startLine
      const localColumn = column - (localLine === 0 ? startColumn : 0)
      if (
        localLine < 0 ||
        localLine >= starts.length ||
        localColumn < 0 ||
        localColumn >= ends[localLine] - starts[localLine]
      )
        return null
      return starts[localLine] + localColumn
    },
  }
}

// Only the start/stop protocol commands cross into the target during this window.
// The optional AbortSignal belongs to the host and is never sent over CDP.
export async function captureAllocationWindow(cdp, durationMs, parameters) {
  const { signal, ...samplingParameters } = parameters
  signal?.throwIfAborted()
  const timing = {
    requestedDurationMs: durationMs,
    startRequestEpochMs: 0,
    startAcknowledgedEpochMs: 0,
    stopRequestEpochMs: 0,
    stopAcknowledgedEpochMs: 0,
  }
  let active = false
  async function stop() {
    timing.stopRequestEpochMs = Date.now()
    const result = await cdp.send('HeapProfiler.stopSampling')
    active = false
    timing.stopAcknowledgedEpochMs = Date.now()
    return result.profile
  }
  timing.startRequestEpochMs = Date.now()
  try {
    await cdp.send('HeapProfiler.startSampling', samplingParameters)
  } catch (cause) {
    const error = new Error(`Allocation sampling could not start: ${cause}`, {
      cause,
    })
    error.samplingPhase = 'start'
    throw error
  }
  active = true
  try {
    timing.startAcknowledgedEpochMs = Date.now()
    await delay(durationMs, undefined, { signal })
    const profile = await stop()
    signal?.throwIfAborted()
    return { profile, timing }
  } catch (error) {
    if (active) {
      try {
        await stop()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Allocation capture failed and the active sampler could not be stopped',
          { cause: error }
        )
      }
    }
    throw error
  }
}
