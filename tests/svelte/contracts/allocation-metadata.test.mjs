import assert from 'node:assert/strict'
import test from 'node:test'
import { profileMetadata } from '../allocation-metadata.mjs'

function node(
  id,
  functionName,
  scriptId,
  url,
  lineNumber,
  columnNumber,
  children = []
) {
  return {
    id,
    selfSize: 0,
    callFrame: { functionName, scriptId, url, lineNumber, columnNumber },
    children,
  }
}

test('metadata includes zero-self ancestors and position-resolved scripts from the entire tree', () => {
  const leaf = node(3, 'leaf', '7', '/leaf.js', 10, 2)
  const ancestor = node(2, 'ancestor', '4', '/ancestor.js', 2, 1, [leaf])
  const profile = {
    head: node(1, '(root)', '0', '', -1, -1, [ancestor]),
    samples: [],
  }
  const metadata = profileMetadata(profile)
  assert.equal(metadata.names.includes('ancestor'), true)
  assert.equal(metadata.names.includes('leaf'), true)
  assert.deepEqual(
    metadata.resolvedScripts.map((frame) => [frame.scriptId, frame.url]),
    [
      ['4', '/ancestor.js'],
      ['7', '/leaf.js'],
    ]
  )
  assert.deepEqual(metadata.unresolvedScriptNodes, [])
})

test('a loaded script with unresolved positions is not counted as position-warmed', () => {
  const invalid = node(2, 'unresolved', '4', '/unresolved.js', -1, 0)
  const valid = node(3, 'resolved', '7', '/resolved.js', 0, 0)
  const metadata = profileMetadata({
    head: node(1, '(root)', '0', '', -1, -1, [invalid, valid]),
    samples: [],
  })
  assert.deepEqual(
    metadata.resolvedScripts.map((frame) => frame.scriptId),
    ['7']
  )
  assert.deepEqual(
    metadata.unresolvedScriptNodes.map((item) => item.nodeId),
    [2]
  )
})

test('canonical integer-index names cannot silently qualify as interned named keys', () => {
  const metadata = profileMetadata({
    head: node(1, '(root)', '0', '', -1, -1, [
      node(2, '0', '4', '', 0, 0),
      node(3, '123', '4', '', 1, 0),
      node(4, '01', '4', '', 2, 0),
      node(5, '-1', '4', '', 3, 0),
      node(6, '1e3', '4', '', 4, 0),
    ]),
    samples: [],
  })
  assert.deepEqual(metadata.indexLikeNames, ['0', '123'])
})
