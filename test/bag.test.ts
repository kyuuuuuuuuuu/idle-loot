import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { bagView, salvageWorse } from '../src/logic/bag.ts'
import { salvageValue } from '../src/logic/loot.ts'
import { powerOf, powerWithItem } from '../src/logic/stats.ts'
import { createState } from '../src/logic/types.ts'
import type { Balance, GameState, Item, Slot } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

const mk = (id: number, slot: Slot, rarity: 0 | 1 | 2 | 3, level: number, main: number): Item => ({ id, slot, rarity, level, main, affixes: [] })

/**
 * 身上武器主属性 10，戒指部位是空的。背包里：
 *  11 武器 30、12 武器 15、13 戒指 1：换上都会变强（涨幅 11 > 12 > 13）
 *  14–18 武器主属性 5：换上会变弱，品质、等级、id 各不相同
 *  19 衣服主属性 0：换上战力一点没变，也算"不会变高"
 */
const withBag = (): GameState => {
  const s = createState(balance, 0)
  s.equipped.weapon = mk(1, 'weapon', 0, 1, 10)
  s.bag = [
    mk(17, 'weapon', 1, 2, 5),
    mk(13, 'ring', 0, 1, 1),
    mk(15, 'weapon', 1, 7, 5),
    mk(19, 'armor', 0, 1, 0),
    mk(12, 'weapon', 0, 1, 15),
    mk(18, 'weapon', 0, 20, 5),
    mk(14, 'weapon', 3, 9, 5),
    mk(11, 'weapon', 0, 1, 30),
    mk(16, 'weapon', 1, 7, 5),
  ]
  return s
}

test('bag: bagView 先排能变强的（涨得多的在前），其余按品质、等级、新旧（id 大的在前）降序', () => {
  const s = withBag()
  const before = JSON.stringify(s)
  const rows = bagView(s, balance)
  assert.deepEqual(rows.map((r) => r.item.id), [11, 12, 13, 14, 16, 15, 17, 18, 19])
  assert.deepEqual(rows.map((r) => r.upgrade), [true, true, true, false, false, false, false, false, false])
  const current = powerOf(s, balance)
  for (const r of rows) {
    assert.ok(Math.abs(r.delta - (powerWithItem(s, balance, r.item) / current - 1)) < 1e-12, `id ${r.item.id}`)
  }
  assert.ok(rows[0].delta > rows[1].delta && rows[1].delta > rows[2].delta && rows[2].delta > 0)
  assert.ok(rows[3].delta < 0)
  assert.equal(rows[8].delta, 0) // 战力不变：不算变强
  assert.equal(JSON.stringify(s), before) // 不改 state
  assert.equal(rows[0].item, s.bag.find((it) => it.id === 11)) // 给的是背包里的原对象
})

test('bag: salvageWorse 只分解换上后战力不会变高的，金币 = 各件 salvageValue 之和，返回的件数对', () => {
  const s = withBag()
  s.gold = 100
  const worse = s.bag.filter((it) => it.id >= 14)
  const gold = worse.reduce((sum, it) => sum + salvageValue(balance, it), 0)
  assert.deepEqual(salvageWorse(s, balance), { count: 6, gold })
  assert.equal(s.gold, 100 + gold)
  assert.deepEqual(s.bag.map((it) => it.id).sort((a, b) => a - b), [11, 12, 13]) // 能变强的都还在
  assert.deepEqual(salvageWorse(s, balance), { count: 0, gold: 0 }) // 再来一次：没有更差的
  assert.equal(s.gold, 100 + gold)
})
