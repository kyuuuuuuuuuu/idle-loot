import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { salvageValue } from '../src/logic/loot.ts'
import { enhance, enhanceCost, equip, gainExp, receiveItem, salvage, setSkillOrder } from '../src/logic/progress.ts'
import { createState } from '../src/logic/types.ts'
import type { Balance, Item, Slot } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

const mk = (id: number, slot: Slot = 'weapon', rarity: 0 | 1 | 2 | 3 = 0): Item => ({ id, slot, rarity, level: 4, main: 10, affixes: [] })

test('progress: 一次给大量经验能连升几级，剩余经验正确', () => {
  const s = createState(balance, 0)
  // 各级所需经验 40 54 73 98 133 179 242 327…，前 7 级合计 819
  assert.equal(gainExp(s, balance, 1000), 7)
  assert.equal(s.hero.level, 8)
  assert.equal(s.hero.exp, 1000 - 819)
})

test('progress: 经验不够升级时只累加', () => {
  const s = createState(balance, 0)
  assert.equal(gainExp(s, balance, 39), 0)
  assert.equal(s.hero.level, 1)
  assert.equal(s.hero.exp, 39)
  assert.equal(gainExp(s, balance, 1), 1) // 正好够
  assert.equal(s.hero.exp, 0)
})

test('progress: 换装后，旧装备回到背包', () => {
  const s = createState(balance, 0)
  const oldW = mk(1)
  const newW = mk(2)
  s.equipped.weapon = oldW
  s.bag.push(mk(9, 'ring'), newW)
  assert.equal(equip(s, 2), true)
  assert.equal(s.equipped.weapon, newW)
  assert.deepEqual(s.bag.map((i) => i.id), [9, 1]) // 旧的回到新装备原来的位置
})

test('progress: 部位是空的时候换装，背包少一件；找不到的 id 什么都不做', () => {
  const s = createState(balance, 0)
  s.bag.push(mk(1, 'amulet'))
  assert.equal(equip(s, 77), false)
  assert.equal(s.bag.length, 1)
  assert.equal(equip(s, 1), true)
  assert.equal(s.bag.length, 0)
  assert.equal(s.equipped.amulet?.id, 1)
})

test('progress: 分解后装备移除，金币增加', () => {
  const s = createState(balance, 0)
  const item = mk(5, 'armor', 2)
  s.bag.push(item)
  assert.equal(salvage(s, balance, 5), true)
  assert.equal(s.bag.length, 0)
  assert.equal(s.gold, salvageValue(balance, item))
  assert.equal(salvage(s, balance, 5), false) // 已经没了
  assert.equal(s.gold, salvageValue(balance, item))
})

test('progress: 强化后扣钱、等级 +1，费用逐级上涨', () => {
  const s = createState(balance, 0)
  s.gold = 200
  assert.deepEqual([0, 1, 2].map((k) => enhanceCost(balance, k)), [40, 58, 84])
  assert.equal(enhance(s, balance, 'ring'), true)
  assert.equal(s.gold, 160)
  assert.equal(s.enhance.ring, 1)
  assert.equal(enhance(s, balance, 'ring'), true) // 58
  assert.equal(s.gold, 102)
  assert.equal(s.enhance.ring, 2)
  assert.equal(s.enhance.weapon, 0) // 别的部位不受影响
})

test('progress: 金币不够时强化返回 false，状态不变', () => {
  const s = createState(balance, 0)
  s.gold = 39
  const before = JSON.stringify(s)
  assert.equal(enhance(s, balance, 'weapon'), false)
  assert.equal(JSON.stringify(s), before)
})

test('progress: 技能顺序必须是三个技能各一次的排列', () => {
  const s = createState(balance, 0)
  assert.equal(setSkillOrder(s, ['heal', 'whirl', 'heavy']), true)
  assert.deepEqual(s.skills.order, ['heal', 'whirl', 'heavy'])
  assert.equal(setSkillOrder(s, ['heal', 'heal', 'heavy']), false)
  assert.equal(setSkillOrder(s, ['heal', 'heavy']), false)
  assert.deepEqual(s.skills.order, ['heal', 'whirl', 'heavy'])
})

test('progress: receiveItem 背包有空位就放进去，满了直接分解', () => {
  const b = structuredClone(balance)
  b.items.bagCapacity = 1
  const s = createState(b, 0)
  assert.deepEqual(receiveItem(s, b, mk(1)), { item: mk(1), salvaged: false, gold: 0 })
  const second = receiveItem(s, b, mk(2, 'ring', 1))
  assert.equal(second.salvaged, true)
  assert.equal(s.bag.length, 1)
  assert.equal(s.gold, second.gold)
  assert.equal(second.gold, salvageValue(b, mk(2, 'ring', 1)))
})
