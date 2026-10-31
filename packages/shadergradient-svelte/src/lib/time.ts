import type { TimeSettings } from './types.js'

/** Accumulate active finite positive deltas only; pause/resume never samples wall time.
 * The caller owns elapsed and explicit uTime seeks; uSpeed remains shader input.
 */
export function advanceElapsed(
  elapsed: number,
  delta: number,
  advancing: boolean
): number {
  return advancing && Number.isFinite(delta) && delta > 0
    ? elapsed + delta
    : elapsed
}

/** Map raw elapsed without changing it: valid loop wins, then offset-origin range.
 * Invalid intervals fall through unchanged; negative seeks wrap positively.
 * Numeric-only frame helpers allocate nothing and never create a clock or state.
 */
export function resolveTime(
  elapsed: number,
  settings: Readonly<TimeSettings>
): number {
  const duration = settings.loopDuration
  if (settings.loop === 'on' && Number.isFinite(duration) && duration > 0) {
    return ((elapsed % duration) + duration) % duration
  }
  const start = settings.rangeStart
  const end = settings.rangeEnd
  const width = end - start
  if (
    settings.range === 'enabled' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(width) &&
    width > 0
  ) {
    return start + (((elapsed % width) + width) % width)
  }
  return elapsed
}
