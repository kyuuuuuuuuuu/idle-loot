// 数值模拟器：不开画面，从新存档开始按 50ms 一步快进，看推关节奏。
// node scripts/sim.ts --minutes 40 --seed 1      （等同于 npm run sim -- --minutes 40 --seed 1）
//
// 模拟的"玩家"：
//  - 每掉一件装备：换上后战力更高就换上（被换下的立刻分解），否则直接分解。所以背包永远是空的，不会漏掉任何一次掉落。
//  - 每 5 秒看一次：金币够就强化"当前强化等级最低"的部位（并列取排在前面的）。
//  - 不会点「挑战首领」：阵亡后进入刷怪，只靠战力涨够了的自动挑战去打首领。
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { step } from '../src/logic/battle.ts'
import { enhance, equip, salvage } from '../src/logic/progress.ts'
import { createRng } from '../src/logic/rng.ts'
import { powerOf, powerWithItem } from '../src/logic/stats.ts'
import { createState, SLOTS } from '../src/logic/types.ts'
import type { Balance, Item, Slot } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

const { values } = parseArgs({ options: { minutes: { type: 'string', default: '40' }, seed: { type: 'string', default: '1' } } })
const minutes = Number(values.minutes)
const seed = Number(values.seed)
if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(seed)) {
  console.error('用法: node scripts/sim.ts --minutes 40 --seed 1')
  process.exit(2)
}

const STEP_MS = 50
const CHECK_MS = 5000
const state = createState(balance, 0)
const rng = createRng(seed)

let stage11At: number | null = null // 首次进入第 11 关（= 打过第 10 关）的时刻，毫秒
let bigUpgrades = 0 // 打过第 10 关之前，战力涨幅 ≥ sim.bigUpgradePct 的换装次数
let farmSteps = 0 // 处在刷怪状态的步数
let autoChallenges = 0 // 收到 bossChallenge 事件的次数

const min1 = (ms: number): string => (ms / 60000).toFixed(1)

function consider(item: Item, atMs: number): void {
  const before = powerOf(state, balance)
  const after = powerWithItem(state, balance, item)
  if (after <= before) {
    salvage(state, balance, item.id)
    return
  }
  const old = state.equipped[item.slot]
  equip(state, item.id)
  if (old) salvage(state, balance, old.id)
  const gain = after / before - 1
  if (stage11At === null && gain >= balance.sim.bigUpgradePct) bigUpgrades++
  console.log(
    `equip min=${min1(atMs)} slot=${item.slot} rarity=${balance.items.rarityNames[item.rarity]} power ${before} -> ${after} (+${(gain * 100).toFixed(1)}%)`,
  )
}

function autoEnhance(): void {
  let lowest: Slot = SLOTS[0]
  for (const slot of SLOTS) if (state.enhance[slot] < state.enhance[lowest]) lowest = slot
  enhance(state, balance, lowest)
}

const totalSteps = Math.round((minutes * 60000) / STEP_MS)
for (let i = 1; i <= totalSteps; i++) {
  const t = i * STEP_MS
  for (const e of step(state, balance, rng, STEP_MS)) {
    if (e.type === 'bossChallenge') autoChallenges++
    if (e.type !== 'loot') continue
    for (const drop of e.drops) if (!drop.salvaged) consider(drop.item, t)
  }
  if (state.stage.farming) farmSteps++
  if (t % CHECK_MS === 0) autoEnhance()
  if (stage11At === null && state.stage.n >= 11) stage11At = t
  if (t % 60000 === 0) {
    console.log(
      `min=${t / 60000} stage=${state.stage.n} wave=${state.stage.wave} level=${state.hero.level} gold=${Math.floor(state.gold)} power=${powerOf(state, balance)} farming=${state.stage.farming ? 1 : 0}`,
    )
  }
}

console.log(
  `stage10_at_min=${stage11At === null ? 'never' : min1(stage11At)} big_upgrades_before_stage10=${bigUpgrades} deaths=${state.deaths} farm_min=${min1(farmSteps * STEP_MS)} auto_challenges=${autoChallenges}`,
)
