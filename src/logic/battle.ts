import { rollItem, rollRarity } from './loot.ts'
import { gainExp, receiveItem } from './progress.ts'
import type { Rng } from './rng.ts'
import { isBossWave, killReward, monsterAtk, monsterHp, waveSize } from './stage.ts'
import { heroStats, power } from './stats.ts'
import type { HeroStats } from './stats.ts'
import { SKILL_IDS } from './types.ts'
import type { Balance, BattleEvent, Drop, GameState, Monster } from './types.ts'

// 一步 = 一小段游戏时间。调用方按固定 50ms 切片来调（dtMs 别超过 ~100，一步里每个计时器最多触发一次）。
// 顺序：计时器走 → 行走/开波 → 刷怪、怪走位和攻击 → 英雄放技能、普攻 → 结算死亡和掉落 → 判清波。
// 画面只读 state 和返回的事件，不自己算伤害。

const EPS = 1e-6
const MINUTE_MS = 60_000
const RATE_BUCKETS = 5

export function step(state: GameState, balance: Balance, rng: Rng, dtMs: number): BattleEvent[] {
  const events: BattleEvent[] = []
  const stage = state.stage
  const stats = heroStats(state, balance)
  if (state.hero.hp > stats.maxHp) state.hero.hp = stats.maxHp

  tickTimers(state, dtMs)

  if (stage.phase === 'walk') {
    stage.walkMs -= dtMs
    if (stage.walkMs <= 0) {
      stage.phase = 'fight'
      stage.walkMs = 0
      stage.spawned = 0
      stage.spawnTimerMs = 0
      events.push({ type: 'waveStart', stage: stage.n, wave: stage.wave, isBoss: isBossWave(balance, stage.wave) })
    }
  }

  if (stage.phase === 'fight') {
    spawnMonsters(state, balance, dtMs)
    monstersAct(state, balance, dtMs, events)
    if (state.hero.hp <= 0) {
      heroDies(state, balance, stats, events)
      return events
    }
  }

  heroActs(state, balance, rng, stats, events)
  resolveKills(state, balance, rng, events)
  checkWaveClear(state, balance, events)
  return events
}

function tickTimers(state: GameState, dtMs: number): void {
  const sk = state.skills
  for (const id of SKILL_IDS) sk.cd[id] = Math.max(0, sk.cd[id] - dtMs)
  sk.gcd = Math.max(0, sk.gcd - dtMs)
  state.hero.atkTimerMs += dtMs

  const r = state.rate
  r.curMs += dtMs
  while (r.curMs >= MINUTE_MS) {
    r.curMs -= MINUTE_MS
    r.buckets.unshift({ gold: 0, exp: 0, kills: 0 })
    if (r.buckets.length > RATE_BUCKETS) r.buckets.pop()
  }
}

function spawnMonsters(state: GameState, balance: Balance, dtMs: number): void {
  const st = state.stage
  const size = waveSize(balance, st.n, st.wave)
  const boss = isBossWave(balance, st.wave)
  // 先判断后扣时间：第一只在开波那一步就出现，之后严格每 spawnIntervalMs 一只
  while (st.spawned < size && st.spawnTimerMs <= 0) {
    const hp = monsterHp(balance, st.n, boss)
    state.monsters.push({
      id: state.nextMonsterId++,
      hp,
      maxHp: hp,
      atk: monsterAtk(balance, st.n, boss),
      x: balance.monster.spawnX,
      isBoss: boss,
      atkTimerMs: 0,
    })
    st.spawned++
    st.spawnTimerMs += balance.stage.spawnIntervalMs
  }
  st.spawnTimerMs -= dtMs
}

/** 怪往左走，到英雄射程边缘停下；上一步已经到位的才计攻击时间，所以到位后要等一个完整间隔才挨第一下 */
function monstersAct(state: GameState, balance: Balance, dtMs: number, events: BattleEvent[]): void {
  const stopX = balance.hero.x + balance.hero.range
  const interval = 1000 / balance.monster.atkSpeed
  const walk = (balance.monster.moveSpeed * dtMs) / 1000
  for (const m of state.monsters) {
    const arrived = m.x <= stopX + EPS
    m.x = Math.max(stopX, m.x - walk)
    if (!arrived) continue
    m.atkTimerMs += dtMs
    if (m.atkTimerMs >= interval) {
      m.atkTimerMs -= interval
      state.hero.hp -= m.atk
      events.push({ type: 'damage', target: 'hero', value: m.atk, crit: false, x: balance.hero.x })
    }
  }
}

