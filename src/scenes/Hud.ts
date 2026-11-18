import Phaser from 'phaser'
import { expToNext } from '../logic/progress.ts'
import { isBossWave } from '../logic/stage.ts'
import { mainKind } from '../logic/types.ts'
import type { AffixId, Balance, Drop, GameState, Item, Slot } from '../logic/types.ts'

export const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

// 品质颜色：普通、精良、史诗、传说
export const RARITY_COLORS = ['#e0e0e0', '#4aa3ff', '#b26bff', '#ff9f1a'] as const

const SLOT_NAMES: Record<Slot, string> = { weapon: '武器', ring: '戒指', armor: '衣服', amulet: '项链' }
const AFFIX_NAMES: Record<AffixId, string> = {
  atkPct: '攻击%',
  hpPct: '生命%',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  atkSpeedPct: '攻速%',
  cdr: '冷却缩减',
}

const LOG_SIZE = 5

/** 一件装备写成两行：「[品质] 部位 等级 主属性」和「词缀」。下一步背包界面也用它 */
export function describeItem(balance: Balance, item: Item): [string, string] {
  const main = `${mainKind(item.slot) === 'atk' ? '攻击' : '生命'} +${item.main}`
  const head = `[${balance.items.rarityNames[item.rarity]}] ${SLOT_NAMES[item.slot]} Lv${item.level}  ${main}`
  const affixes = item.affixes.map((a) => `${AFFIX_NAMES[a.id]} +${(a.value * 100).toFixed(1)}%`).join('  ')
  return [head, affixes || '无词缀']
}

/** 顶部信息栏（0–140）和底部区域（700–1280）。战斗区由 BattleScene 自己画 */
export class Hud {
  private readonly balance: Balance
  private readonly stageText: Phaser.GameObjects.Text
  private readonly bagText: Phaser.GameObjects.Text
  private readonly levelText: Phaser.GameObjects.Text
  private readonly expText: Phaser.GameObjects.Text
  private readonly goldText: Phaser.GameObjects.Text
  private readonly expBar: Phaser.GameObjects.Graphics
  private readonly logTexts: Phaser.GameObjects.Text[] = []
  private readonly log: Drop[] = []

  constructor(scene: Phaser.Scene, balance: Balance, offlineLine: string) {
    this.balance = balance
    const text = (x: number, y: number, size: number, color: string): Phaser.GameObjects.Text =>
      scene.add.text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, color, lineSpacing: 6 }).setDepth(5)

    scene.add.graphics().setDepth(0).fillStyle(0x24262b).fillRect(0, 0, 720, 140).fillStyle(0x1a1b1f).fillRect(0, 700, 720, 580)

    this.stageText = text(24, 14, 34, '#ffffff')
    this.bagText = text(696, 18, 28, '#c8ccd2').setOrigin(1, 0)
    this.levelText = text(24, 62, 30, '#ffffff')
    this.expBar = scene.add.graphics().setDepth(4)
    this.expText = text(340, 80, 20, '#ffffff').setOrigin(0.5)
    this.goldText = text(24, 100, 30, '#ffd54a')

    text(24, 716, 26, '#9aa0a6').setText('最近掉落')
    for (let i = 0; i < LOG_SIZE; i++) this.logTexts.push(text(24, 760 + i * 78, 24, '#e0e0e0'))
    text(24, 1170, 24, '#9fd8a8').setText(offlineLine).setWordWrapWidth(672)
  }

  /** 每帧调用；文字没变时 Phaser 的 setText 不会重绘 */
  update(state: GameState): void {
    const b = this.balance
    const st = state.stage
    const wave = isBossWave(b, st.wave) ? '首领' : `波 ${st.wave}/${b.stage.wavesPerStage}`
    this.stageText.setText(`第 ${st.n} 关 · ${wave}`)
    this.bagText.setText(`背包 ${state.bag.length}/${b.items.bagCapacity}`)
    this.levelText.setText(`Lv ${state.hero.level}`)
    this.goldText.setText(`金币 ${Math.floor(state.gold)}`)

    const need = expToNext(b, state.hero.level)
    const exp = Math.floor(state.hero.exp)
    this.expText.setText(`${exp}/${need}`)
    this.expBar
      .clear()
      .fillStyle(0x3a3d44)
      .fillRect(130, 68, 420, 24)
      .fillStyle(0x4caf50)
      .fillRect(130, 68, 420 * Math.min(1, exp / need), 24)
  }

  /** 新掉落放到列表最上面，只留最近 5 条 */
  addDrop(drop: Drop): void {
    this.log.unshift(drop)
    if (this.log.length > LOG_SIZE) this.log.pop()
    this.log.forEach((d, i) => {
      const [head, affixes] = describeItem(this.balance, d.item)
      const note = d.salvaged ? ` (背包满，分解 +${d.gold})` : ''
      this.logTexts[i]
        .setText(`${head}${note}\n${affixes}`)
        .setColor(RARITY_COLORS[d.item.rarity])
        .setAlpha(d.salvaged ? 0.6 : 1)
    })
  }
}
