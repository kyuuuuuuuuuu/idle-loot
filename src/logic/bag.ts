import { salvage } from './progress.ts'
import { powerOf, powerWithItem } from './stats.ts'
import type { Balance, GameState, Item } from './types.ts'

export interface BagRow {
  item: Item
  /** 换上后战力严格变高 */
  upgrade: boolean
  /** 换上后战力变化比例：powerWithItem / powerOf − 1，0.12 = +12% */
  delta: number
}

/**
 * 背包列表的顺序：能让战力变高的排最前，涨得多的在前；其余按品质从高到低，再按物品等级从高到低，再按新旧（id 大的新，在前）。
 * 不改 state，item 就是背包里的那个对象。
 */
export function bagView(state: GameState, balance: Balance): BagRow[] {
  const current = powerOf(state, balance)
  const rows = state.bag.map((item): BagRow => {
    const next = powerWithItem(state, balance, item)
    return { item, upgrade: next > current, delta: current > 0 ? next / current - 1 : 0 }
  })
  return rows.sort((a, b) => {
    if (a.upgrade !== b.upgrade) return a.upgrade ? -1 : 1
    if (a.upgrade) return b.delta - a.delta || b.item.id - a.item.id
    return b.item.rarity - a.item.rarity || b.item.level - a.item.level || b.item.id - a.item.id
  })
}

/** 分解背包里所有"换上后战力不会变高"的装备；返回分解了几件、一共得到多少金币 */
export function salvageWorse(state: GameState, balance: Balance): { count: number; gold: number } {
  const goldBefore = state.gold
  let count = 0
  for (const row of bagView(state, balance)) {
    if (!row.upgrade && salvage(state, balance, row.item.id)) count++
  }
  return { count, gold: state.gold - goldBefore }
}
