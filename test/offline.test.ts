import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { salvageValue } from '../src/logic/loot.ts'
import { applyOffline, computeOffline, grantOffline } from '../src/logic/offline.ts'
import { createRng } from '../src/logic/rng.ts'
import { createState } from '../src/logic/types.ts'
import type { Balance, GameState, Item } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))
const MIN = 60_000

/** 最近 4 个整分钟每分钟 100 金币、50 经验、10 击杀（第 5 格是刚开始的这一分钟，还是空的） */
const withRate = (): GameState => {
  const s = createState(balance, 0)
  const full = { gold: 100, exp: 50, kills: 10 }
  s.rate = { curMs: 0, buckets: [{ gold: 0, exp: 0, kills: 0 }, { ...full }, { ...full }, { ...full }, { ...full }] }
  return s
}

test('offline: 不到 minSeconds 时收益为 0；刚好到了就发', () => {
  const s = withRate()
  const none = computeOffline(s, balance, createRng(1), 59_000)
  assert.deepEqual(none, { seconds: 0, gold: 0, exp: 0, items: [] })
  const some = computeOffline(s, balance, createRng(1), 60_000)
  assert.equal(some.seconds, 60)
  assert.equal(some.gold, 50) // 1 分钟 × 100 × 0.5
})

test('offline: 时钟倒退或没变化时收益为 0', () => {
  const s = withRate()
  s.lastSavedAt = 10 * MIN
  assert.equal(computeOffline(s, balance, createRng(1), 5 * MIN).gold, 0)
  assert.equal(computeOffline(s, balance, createRng(1), 10 * MIN).gold, 0)
})

test('offline: 超过 capHours 时按上限算', () => {
  const r = computeOffline(withRate(), balance, createRng(1), 100 * 3600_000)
  assert.equal(r.seconds, balance.offline.capHours * 3600)
  assert.equal(r.gold, 480 * 100 * 0.5)
  assert.equal(r.exp, 480 * 50 * 0.5)
})

test('offline: 收益 = 分钟数 × 每分钟速率 × efficiency，装备按 击杀 × dropChance × efficiency 取整', () => {
  const r = computeOffline(withRate(), balance, createRng(1), 10 * MIN)
  assert.equal(r.seconds, 600)
  assert.equal(r.gold, 10 * 100 * 0.5)
  assert.equal(r.exp, 10 * 50 * 0.5)
  assert.equal(r.items.length, Math.floor(10 * 10 * 0.15 * 0.5)) // 7.5 → 7
})

test('offline: 没有速率记录时，按 defaultKillsPerMin × 当前关卡的小怪奖励估算', () => {
  const s = createState(balance, 0)
  s.stage.n = 3 // 小怪奖励：金币 4、经验 7
  const r = computeOffline(s, balance, createRng(1), 10 * MIN)
  assert.equal(r.gold, 10 * 6 * 4 * 0.5)
  assert.equal(r.exp, 10 * 6 * 7 * 0.5)
  assert.equal(r.items.length, Math.floor(10 * 6 * 0.15 * 0.5)) // 4.5 → 4
})

test('offline: 装备按当前关卡生成，id 接着 nextItemId；computeOffline 本身不改 state', () => {
  const s = withRate()
  s.stage.n = 6
  s.nextItemId = 50
  const before = JSON.stringify(s)
  const r = computeOffline(s, balance, createRng(1), 10 * MIN)
  assert.equal(JSON.stringify(s), before)
  assert.deepEqual(r.items.map((i) => i.id), [50, 51, 52, 53, 54, 55, 56])
  assert.ok(r.items.every((i) => i.level === 6))
})

test('offline: applyOffline 加金币、经验、装备；超出背包容量的装备被分解', () => {
  const s = withRate()
  const filler = (id: number): Item => ({ id, slot: 'ring', rarity: 0, level: 1, main: 1, affixes: [] })
  for (let i = 1; i <= 38; i++) s.bag.push(filler(i)) // 容量 40，只剩 2 个空位
  s.nextItemId = 100
  const r = computeOffline(s, balance, createRng(1), 10 * MIN) // 7 件
  assert.equal(r.items.length, 7)
  const { salvaged, salvageGold } = applyOffline(s, balance, r)
  assert.equal(s.bag.length, 40)
  assert.equal(salvaged, 5)
  assert.equal(salvageGold, r.items.slice(2).reduce((sum, it) => sum + salvageValue(balance, it), 0))
  assert.equal(s.gold, r.gold + salvageGold)
  assert.equal(s.nextItemId, 107)
  assert.ok(s.hero.level > 1 || s.hero.exp > 0) // 经验进了账（250 经验够升好几级）
})

test('offline: grantOffline 离开不到 minSeconds 返回 null，state 一点没动', () => {
  const s = withRate()
  const before = JSON.stringify(s)
  assert.equal(grantOffline(s, balance, createRng(1), 59_000), null)
  assert.equal(JSON.stringify(s), before)
})

test('offline: grantOffline 背包满时，汇总的 gold 含分解所得，salvaged 和 items 的件数对，state 已经加好', () => {
  const s = withRate()
  const filler = (id: number): Item => ({ id, slot: 'ring', rarity: 0, level: 1, main: 1, affixes: [] })
  for (let i = 1; i <= 38; i++) s.bag.push(filler(i)) // 容量 40，只剩 2 个空位
  s.nextItemId = 100
  const expected = computeOffline(structuredClone(s), balance, createRng(1), 10 * MIN) // 同种子：和 grantOffline 里算的一样
  const salvageGold = expected.items.slice(2).reduce((sum, it) => sum + salvageValue(balance, it), 0)

  const summary = grantOffline(s, balance, createRng(1), 10 * MIN)
  assert.deepEqual(summary, {
    seconds: 600,
    gold: expected.gold + salvageGold,
    exp: expected.exp,
    items: 7,
    salvaged: 5,
  })
  assert.equal(s.gold, summary.gold) // 加进 state 的就是汇总里写的
  assert.equal(s.bag.length, 40)
})
