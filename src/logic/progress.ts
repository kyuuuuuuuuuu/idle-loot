import { salvageValue } from './loot.ts'
import { isSkillOrder } from './types.ts'
import type { Balance, Drop, GameState, Item, SkillId, Slot } from './types.ts'

/** 从 level 级升到 level+1 级要多少经验（取整；至少 1，免得表里填 0 让升级循环停不下来） */
export function expToNext(balance: Balance, level: number): number {
  return Math.max(1, Math.round(balance.level.expBase * balance.level.expGrowth ** (level - 1)))
}

/** 加经验，够了就连着升级；返回这次升了几级 */
export function gainExp(state: GameState, balance: Balance, exp: number): number {
  const hero = state.hero
  const from = hero.level
  hero.exp += exp
  for (let need = expToNext(balance, hero.level); hero.exp >= need; need = expToNext(balance, hero.level)) {
    hero.exp -= need
    hero.level++
  }
  return hero.level - from
}

/** 换上背包里的装备，被换下的回背包同一个格子；找不到这件就什么都不做 */
export function equip(state: GameState, itemId: number): boolean {
  const i = state.bag.findIndex((it) => it.id === itemId)
  if (i < 0) return false
  const item = state.bag[i]
  const old = state.equipped[item.slot]
  state.equipped[item.slot] = item
  if (old) state.bag[i] = old
  else state.bag.splice(i, 1)
  return true
}

/** 分解背包里的装备换金币；找不到这件就什么都不做 */
export function salvage(state: GameState, balance: Balance, itemId: number): boolean {
  const i = state.bag.findIndex((it) => it.id === itemId)
  if (i < 0) return false
  state.gold += salvageValue(balance, state.bag[i])
  state.bag.splice(i, 1)
  return true
}

/** 从 k 级强化到 k+1 级花的金币（取整） */
export function enhanceCost(balance: Balance, k: number): number {
  return Math.round(balance.enhance.costBase * balance.enhance.costGrowth ** k)
}

/** 强化一个部位；金币不够时什么都不做，返回 false */
export function enhance(state: GameState, balance: Balance, slot: Slot): boolean {
  const cost = enhanceCost(balance, state.enhance[slot])
  if (state.gold < cost) return false
  state.gold -= cost
  state.enhance[slot]++
  return true
}

/** order 必须正好是三个技能各一次，否则什么都不做，返回 false */
export function setSkillOrder(state: GameState, order: readonly SkillId[]): boolean {
  if (!isSkillOrder(order)) return false
  state.skills.order = [...order]
  return true
}

/** 收下一件新装备：背包有空位就放进去，满了直接分解成金币 */
export function receiveItem(state: GameState, balance: Balance, item: Item): Drop {
  if (state.bag.length < balance.items.bagCapacity) {
    state.bag.push(item)
    return { item, salvaged: false, gold: 0 }
  }
  const gold = salvageValue(balance, item)
  state.gold += gold
  return { item, salvaged: true, gold }
}
