import { mainKind, SLOTS } from './types.ts'
import type { Balance, Item, Slot } from './types.ts'

export interface HeroStats {
  atk: number
  maxHp: number
  critRate: number
  critDmg: number
  /** 每秒普攻次数 */
  atkSpeed: number
  /** 已封顶的冷却缩减 */
  cdr: number
}

/** 算属性只需要这三样；GameState 可以直接传进来，"换上某件会怎样"也只改 equipped 就行 */
export interface StatsInput {
  hero: { level: number }
  equipped: Record<Slot, Item | null>
  enhance: Record<Slot, number>
}

export function heroStats(s: StatsInput, balance: Balance): HeroStats {
  const h = balance.hero
  let atk = h.atkBase + h.atkPerLevel * (s.hero.level - 1)
  let hp = h.hpBase + h.hpPerLevel * (s.hero.level - 1)
  let atkPct = 0
  let hpPct = 0
  let atkSpeedPct = 0
  let critRate = h.critRate
  let critDmg = h.critDmg
  let cdr = 0

  for (const slot of SLOTS) {
    const item = s.equipped[slot]
    if (!item) continue
    const main = item.main * (1 + balance.enhance.perLevel * s.enhance[slot])
    if (mainKind(slot) === 'atk') atk += main
    else hp += main
    for (const a of item.affixes) {
      switch (a.id) {
        case 'atkPct': atkPct += a.value; break
        case 'hpPct': hpPct += a.value; break
        case 'critRate': critRate += a.value; break
        case 'critDmg': critDmg += a.value; break
        case 'atkSpeedPct': atkSpeedPct += a.value; break
        case 'cdr': cdr += a.value; break
      }
    }
  }

  return {
    atk: atk * (1 + atkPct),
    maxHp: hp * (1 + hpPct),
    critRate,
    critDmg,
    atkSpeed: h.atkSpeed * (1 + atkSpeedPct),
    cdr: Math.min(cdr, balance.affixes.cdrCap),
  }
}

/** 战力 = round(输出 × √最大生命)，输出 = 攻击 × (1 + min(暴击率,1) × (暴击伤害 − 1)) × 攻速 × (1 + 冷却缩减) */
export function power(st: HeroStats): number {
  const output = st.atk * (1 + Math.min(st.critRate, 1) * (st.critDmg - 1)) * st.atkSpeed * (1 + st.cdr)
  return Math.round(output * Math.sqrt(st.maxHp))
}

export function powerOf(s: StatsInput, balance: Balance): number {
  return power(heroStats(s, balance))
}

/** 把 item 换上之后的战力（背包里标 ↑ / ↓、模拟器自动换装都用它） */
export function powerWithItem(s: StatsInput, balance: Balance, item: Item): number {
  return powerOf({ hero: s.hero, enhance: s.enhance, equipped: { ...s.equipped, [item.slot]: item } }, balance)
}
