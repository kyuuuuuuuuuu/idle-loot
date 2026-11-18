import type { Rng } from './rng.ts'
import { AFFIX_IDS, mainKind, SLOTS } from './types.ts'
import type { Affix, AffixId, Balance, Item, Rarity, Slot } from './types.ts'

/** 按权重抽品质档位 */
export function rollRarity(rng: Rng, weights: readonly number[]): Rarity {
  let r = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i as Rarity
  }
  return (weights.length - 1) as Rarity
}

/** 主属性 = (基础 + 每级增量 × (等级−1)) × 品质倍率 × 部位系数，取整 */
export function mainStat(balance: Balance, slot: Slot, level: number, rarity: Rarity): number {
  const it = balance.items
  const base =
    mainKind(slot) === 'atk'
      ? it.atkMainBase + it.atkMainPerLevel * (level - 1)
      : it.hpMainBase + it.hpMainPerLevel * (level - 1)
  const factor = slot === 'ring' ? it.ringMainFactor : slot === 'amulet' ? it.amuletMainFactor : 1
  return Math.round(base * it.rarityMult[rarity] * factor)
}

/** 从词缀池不重复地抽，条数由品质决定；每条在 [最小, 最大] 内均匀随机，再乘品质倍率，保留 3 位小数 */
export function rollAffixes(balance: Balance, rng: Rng, rarity: Rarity): Affix[] {
  const pool: AffixId[] = [...AFFIX_IDS]
  const out: Affix[] = []
  for (let i = 0; i < balance.items.rarityAffixCount[rarity]; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0]
    const [min, max] = balance.affixes[id]
    const value = (min + rng.next() * (max - min)) * balance.items.rarityMult[rarity]
    out.push({ id, value: Math.round(value * 1000) / 1000 })
  }
  return out
}

export interface RollItemOptions {
  id: number
  /** 物品等级（= 掉落时的关卡数） */
  level: number
  rarity: Rarity
  /** 不给就随机一个部位 */
  slot?: Slot
}

export function rollItem(balance: Balance, rng: Rng, o: RollItemOptions): Item {
  const slot = o.slot ?? rng.pick(SLOTS)
  return {
    id: o.id,
    slot,
    rarity: o.rarity,
    level: o.level,
    main: mainStat(balance, slot, o.level, o.rarity),
    affixes: rollAffixes(balance, rng, o.rarity),
  }
}

/** 分解得金币 = salvageBase[品质] × (1 + salvagePerLevel × 物品等级)，取整 */
export function salvageValue(balance: Balance, item: Pick<Item, 'rarity' | 'level'>): number {
  return Math.round(balance.items.salvageBase[item.rarity] * (1 + balance.items.salvagePerLevel * item.level))
}
