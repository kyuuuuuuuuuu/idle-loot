import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { rollItem } from '../src/logic/loot.ts'
import { createRng } from '../src/logic/rng.ts'
import { deserialize, SAVE_VERSION, serialize } from '../src/logic/save.ts'
import { createState } from '../src/logic/types.ts'
import type { Balance, GameState } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

/** 一个"玩了一阵"的存档：等级、金币、背包、穿戴、强化、技能顺序、速率记录都有值 */
const played = (): GameState => {
  const rng = createRng(5)
  const s = createState(balance, 1_700_000_000_000)
  s.hero = { level: 9, exp: 77, hp: 123.5, atkTimerMs: 0 }
  s.gold = 4321
  s.bag = [1, 2, 3].map((id) => rollItem(balance, rng, { id, level: 6, rarity: (id % 4) as 0 | 1 | 2 | 3 }))
  s.equipped.weapon = rollItem(balance, rng, { id: 4, level: 5, rarity: 3, slot: 'weapon' })
  s.equipped.amulet = rollItem(balance, rng, { id: 5, level: 5, rarity: 2, slot: 'amulet' })
  s.nextItemId = 6
  s.enhance = { weapon: 3, ring: 0, armor: 1, amulet: 2 }
  s.skills.order = ['whirl', 'heal', 'heavy']
  s.stage.n = 7
  s.totalKills = 321
  s.deaths = 4
  s.rate = { curMs: 12_345, buckets: [{ gold: 10, exp: 5, kills: 2 }, { gold: 100, exp: 50, kills: 20 }] }
  return s
}

test('save: 序列化后再反序列化，结果相等', () => {
  const s = played()
  assert.deepEqual(deserialize(serialize(s)), s)
  const fresh = createState(balance, 0)
  assert.deepEqual(deserialize(serialize(fresh)), fresh)
})

test('save: 场上怪物、冷却、波次进度不存，读档从当前关卡第 1 波重新开始', () => {
  const s = played()
  s.stage = { n: 7, wave: 3, spawned: 2, spawnTimerMs: 300, phase: 'fight', walkMs: 0 }
  s.monsters.push({ id: 9, hp: 5, maxHp: 10, atk: 1, x: 300, isBoss: false, atkTimerMs: 0 })
  s.skills.cd = { heavy: 1000, whirl: 2000, heal: 3000 }
  s.skills.gcd = 500
  const loaded = deserialize(serialize(s))
  assert.ok(loaded)
  assert.equal(loaded.stage.n, 7)
  assert.equal(loaded.stage.wave, 1)
  assert.equal(loaded.stage.phase, 'walk')
  assert.deepEqual(loaded.monsters, [])
  assert.deepEqual(loaded.skills.cd, { heavy: 0, whirl: 0, heal: 0 })
  assert.equal(loaded.skills.gcd, 0)
  assert.equal(loaded.gold, s.gold) // 持久部分原样还在
  assert.deepEqual(loaded.skills.order, s.skills.order)
})

test('save: 乱码、空串、不是对象的 JSON 都返回 null', () => {
  for (const text of ['', '乱码{{{', 'not json', 'null', '[]', '123', '"x"', '{']) {
    assert.equal(deserialize(text), null, JSON.stringify(text))
  }
})

test('save: version 不对（或没有）返回 null', () => {
  const data = JSON.parse(serialize(played()))
  assert.equal(data.version, SAVE_VERSION)
  assert.equal(deserialize(JSON.stringify({ ...data, version: 2 })), null)
  assert.equal(deserialize(JSON.stringify({ ...data, version: '1' })), null)
  const { version: _drop, ...noVersion } = data
  assert.equal(deserialize(JSON.stringify(noVersion)), null)
})

test('save: 缺字段、字段类型不对、装备数据坏了，都返回 null', () => {
  const good = JSON.parse(serialize(played()))
  const broken = (edit: (d: Record<string, any>) => void): string => {
    const d = structuredClone(good)
    edit(d)
    return JSON.stringify(d)
  }
  const cases: Record<string, string> = {
    '缺金币': broken((d) => delete d.gold),
    '金币是字符串': broken((d) => (d.gold = '100')),
    '等级为 0': broken((d) => (d.hero.level = 0)),
    '背包不是数组': broken((d) => (d.bag = 5)),
    '装备部位不存在': broken((d) => (d.bag[0].slot = 'boots')),
    '装备品质越界': broken((d) => (d.bag[0].rarity = 4)),
    '词缀不认识': broken((d) => (d.bag[0].affixes = [{ id: 'luck', value: 1 }])),
    '部位和装备对不上': broken((d) => (d.equipped.ring = d.equipped.weapon)),
    '缺强化等级': broken((d) => delete d.enhance.ring),
    '技能顺序重复': broken((d) => (d.skillOrder = ['heavy', 'heavy', 'heal'])),
    '速率记录为空': broken((d) => (d.rate.buckets = [])),
    '关卡号为小数': broken((d) => (d.stage = 2.5)),
  }
  for (const [name, text] of Object.entries(cases)) assert.equal(deserialize(text), null, name)
})
