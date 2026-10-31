import assert from 'node:assert/strict'
import { test } from 'node:test'

// UNIT ONLY: actual built internal math, not a public subpath API or a rendered
// scheduler acceptance test. Parent builds core/native before this Node suite.
import {
  advanceElapsed,
  resolveTime,
} from '../../../packages/shadergradient-svelte/dist/time.js'

// Independent caller settings, deliberately different from native defaults.
const free = Object.freeze({
  animate: 'on',
  uTime: -6,
  loop: 'off',
  loopDuration: 7,
  range: 'disabled',
  rangeStart: 11,
  rangeEnd: 16,
})
const loop = Object.freeze({ ...free, loop: 'on' })
const range = Object.freeze({ ...free, range: 'enabled' })

test('active deltas accumulate independently from loop mapping', () => {
  let elapsed = free.uTime
  elapsed = advanceElapsed(elapsed, 0.25, true)
  elapsed = advanceElapsed(elapsed, 0.5, true)
  assert.equal(elapsed, -5.25)
  assert.equal(resolveTime(elapsed, free), -5.25)
  assert.equal(resolveTime(elapsed, loop), 1.75)
})

test('pause and resume add only active deltas, never the intervening wall-time gap', () => {
  let elapsed = 2
  elapsed = advanceElapsed(elapsed, 0.25, true)
  elapsed = advanceElapsed(elapsed, 3600, false)
  elapsed = advanceElapsed(elapsed, 7200, false)
  assert.equal(elapsed, 2.25)
  elapsed = advanceElapsed(elapsed, 0.125, true)
  assert.equal(elapsed, 2.375)
  // The same advancing=false contract is used by pause, inactive and motion gates;
  // browser tests separately prove those gates reach the real scheduler.
  elapsed = advanceElapsed(elapsed, 60, false)
  assert.equal(resolveTime(elapsed, free), 2.375)
})

test('caller-owned negative seek takes effect while paused and resumes from that seek', () => {
  let elapsed = advanceElapsed(20, 0.5, true)
  elapsed = -1.25 // Explicit finite uTime seek belongs to the caller, not this helper.
  elapsed = advanceElapsed(elapsed, 500, false)
  assert.equal(resolveTime(elapsed, free), -1.25)
  assert.equal(resolveTime(elapsed, loop), 5.75)
  assert.equal(resolveTime(elapsed, range), 14.75)
  elapsed = advanceElapsed(elapsed, 0.5, true)
  assert.equal(elapsed, -0.75)
  assert.equal(resolveTime(elapsed, loop), 6.25)
})

for (const delta of [0, -0.25, NaN, Infinity, -Infinity]) {
  test(`nonpositive or nonfinite delta ${String(delta)} never advances`, () => {
    assert.equal(advanceElapsed(3.5, delta, true), 3.5)
    assert.equal(advanceElapsed(3.5, delta, false), 3.5)
  })
}

// Literal expected outputs, not an oracle that duplicates positiveModulo code.
for (const [elapsed, expected] of [
  [0, 0],
  [7, 0],
  [14, 0],
  [-7, 0],
  [-14, 0],
  [-0.25, 6.75],
  [-8.5, 5.5],
  [15.25, 1.25],
  [7000000001.5, 1.5],
]) {
  test(`positive modulo maps loop elapsed ${elapsed} to ${expected}`, () => {
    assert.equal(resolveTime(elapsed, loop), expected)
  })
}

test('fractional positive duration wraps without rounding or clamping', () => {
  const settings = { ...loop, loopDuration: 2.5 }
  assert.equal(resolveTime(-0.5, settings), 2)
  assert.equal(resolveTime(5, settings), 0)
  assert.equal(resolveTime(7.75, settings), 0.25)
})

for (const [elapsed, expected] of [
  [0, 11],
  [5, 11],
  [11, 12],
  [16, 12],
  [-1, 15],
  [-6.25, 14.75],
  [1000000002, 13],
]) {
  test(`offset-origin range maps elapsed ${elapsed} to ${expected}`, () => {
    assert.equal(resolveTime(elapsed, range), expected)
  })
}

test('negative and fractional range endpoints preserve the offset-origin rule', () => {
  const settings = { ...range, rangeStart: -4.5, rangeEnd: -2 }
  assert.equal(resolveTime(0, settings), -4.5)
  assert.equal(resolveTime(-0.5, settings), -2.5)
  assert.equal(resolveTime(5.25, settings), -4.25)
})

test('valid loop takes precedence over simultaneous range and later remaps the same raw elapsed', () => {
  const settings = { ...loop, range: 'enabled' }
  const elapsed = 17
  assert.equal(resolveTime(elapsed, settings), 3)
  assert.equal(resolveTime(elapsed, { ...settings, loop: 'off' }), 13)
  assert.equal(resolveTime(elapsed, { ...settings, loopDuration: 4 }), 1)
  assert.equal(resolveTime(elapsed, free), 17)
})

for (const loopDuration of [0, -7, NaN, Infinity, -Infinity]) {
  test(`invalid loop duration ${String(loopDuration)} falls through to valid range or raw elapsed`, () => {
    assert.equal(resolveTime(-1, { ...range, loop: 'on', loopDuration }), 15)
    assert.equal(resolveTime(-1, { ...loop, loopDuration }), -1)
  })
}

for (const [rangeStart, rangeEnd] of [
  [4, 4],
  [9, 3],
  [NaN, 8],
  [2, NaN],
  [Infinity, 8],
  [2, Infinity],
  [-Infinity, 8],
  [2, -Infinity],
  [-Number.MAX_VALUE, Number.MAX_VALUE],
]) {
  test(`invalid range ${String(rangeStart)}..${String(rangeEnd)} is not sorted, clamped or swapped`, () => {
    assert.equal(resolveTime(-3.25, { ...range, rangeStart, rangeEnd }), -3.25)
    assert.equal(
      resolveTime(-3.25, { ...loop, range: 'enabled', rangeStart, rangeEnd }),
      3.75
    )
  })
}

test('disabled intervals do not wrap merely because their numeric widths are valid', () => {
  assert.equal(resolveTime(-21, free), -21)
  assert.equal(resolveTime(29, { ...range, range: 'disabled' }), 29)
  assert.equal(resolveTime(29, { ...loop, loop: 'off' }), 29)
})
