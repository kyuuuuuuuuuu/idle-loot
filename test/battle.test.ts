import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { step } from '../src/logic/battle.ts'
import { salvageValue } from '../src/logic/loot.ts'
import { createRng } from '../src/logic/rng.ts'
import { killReward } from '../src/logic/stage.ts'
import { heroStats } from '../src/logic/stats.ts'
import { createState } from '../src/logic/types.ts'
import type { Balance, BattleEvent, GameState, Monster } from '../src/logic/types.ts'

const raw: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

/** 复制一份数值表再改，不污染别的测试；默认暴击率清零，伤害才可预测 */
const tweak = (edit: (b: Balance) => void = () => {}, critRate = 0): Balance => {
  const b = structuredClone(raw)
  b.hero.critRate = critRate
  edit(b)
  return b
}

const STOP_X = raw.hero.x + raw.hero.range

const dummy = (over: Partial<Monster> = {}): Monster => ({
  id: 1, hp: 1e9, maxHp: 1e9, atk: 0, x: STOP_X, isBoss: false, atkTimerMs: 0, ...over,
})

/** 已经开打、怪都刷完了（不会再刷新的），场上由测试自己放怪 */
const fight = (b: Balance): GameState => {
  const s = createState(b, 0)
  s.stage.phase = 'fight'
  s.stage.spawned = 99
  return s
}

const of = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type)

test('battle (a): 顺序 [heal, heavy, whirl]、满血、射程内有怪时，放出来的是 heavy', () => {
  const b = tweak()
  const s = fight(b)
  s.skills.order = ['heal', 'heavy', 'whirl']
  s.monsters.push(dummy())
  const events = step(s, b, createRng(1), 50)
  assert.deepEqual(of(events, 'skill'), [{ type: 'skill', skill: 'heavy' }])
  assert.equal(s.skills.cd.heavy, b.skills.heavy.cdMs)
  assert.equal(s.skills.cd.whirl, 0)
  assert.equal(s.skills.cd.heal, 0)
  assert.ok(of(events, 'damage').some((e) => e.value === 10 * b.skills.heavy.mult)) // 攻击 10 × 2.6
})

test('battle (b): 两个技能同时冷却好时，第二个要等 gcdMs 才放', () => {
  const b = tweak()
  const s = fight(b)
  s.monsters.push(dummy())
  const rng = createRng(1)
  const castAt: Record<string, number> = {}
  for (let i = 1; i <= 40; i++) {
    for (const e of of(step(s, b, rng, 50), 'skill')) castAt[e.skill] ??= i * 50
  }
  assert.equal(castAt.heavy, 50)
  assert.equal(castAt.whirl - castAt.heavy, b.skills.gcdMs)
  assert.equal(castAt.heal, undefined) // 满血，嗜血不放
})

test('battle (c): 暴击率为 1 时，普攻伤害 = 攻击 × critDmg；暴击率为 0 时永不暴击', () => {
  for (const critRate of [1, 0]) {
    const b = tweak(() => {}, critRate)
    const s = fight(b)
    s.skills.cd = { heavy: 1e9, whirl: 1e9, heal: 1e9 } // 关掉技能，只看普攻
    s.hero.atkTimerMs = 1000 // 这一步就能出手
    const m = dummy()
    s.monsters.push(m)
    const hits = of(step(s, b, createRng(1), 50), 'damage').filter((e) => e.target === m.id)
    assert.equal(hits.length, 1)
    const atk = heroStats(s, b).atk
    assert.equal(hits[0].crit, critRate === 1)
    assert.equal(hits[0].value, critRate === 1 ? atk * b.hero.critDmg : atk)
    assert.equal(m.hp, 1e9 - hits[0].value)
  }
})

test('battle (d): 英雄死后回到本关第 1 波，并且满血', () => {
  const b = tweak()
  const s = fight(b)
  s.stage.n = 3
  s.stage.wave = 3
  s.hero.hp = 1
  s.monsters.push(dummy({ atk: 9999, atkTimerMs: 1000 / b.monster.atkSpeed })) // 这一步就出手
  const events = step(s, b, createRng(1), 50)
  assert.equal(of(events, 'heroDeath').length, 1)
  assert.equal(s.stage.n, 3)
  assert.equal(s.stage.wave, 1)
  assert.equal(s.hero.hp, heroStats(s, b).maxHp)
  assert.equal(s.monsters.length, 0)
  assert.equal(s.deaths, 1)
})

test('battle (e): 打死首领后关卡 +1，并且满血', () => {
  const b = tweak()
  const s = fight(b)
  s.stage.n = 2
  s.stage.wave = b.stage.wavesPerStage + 1
  s.hero.hp = 10
  s.hero.atkTimerMs = 1000
  s.monsters.push(dummy({ hp: 1, isBoss: true }))
  const events = step(s, b, createRng(1), 50)
  assert.equal(of(events, 'stageClear').length, 1)
  assert.equal(s.stage.n, 3)
  assert.equal(s.stage.wave, 1)
  assert.equal(s.stage.phase, 'walk')
  assert.equal(s.hero.hp, heroStats(s, b).maxHp) // 首领经验多，这一步多半还升了级；满血按升级后的上限算
})

test('battle: 嗜血只在已损失生命 ≥ 回复量一半时才放', () => {
  const b = tweak()
  const maxHp = heroStats(createState(b, 0), b).maxHp
  const heal = b.skills.heal.pct * maxHp // 24
  for (const [missing, shouldCast] of [[heal / 2 - 1, false], [heal / 2, true]] as const) {
    const s = fight(b)
    s.skills.order = ['heal', 'heavy', 'whirl']
    s.hero.hp = maxHp - missing
    s.monsters.push(dummy())
    const casts = of(step(s, b, createRng(1), 50), 'skill').map((e) => e.skill)
    assert.deepEqual(casts, [shouldCast ? 'heal' : 'heavy'])
  }
})

