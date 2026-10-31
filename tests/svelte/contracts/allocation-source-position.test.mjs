import assert from 'node:assert/strict'
import test from 'node:test'
import { createSourcePositionIndex } from '../allocation-capture.mjs'

test('all ECMAScript line endings preserve source-character positions', () => {
  for (const ending of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
    const source = `first${ending}second`
    const index = createSourcePositionIndex(source)
    assert.equal(index.offsetAt(0, 4), 4)
    assert.equal(index.offsetAt(1, 0), source.indexOf('second'))
    assert.equal(index.offsetAt(1, 5), source.length - 1)
    assert.equal(index.offsetAt(0, 5), null)
    assert.equal(index.offsetAt(0, 6), null)
    assert.equal(index.offsetAt(2, 0), null)
  }
})

test('columns cannot spill from an earlier line into later probe text', () => {
  const index = createSourcePositionIndex('x\nfunction probe() {}')
  assert.equal(index.offsetAt(0, 2), null)
  assert.equal(index.offsetAt(0, 16), null)
  assert.equal(index.offsetAt(1, 0), 2)
})

test('nonzero origin columns affect only the first local line', () => {
  const index = createSourcePositionIndex('ab\ncd')
  assert.equal(index.offsetAt(10, 7, 10, 7), 0)
  assert.equal(index.offsetAt(10, 8, 10, 7), 1)
  assert.equal(index.offsetAt(10, 6, 10, 7), null)
  assert.equal(index.offsetAt(11, 0, 10, 7), 3)
  assert.equal(index.offsetAt(11, 1, 10, 7), 4)
  assert.equal(index.offsetAt(9, 7, 10, 7), null)
})

test('UTF-16, mixed endings, consecutive empty lines and trailing endings', () => {
  const index = createSourcePositionIndex('😀x\r\n\n\u2028y\rz\u2029')
  assert.equal(index.offsetAt(0, 2), 2)
  assert.equal(index.offsetAt(0, 3), null)
  assert.equal(index.offsetAt(0, 4), null)
  assert.equal(index.offsetAt(1, 0), null)
  assert.equal(index.offsetAt(2, 0), null)
  assert.equal(index.offsetAt(3, 0), 7)
  assert.equal(index.offsetAt(4, 0), 9)
  assert.equal(index.offsetAt(5, 0), null)
})

test('empty source and EOF never identify an attributable character', () => {
  assert.equal(createSourcePositionIndex('').offsetAt(0, 0), null)
  const index = createSourcePositionIndex('last')
  assert.equal(index.offsetAt(0, 3), 3)
  assert.equal(index.offsetAt(0, 4), null)
  assert.equal(index.offsetAt(1, 0), null)
})

test('invalid coordinates and origins fail closed instead of clamping', () => {
  const index = createSourcePositionIndex('valid')
  for (const invalid of [-1, NaN, Infinity, -Infinity, 0.5, 2 ** 53]) {
    assert.equal(index.offsetAt(invalid, 0), null)
    assert.equal(index.offsetAt(0, invalid), null)
    assert.equal(index.offsetAt(0, 0, invalid, 0), null)
    assert.equal(index.offsetAt(0, 0, 0, invalid), null)
  }
  assert.equal(
    index.offsetAt(Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER, 0),
    0
  )
})
