// 数据模型：logic 里所有文件共用的类型、固定列表和初始状态。
// 数值一律通过参数 balance 传进来，logic 不 import JSON。

export type Balance = typeof import('../data/balance.json')

export const SLOTS = ['weapon', 'ring', 'armor', 'amulet'] as const
export type Slot = (typeof SLOTS)[number]

// 词缀池固定这六个；balance.affixes 里还有 _说明 和 cdrCap，不能遍历它。
export const AFFIX_IDS = ['atkPct', 'hpPct', 'critRate', 'critDmg', 'atkSpeedPct', 'cdr'] as const
export type AffixId = (typeof AFFIX_IDS)[number]

export const SKILL_IDS = ['heavy', 'whirl', 'heal'] as const
export type SkillId = (typeof SKILL_IDS)[number]

/** 品质档位，下标同 balance.items.rarityNames：0 普通 1 精良 2 史诗 3 传说 */
export type Rarity = 0 | 1 | 2 | 3

/** 武器、戒指的主属性是攻击；衣服、项链的主属性是生命 */
export function mainKind(slot: Slot): 'atk' | 'hp' {
  return slot === 'weapon' || slot === 'ring' ? 'atk' : 'hp'
}

export interface Affix {
  id: AffixId
  value: number
}

export interface Item {
  id: number
  slot: Slot
  rarity: Rarity
  /** 物品等级 = 掉落时的关卡数 */
  level: number
  /** 主属性，已含品质倍率和部位系数，取整；强化倍率在算属性时再乘 */
  main: number
  affixes: Affix[]
}

export interface Monster {
  id: number
  hp: number
  maxHp: number
  atk: number
  /** 横坐标，像素，和画面坐标一致 */
  x: number
  isBoss: boolean
  /** 到位后累计的攻击计时，毫秒 */
  atkTimerMs: number
}

export interface StageState {
  /** 关卡号，从 1 开始 */
  n: number
  /** 正在打（或走完路后要打）的波次；wavesPerStage + 1 是首领波 */
  wave: number
  /** 本波已经刷出几只 */
  spawned: number
  /** 距离下一只出现还有多久，毫秒 */
  spawnTimerMs: number
  /** walk：行走中（清完一波、过关、阵亡、刚读档）；fight：刷怪和战斗 */
  phase: 'walk' | 'fight'
  walkMs: number
}

export interface RateBucket {
  gold: number
  exp: number
  kills: number
}

/** 最近 5 分钟的收益记录。buckets[0] 是正在进行的这一分钟，curMs 是它已经过了多久（游戏时间，不是时钟） */
export interface RateWindow {
  curMs: number
  buckets: RateBucket[]
}

export interface GameState {
  hero: { level: number; exp: number; hp: number; atkTimerMs: number }
  gold: number
  bag: Item[]
  nextItemId: number
  equipped: Record<Slot, Item | null>
  /** 强化等级跟着部位走，换装备不丢 */
  enhance: Record<Slot, number>
  skills: {
    order: SkillId[]
    /** 各技能冷却剩余，毫秒 */
    cd: Record<SkillId, number>
    /** 公共冷却剩余，毫秒 */
    gcd: number
  }
  stage: StageState
  monsters: Monster[]
  nextMonsterId: number
  totalKills: number
  deaths: number
  rate: RateWindow
  lastSavedAt: number
}

export interface Drop {
  item: Item
  /** 背包满了，直接分解成了金币 */
  salvaged: boolean
  /** 分解得到的金币；没分解就是 0 */
  gold: number
}

export type BattleEvent =
  | { type: 'damage'; target: 'hero' | number; value: number; crit: boolean; x: number }
  | { type: 'heal'; value: number }
  | { type: 'skill'; skill: SkillId }
  | { type: 'kill'; monsterId: number; isBoss: boolean; x: number }
  // 一次击杀一个 loot：gold / exp 是击杀奖励（不含分解所得），drops 是掉落（首领会有多件）
  | { type: 'loot'; gold: number; exp: number; drops: Drop[]; x: number }
  | { type: 'levelUp'; level: number }
  | { type: 'waveStart'; stage: number; wave: number; isBoss: boolean }
  | { type: 'stageClear'; stage: number }
  | { type: 'heroDeath'; stage: number }

export function isSkillOrder(order: readonly unknown[]): order is SkillId[] {
  return (
    order.length === SKILL_IDS.length &&
    SKILL_IDS.every((id) => order.includes(id))
  )
}

export function emptyCooldowns(): Record<SkillId, number> {
  return { heavy: 0, whirl: 0, heal: 0 }
}

export function freshStage(n: number): StageState {
  return { n, wave: 1, spawned: 0, spawnTimerMs: 0, phase: 'walk', walkMs: 0 }
}

export function emptyRate(): RateWindow {
  return { curMs: 0, buckets: [{ gold: 0, exp: 0, kills: 0 }] }
}

export function createState(balance: Balance, nowMs: number): GameState {
  const order = balance.skills.defaultOrder
  return {
    hero: { level: 1, exp: 0, hp: balance.hero.hpBase, atkTimerMs: 0 },
    gold: 0,
    bag: [],
    nextItemId: 1,
    equipped: { weapon: null, ring: null, armor: null, amulet: null },
    enhance: { weapon: 0, ring: 0, armor: 0, amulet: 0 },
    // 表里写错了就退回固定顺序，不让一次手滑把游戏弄崩
    skills: { order: isSkillOrder(order) ? [...order] : [...SKILL_IDS], cd: emptyCooldowns(), gcd: 0 },
    stage: freshStage(1),
    monsters: [],
    nextMonsterId: 1,
    totalKills: 0,
    deaths: 0,
    rate: emptyRate(),
    lastSavedAt: nowMs,
  }
}