test('battle: 攻击技能要求射程内有怪；怪还在远处时不放', () => {
  const b = tweak()
  const s = fight(b)
  s.monsters.push(dummy({ x: STOP_X + 200 }))
  assert.equal(of(step(s, b, createRng(1), 50), 'skill').length, 0)
})

test('battle: 怪走到射程边缘停下，到位后等一个完整攻击间隔才挨第一下', () => {
  const b = tweak()
  const s = fight(b)
  const m = dummy({ x: b.monster.spawnX, atk: 4 })
  s.monsters.push(m)
  const rng = createRng(1)
  let steps = 0
  while (m.x > STOP_X) {
    step(s, b, rng, 50)
    steps++
    assert.ok(steps < 1000)
  }
  assert.equal(m.x, STOP_X)
  assert.equal(steps, Math.ceil((b.monster.spawnX - STOP_X) / ((b.monster.moveSpeed * 50) / 1000)))
  const interval = 1000 / b.monster.atkSpeed // 1250ms = 25 步
  let hits = 0
  for (let i = 1; i <= 25; i++) {
    const n = of(step(s, b, rng, 50), 'damage').filter((e) => e.target === 'hero').length
    hits += n
    if (i < 25) assert.equal(hits, 0, `第 ${i} 步不该挨打（间隔 ${interval}ms）`)
  }
  assert.equal(hits, 1)
})

test('battle: 一波开始时发 waveStart 并刷出第一只怪，之后严格按 spawnIntervalMs 刷', () => {
  const b = tweak()
  const s = createState(b, 0) // 新档：walk 阶段、walkMs 为 0，第一步就开波
  const rng = createRng(1)
  const first = step(s, b, rng, 50)
  assert.deepEqual(of(first, 'waveStart'), [{ type: 'waveStart', stage: 1, wave: 1, isBoss: false }])
  assert.equal(s.monsters.length, 1)
  assert.equal(s.monsters[0].x, b.monster.spawnX - (b.monster.moveSpeed * 50) / 1000)
  let stepsToSecond = 0
  while (s.monsters.length < 2) {
    step(s, b, rng, 50)
    stepsToSecond++
    assert.ok(stepsToSecond < 100)
  }
  assert.equal(stepsToSecond * 50, b.stage.spawnIntervalMs)
})

test('battle: 小怪死亡发金币、经验，并按 dropChance 掉装备', () => {
  for (const [dropChance, bagSize] of [[1, 1], [0, 0]] as const) {
    const b = tweak((x) => { x.rewards.dropChance = dropChance })
    const s = fight(b)
    s.stage.n = 3
    s.hero.atkTimerMs = 1000
    s.monsters.push(dummy({ hp: 1 }))
    const events = step(s, b, createRng(1), 50)
    const reward = killReward(b, 3, false)
    const loot = of(events, 'loot')
    assert.equal(loot.length, 1)
    assert.equal(loot[0].gold, reward.gold)
    assert.equal(loot[0].exp, reward.exp)
    assert.equal(loot[0].drops.length, bagSize)
    assert.equal(s.gold, reward.gold)
    assert.equal(s.hero.exp, reward.exp)
    assert.equal(s.totalKills, 1)
    assert.equal(s.bag.length, bagSize)
    if (bagSize) assert.equal(s.bag[0].level, 3) // 物品等级 = 掉落时的关卡数
  }
})

test('battle: 首领必掉 boss.drops 件装备，奖励乘 rewardMult', () => {
  const b = tweak()
  const s = fight(b)
  s.stage.wave = b.stage.wavesPerStage + 1
  s.hero.atkTimerMs = 1000
  s.monsters.push(dummy({ hp: 1, isBoss: true }))
  const loot = of(step(s, b, createRng(1), 50), 'loot')[0]
  assert.equal(loot.drops.length, b.boss.drops)
  assert.equal(loot.gold, killReward(b, 1, true).gold)
  assert.equal(s.bag.length, b.boss.drops)
})

test('battle: 背包满了，新掉的装备直接分解成金币', () => {
  const b = tweak((x) => { x.rewards.dropChance = 1; x.items.bagCapacity = 0 })
  const s = fight(b)
  s.hero.atkTimerMs = 1000
  s.monsters.push(dummy({ hp: 1 }))
  const loot = of(step(s, b, createRng(1), 50), 'loot')[0]
  const drop = loot.drops[0]
  assert.equal(drop.salvaged, true)
  assert.equal(drop.gold, salvageValue(b, drop.item))
  assert.equal(s.bag.length, 0)
  assert.equal(s.gold, loot.gold + drop.gold)
})

test('battle: 一波清完，回复 waveHealPct × 最大生命，波次 +1，进入行走', () => {
  const b = tweak()
  const s = fight(b)
  s.hero.hp = 50
  s.hero.atkTimerMs = 1000
  s.monsters.push(dummy({ hp: 1 }))
  step(s, b, createRng(1), 50)
  assert.equal(s.stage.wave, 2)
  assert.equal(s.stage.phase, 'walk')
  assert.equal(s.stage.walkMs, b.stage.walkMs)
  assert.ok(Math.abs(s.hero.hp - (50 + 0.3 * 120)) < 1e-9)
})

test('battle: 同种子同结果（逻辑只靠 state、balance、rng 和 dtMs）', () => {
  const run = (): string => {
    const b = tweak(() => {}, raw.hero.critRate)
    const s = createState(b, 0)
    const rng = createRng(99)
    for (let i = 0; i < 2400; i++) step(s, b, rng, 50) // 2 分钟
    return JSON.stringify(s)
  }
  assert.equal(run(), run())
})