/** 英雄死了：回满血，进入刷怪——记下阵亡时的战力，本关从第 1 波重来，走一段路再开波 */
function heroDies(state: GameState, balance: Balance, stats: HeroStats, events: BattleEvent[]): void {
  events.push({ type: 'heroDeath', stage: state.stage.n })
  state.deaths++
  state.monsters = []
  state.hero.hp = stats.maxHp
  state.hero.atkTimerMs = 0
  const st = state.stage
  st.wave = 1
  st.spawned = 0
  st.spawnTimerMs = 0
  st.phase = 'walk'
  st.walkMs = balance.stage.walkMs
  // 挑战首领时又死了、或刷怪时死在小怪手里，都按这一次的战力重新记
  st.farming = true
  st.failPower = power(stats)
}

/** 自动挑战的战力门槛 = 阵亡时战力 × (1 + autoChallengePct)，向上取整。战力是整数，所以"战力 ≥ 门槛"和"战力 ≥ 未取整的值"等价；界面上显示的也是它 */
export function autoChallengeTarget(state: GameState, balance: Balance): number {
  return Math.ceil(state.stage.failPower * (1 + balance.boss.autoChallengePct))
}

/** 挑战首领：清场、回满血、走一段路后开首领波，退出刷怪。玩家点按钮和自动挑战共用它；不在刷怪时什么都不改，返回 false */
export function challengeBoss(state: GameState, balance: Balance): boolean {
  const st = state.stage
  if (!st.farming) return false
  st.farming = false
  st.failPower = 0
  state.monsters = []
  state.hero.hp = heroStats(state, balance).maxHp
  state.hero.atkTimerMs = 0
  st.wave = balance.stage.wavesPerStage + 1
  st.spawned = 0
  st.spawnTimerMs = 0
  st.phase = 'walk'
  st.walkMs = balance.stage.walkMs
  return true
}

/** 射程内最前面（x 最小）的活怪；x 相同取先刷出的 */
function frontTarget(state: GameState, balance: Balance): Monster | null {
  let best: Monster | null = null
  for (const m of state.monsters) {
    if (m.hp > 0 && (best === null || m.x < best.x)) best = m
  }
  return best !== null && best.x - balance.hero.x <= balance.hero.range + EPS ? best : null
}

function healHero(state: GameState, stats: HeroStats, amount: number, events: BattleEvent[]): void {
  const before = state.hero.hp
  state.hero.hp = Math.min(stats.maxHp, before + amount)
  if (state.hero.hp > before) events.push({ type: 'heal', value: state.hero.hp - before })
}

function heroActs(state: GameState, balance: Balance, rng: Rng, stats: HeroStats, events: BattleEvent[]): void {
  const hero = state.hero
  const sk = state.skills

  const hit = (m: Monster, mult: number): void => {
    const crit = rng.next() < stats.critRate
    const value = stats.atk * mult * (crit ? stats.critDmg : 1)
    m.hp -= value
    events.push({ type: 'damage', target: m.id, value, crit, x: m.x })
  }

  // 技能：公共冷却过了，就放顺序里第一个"冷却好了、而且放了有用"的
  if (sk.gcd <= 0) {
    const target = frontTarget(state, balance)
    for (const id of sk.order) {
      if (sk.cd[id] > 0) continue
      if (id === 'heal') {
        // 已损失的生命 ≥ 回复量的一半才值得放
        if (stats.maxHp - hero.hp < (balance.skills.heal.pct * stats.maxHp) / 2) continue
      } else if (target === null) {
        continue
      }
      sk.cd[id] = balance.skills[id].cdMs * (1 - stats.cdr)
      sk.gcd = balance.skills.gcdMs
      events.push({ type: 'skill', skill: id })
      if (id === 'heavy' && target) {
        hit(target, balance.skills.heavy.mult)
      } else if (id === 'whirl') {
        for (const m of state.monsters) {
          if (m.hp > 0 && m.x - balance.hero.x <= balance.skills.whirl.radius + EPS) hit(m, balance.skills.whirl.mult)
        }
      } else if (id === 'heal') {
        healHero(state, stats, balance.skills.heal.pct * stats.maxHp, events)
      }
      break
    }
  }

  // 普攻单独计时，不受公共冷却影响；没目标时计时停在满格，目标一进射程立刻能打，但不会攒出连击
  const interval = 1000 / stats.atkSpeed
  if (hero.atkTimerMs >= interval) {
    const target = frontTarget(state, balance)
    if (target) {
      hit(target, 1)
      hero.atkTimerMs = Math.min(hero.atkTimerMs - interval, interval)
    } else {
      hero.atkTimerMs = interval
    }
  }
}

