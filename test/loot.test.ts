import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mainStat, rollItem, rollRarity, salvageValue } from '../src/logic/loot.ts'
import { createRng } from '../src/logic/rng.ts'
import type { Balance, Rarity } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))
const RARITIES: Rarity[] = [0, 1, 2, 3]

test('loot: 种子 1 抽 20000 次，各档品质占比和权重折算的百分比相差不超过 1.5 个百分点', () => {
  const rng = createRng(1)
  const w = balance.items.rarityWeights
  const total = w.reduce((a, b) => a + b, 0)
  const counts = [0, 0, 0, 0]
  for (let i = 0; i < 20000; i++) counts[rollRarity(rng, w)]++
  for (const r of RARITIES) {
    const expected = (w[r] / total) * 100
    const actual = (counts[r] / 20000) * 100
    assert.ok(Math.abs(actual - expected) <= 1.5, `品质 ${r}：期望 ${expected}%，实际 ${actual}%`)
  }
})

test('loot: 每档的词缀条数等于 rarityAffixCount', () => {
  const rng = createRng(2)
  for (const r of RARITIES) {
    for (let i = 0; i < 200; i++) {
      const item = rollItem(balance, rng, { id: i + 1, level: 3, rarity: r })
      assert.equal(item.affixes.length, balance.items.rarityAffixCount[r])
    }
  }
})

test('loot: 同一件装备没有重复词缀，词缀数值落在 [最小, 最大] × 品质倍率内', () => {
  const rng = createRng(3)
  for (let i = 0; i < 2000; i++) {
    const item = rollItem(balance, rng, { id: i + 1, level: 5, rarity: 3 })
    assert.equal(new Set(item.affixes.map((a) => a.id)).size, item.affixes.length)
    for (const a of item.affixes) {
      const [min, max] = balance.affixes[a.id]
      const mult = balance.items.rarityMult[3]
      assert.ok(a.value >= min * mult - 0.0005 && a.value <= max * mult + 0.0005, `${a.id}=${a.value}`)
      assert.equal(a.value, Math.round(a.value * 1000) / 1000) // 保留 3 位小数
    }
  }
})

test('loot: 物品等级 5 的精良 weapon，主属性 = round((3 + 1.6×4) × 1.35) = 13', () => {
  assert.equal(mainStat(balance, 'weapon', 5, 1), 13)
  const item = rollItem(balance, createRng(1), { id: 1, level: 5, rarity: 1, slot: 'weapon' })
  assert.equal(item.main, 13)
  assert.equal(item.slot, 'weapon')
  assert.equal(item.level, 5)
})

test('loot: 其他部位的主属性：戒指、项链乘部位系数，衣服、项链走生命公式', () => {
  assert.equal(mainStat(balance, 'ring', 5, 1), 8) // round(9.4 × 1.35 × 0.6)
  assert.equal(mainStat(balance, 'armor', 5, 1), 116) // round((30 + 14×4) × 1.35)
  assert.equal(mainStat(balance, 'amulet', 5, 1), 70) // round(86 × 1.35 × 0.6)
})

test('loot: 分解价值 = salvageBase[品质] × (1 + salvagePerLevel × 物品等级)，取整', () => {
  assert.equal(salvageValue(balance, { rarity: 2, level: 7 }), 85) // 50 × 1.7
  assert.equal(salvageValue(balance, { rarity: 3, level: 10 }), 400) // 200 × 2
  for (const r of RARITIES) {
    for (let level = 1; level <= 30; level++) {
      const expected = Math.round(balance.items.salvageBase[r] * (1 + balance.items.salvagePerLevel * level))
      assert.equal(salvageValue(balance, { rarity: r, level }), expected)
    }
  }
})
