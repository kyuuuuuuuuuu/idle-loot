import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { heroStats, power, powerOf, powerWithItem } from '../src/logic/stats.ts'
import { createState } from '../src/logic/types.ts'
import type { Affix, Balance, Item, Slot } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

const mk = (slot: Slot, main: number, affixes: Affix[] = []): Item => ({ id: 1, slot, rarity: 0, level: 1, main, affixes })

test('stats: 1 级、没穿装备时等于基础值', () => {
  const st = heroStats(createState(balance, 0), balance)
  assert.deepEqual(st, { atk: 10, maxHp: 120, critRate: 0.05, critDmg: 1.5, atkSpeed: 1, cdr: 0 })
  assert.equal(power(st), 112) // round(10 × 1.025 × √120)
})

test('stats: 等级成长 = 基础 + 每级增量 × (L−1)', () => {
  const s = createState(balance, 0)
  s.hero.level = 5
  const st = heroStats(s, balance)
  assert.equal(st.atk, 10 + 2 * 4)
  assert.equal(st.maxHp, 120 + 16 * 4)
})

test('stats: 穿上武器会加攻击，戒指也加攻击、衣服加生命', () => {
  const s = createState(balance, 0)
  s.equipped.weapon = mk('weapon', 13)
  assert.equal(heroStats(s, balance).atk, 23)
  s.equipped.ring = mk('ring', 8)
  assert.equal(heroStats(s, balance).atk, 31)
  s.equipped.armor = mk('armor', 50)
  assert.equal(heroStats(s, balance).maxHp, 170)
})

test('stats: 百分比词缀按乘法生效（乘在 基础 + 装备主属性 的总和上，所有部位的词缀相加）', () => {
  const s = createState(balance, 0)
  s.equipped.weapon = mk('weapon', 10, [{ id: 'atkPct', value: 0.1 }])
  s.equipped.amulet = mk('amulet', 30, [{ id: 'atkPct', value: 0.05 }, { id: 'hpPct', value: 0.2 }, { id: 'atkSpeedPct', value: 0.1 }])
  const st = heroStats(s, balance)
  assert.ok(Math.abs(st.atk - (10 + 10) * 1.15) < 1e-9)
  assert.ok(Math.abs(st.maxHp - (120 + 30) * 1.2) < 1e-9)
  assert.ok(Math.abs(st.atkSpeed - 1.1) < 1e-9)
})

test('stats: 暴击率、暴击伤害直接相加；冷却缩减不超过 cdrCap', () => {
  const s = createState(balance, 0)
  s.equipped.weapon = mk('weapon', 0, [{ id: 'critRate', value: 0.1 }, { id: 'critDmg', value: 0.2 }, { id: 'cdr', value: 0.25 }])
  s.equipped.ring = mk('ring', 0, [{ id: 'cdr', value: 0.25 }])
  const st = heroStats(s, balance)
  assert.ok(Math.abs(st.critRate - 0.15) < 1e-9)
  assert.ok(Math.abs(st.critDmg - 1.7) < 1e-9)
  assert.equal(st.cdr, balance.affixes.cdrCap) // 0.5 被封到 0.4
})

test('stats: 强化按等级放大该部位主属性，强化等级跟着部位走', () => {
  const s = createState(balance, 0)
  s.equipped.weapon = mk('weapon', 10)
  s.enhance.weapon = 5 // × (1 + 0.08 × 5) = × 1.4
  assert.ok(Math.abs(heroStats(s, balance).atk - (10 + 14)) < 1e-9)
  s.equipped.weapon = mk('weapon', 20) // 换一把，强化等级还在
  assert.ok(Math.abs(heroStats(s, balance).atk - (10 + 28)) < 1e-9)
})

test('stats: 攻击增加时战力也增加；powerWithItem 不改 state', () => {
  const s = createState(balance, 0)
  const before = powerOf(s, balance)
  const weapon = mk('weapon', 13)
  const after = powerWithItem(s, balance, weapon)
  assert.ok(after > before)
  assert.equal(s.equipped.weapon, null)
  s.equipped.weapon = weapon
  assert.equal(powerOf(s, balance), after)
})