/** 死掉的怪：发金币经验、掷掉落、记入离线速率；一次击杀一个 kill + 一个 loot，升级另发 levelUp */
function resolveKills(state: GameState, balance: Balance, rng: Rng, events: BattleEvent[]): void {
  if (!state.monsters.some((m) => m.hp <= 0)) return
  const dead = state.monsters.filter((m) => m.hp <= 0)
  state.monsters = state.monsters.filter((m) => m.hp > 0)

  for (const m of dead) {
    const n = state.stage.n
    const reward = killReward(balance, n, m.isBoss)
    state.totalKills++
    state.gold += reward.gold
    const levelBefore = state.hero.level
    gainExp(state, balance, reward.exp)

    const count = m.isBoss ? balance.boss.drops : rng.next() < balance.rewards.dropChance ? 1 : 0
    const weights = m.isBoss ? balance.items.bossRarityWeights : balance.items.rarityWeights
    const drops: Drop[] = []
    for (let i = 0; i < count; i++) {
      const item = rollItem(balance, rng, { id: state.nextItemId++, level: n, rarity: rollRarity(rng, weights) })
      drops.push(receiveItem(state, balance, item))
    }

    const bucket = state.rate.buckets[0]
    bucket.gold += reward.gold
    bucket.exp += reward.exp
    bucket.kills++

    events.push({ type: 'kill', monsterId: m.id, isBoss: m.isBoss, x: m.x })
    events.push({ type: 'loot', gold: reward.gold, exp: reward.exp, drops, x: m.x })
    for (let l = levelBefore + 1; l <= state.hero.level; l++) events.push({ type: 'levelUp', level: l })
  }
}

/**
 * 本波刷完、场上没怪了 = 清波。
 * 首领波：过关，关卡 +1、回满血、退出刷怪。
 * 小怪波：刷怪中先看战力够不够自动挑战首领；否则回一部分血进下一波，刷怪时数到首领波就绕回第 1 波。
 */
function checkWaveClear(state: GameState, balance: Balance, events: BattleEvent[]): void {
  const st = state.stage
  if (st.phase !== 'fight' || st.spawned < waveSize(balance, st.n, st.wave) || state.monsters.length > 0) return

  // 这一步刚升过级的话最大生命变了，所以这里重新算，不用步首那份
  const stats = heroStats(state, balance)
  if (isBossWave(balance, st.wave)) {
    events.push({ type: 'stageClear', stage: st.n })
    st.n++
    st.wave = 1
    st.farming = false
    st.failPower = 0
    healHero(state, stats, stats.maxHp, events)
  } else if (st.farming && power(stats) >= autoChallengeTarget(state, balance)) {
    // challengeBoss 已经回满血、清场、进入行走，不再走下面的回血
    challengeBoss(state, balance)
    events.push({ type: 'bossChallenge' })
    return
  } else {
    st.wave++
    if (st.farming && isBossWave(balance, st.wave)) st.wave = 1
    healHero(state, stats, stats.maxHp * balance.stage.waveHealPct, events)
  }
  st.phase = 'walk'
  st.walkMs = balance.stage.walkMs
}
