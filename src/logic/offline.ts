import { rollItem, rollRarity } from './loot.ts'
import { gainExp, receiveItem } from './progress.ts'
import type { Rng } from './rng.ts'
import { killReward } from './stage.ts'
import type { Balance, GameState, Item } from './types.ts'

export interface OfflineResult {
  /** 实际计入的离线秒数（封顶后）；不到 minSeconds 就是 0 */
  seconds: number
  gold: number
  exp: number
  items: Item[]
}

interface PerMinute {
  gold: number
  exp: number
  kills: number
}

/**
 * 在线时的每分钟速率 = 记录窗口里的总和 ÷ 窗口覆盖的分钟数。
 * 覆盖不到 1 分钟时数据太抖，当作"还没有记录"，按 defaultKillsPerMin × 当前关卡小怪奖励估算。
 */
function ratePerMinute(state: GameState, balance: Balance): PerMinute {
  const { curMs, buckets } = state.rate
  const minutes = buckets.length - 1 + curMs / 60_000
  if (minutes >= 1) {
    const sum = { gold: 0, exp: 0, kills: 0 }
    for (const b of buckets) {
      sum.gold += b.gold
      sum.exp += b.exp
      sum.kills += b.kills
    }
    return { gold: sum.gold / minutes, exp: sum.exp / minutes, kills: sum.kills / minutes }
  }
  const kills = balance.offline.defaultKillsPerMin
  const reward = killReward(balance, state.stage.n, false)
  return { gold: kills * reward.gold, exp: kills * reward.exp, kills }
}

/** 离线收益：时长 = 现在 − 上次存档，封顶 capHours；收益 = 分钟数 × 每分钟速率 × efficiency。不改 state */
export function computeOffline(state: GameState, balance: Balance, rng: Rng, nowMs: number): OfflineResult {
  const o = balance.offline
  const elapsed = (nowMs - state.lastSavedAt) / 1000
  if (!(elapsed >= o.minSeconds)) return { seconds: 0, gold: 0, exp: 0, items: [] }

  const seconds = Math.min(elapsed, o.capHours * 3600)
  const minutes = seconds / 60
  const rate = ratePerMinute(state, balance)

  const items: Item[] = []
  const count = Math.floor(minutes * rate.kills * balance.rewards.dropChance * o.efficiency)
  for (let i = 0; i < count; i++) {
    items.push(
      rollItem(balance, rng, {
        id: state.nextItemId + i,
        level: state.stage.n,
        rarity: rollRarity(rng, balance.items.rarityWeights),
      }),
    )
  }
  return {
    seconds,
    gold: Math.round(minutes * rate.gold * o.efficiency),
    exp: Math.round(minutes * rate.exp * o.efficiency),
    items,
  }
}

/** 把离线收益加进 state；背包放不下的装备直接分解。返回分解了几件、共得多少金币 */
export function applyOffline(
  state: GameState,
  balance: Balance,
  result: OfflineResult,
): { salvaged: number; salvageGold: number } {
  state.gold += result.gold
  gainExp(state, balance, result.exp)
  let salvaged = 0
  let salvageGold = 0
  for (const item of result.items) {
    state.nextItemId = Math.max(state.nextItemId, item.id + 1)
    const drop = receiveItem(state, balance, item)
    if (drop.salvaged) {
      salvaged++
      salvageGold += drop.gold
    }
  }
  return { salvaged, salvageGold }
}
