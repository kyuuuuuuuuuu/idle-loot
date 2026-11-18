import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRng } from '../src/logic/rng.ts'

const take = (seed: number, n: number): number[] => {
  const rng = createRng(seed)
  return Array.from({ length: n }, () => rng.next())
}

test('rng: 同种子同序列', () => {
  assert.deepEqual(take(42, 100), take(42, 100))
})

test('rng: 不同种子序列不同', () => {
  assert.notDeepEqual(take(1, 20), take(2, 20))
})

test('rng: next 落在 [0,1)，int 落在闭区间，pick 只返回数组里的元素', () => {
  const rng = createRng(7)
  const seen = new Set<number>()
  for (let i = 0; i < 5000; i++) {
    const x = rng.next()
    assert.ok(x >= 0 && x < 1)
    const n = rng.int(3, 6)
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6)
    seen.add(n)
    assert.ok(['a', 'b', 'c'].includes(rng.pick(['a', 'b', 'c'])))
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]) // 两端都能取到
})
