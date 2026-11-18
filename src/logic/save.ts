import { AFFIX_IDS, emptyCooldowns, freshStage, isSkillOrder, SLOTS } from './types.ts'
import type { Affix, AffixId, GameState, Item, Rarity, RateBucket, RateWindow, Slot } from './types.ts'

export const SAVE_KEY = 'idle-loot-save'
export const SAVE_VERSION = 2

// 存档 = state 的持久部分 JSON 化。场上怪物、冷却、波次进度不存：读档时从当前关卡第 1 波重新开始。
// 版本历史：1 = 第一版；2 = 加了刷怪状态 farming / failPower。改格式就加一版、在 deserialize 里写一段迁移。

export function serialize(state: GameState): string {
  return JSON.stringify({
    version: SAVE_VERSION,
    hero: { level: state.hero.level, exp: state.hero.exp, hp: state.hero.hp },
    gold: state.gold,
    bag: state.bag,
    nextItemId: state.nextItemId,
    equipped: state.equipped,
    enhance: state.enhance,
    skillOrder: state.skills.order,
    stage: state.stage.n,
    farming: state.stage.farming,
    failPower: state.stage.failPower,
    totalKills: state.totalKills,
    deaths: state.deaths,
    rate: state.rate,
    lastSavedAt: state.lastSavedAt,
  })
}

/** 解析失败、不认识的版本、缺字段、字段类型不对，一律返回 null（调用方开新档） */
export function deserialize(text: string): GameState | null {
  let d: unknown
  try {
    d = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(d) || (d.version !== 1 && d.version !== SAVE_VERSION)) return null
  const { hero, gold, bag, nextItemId, equipped, enhance, skillOrder, stage, totalKills, deaths, rate, lastSavedAt } = d

  // 迁移：第 1 版没有刷怪字段，当作"不在刷怪"读进来；下次存档时 serialize 自然写成第 2 版
  let farming = false
  let failPower = 0
  if (d.version === SAVE_VERSION) {
    if (typeof d.farming !== 'boolean' || !isNum(d.failPower, 0)) return null
    farming = d.farming
    failPower = d.failPower
  }

  if (!isObj(hero) || !isInt(hero.level, 1) || !isNum(hero.exp, 0) || !isNum(hero.hp, 0)) return null
  if (!isNum(gold, 0) || !isInt(nextItemId, 1) || !isInt(stage, 1)) return null
  if (!isInt(totalKills, 0) || !isInt(deaths, 0) || !isNum(lastSavedAt)) return null
  if (!Array.isArray(bag) || !Array.isArray(skillOrder) || !isSkillOrder(skillOrder)) return null

  const items = bag.map(parseItem)
  const eq = parseEquipped(equipped)
  const enh = parseEnhance(enhance)
  const rt = parseRate(rate)
  if (items.some((it) => it === null) || !eq || !enh || !rt) return null

  return {
    hero: { level: hero.level, exp: hero.exp, hp: hero.hp, atkTimerMs: 0 },
    gold,
    bag: items as Item[],
    nextItemId,
    equipped: eq,
    enhance: enh,
    skills: { order: [...skillOrder], cd: emptyCooldowns(), gcd: 0 },
    stage: { ...freshStage(stage), farming, failPower },
    monsters: [],
    nextMonsterId: 1,
    totalKills,
    deaths,
    rate: rt,
    lastSavedAt,
  }
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown, min = -Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min
const isInt = (v: unknown, min: number): v is number => isNum(v, min) && Number.isInteger(v)

function parseItem(v: unknown): Item | null {
  if (!isObj(v) || !Array.isArray(v.affixes)) return null
  const { id, slot, rarity, level, main } = v
  if (!isInt(id, 1) || !isInt(level, 1) || !isNum(main, 0)) return null
  if (!SLOTS.includes(slot as Slot) || !isInt(rarity, 0) || rarity > 3) return null
  const affixes: Affix[] = []
  for (const a of v.affixes) {
    if (!isObj(a) || !AFFIX_IDS.includes(a.id as AffixId) || !isNum(a.value)) return null
    affixes.push({ id: a.id as AffixId, value: a.value })
  }
  return { id, slot: slot as Slot, rarity: rarity as Rarity, level, main, affixes }
}

function parseEquipped(v: unknown): Record<Slot, Item | null> | null {
  if (!isObj(v)) return null
  const out: Record<Slot, Item | null> = { weapon: null, ring: null, armor: null, amulet: null }
  for (const slot of SLOTS) {
    if (v[slot] === null) continue
    const item = parseItem(v[slot])
    if (!item || item.slot !== slot) return null
    out[slot] = item
  }
  return out
}

function parseEnhance(v: unknown): Record<Slot, number> | null {
  if (!isObj(v)) return null
  const out: Record<Slot, number> = { weapon: 0, ring: 0, armor: 0, amulet: 0 }
  for (const slot of SLOTS) {
    const k = v[slot]
    if (!isInt(k, 0)) return null
    out[slot] = k
  }
  return out
}

function parseRate(v: unknown): RateWindow | null {
  if (!isObj(v) || !isNum(v.curMs, 0) || !Array.isArray(v.buckets)) return null
  if (v.buckets.length < 1 || v.buckets.length > 5) return null
  const buckets: RateBucket[] = []
  for (const b of v.buckets) {
    if (!isObj(b) || !isNum(b.gold, 0) || !isNum(b.exp, 0) || !isNum(b.kills, 0)) return null
    buckets.push({ gold: b.gold, exp: b.exp, kills: b.kills })
  }
  return { curMs: v.curMs, buckets }
}
