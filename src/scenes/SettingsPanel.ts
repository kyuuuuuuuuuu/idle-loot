import type Phaser from 'phaser'
import { heroStats, power } from '../logic/stats.ts'
import type { GameState } from '../logic/types.ts'
import { addButton, addText, FILL, PANEL_DEPTH, setText, TEXT } from './ui.ts'
import type { Button, Panel, UiCtx } from './ui.ts'

// 设置页（y 700–1190）：属性两列（左列 x 24，右列 x 372，从 y 724 起，行高 48）+ 「重置存档」
const LEFT_X = 24
const RIGHT_X = 372
const FIRST_Y = 724
const ROW_H = 48
const CONFIRM_MS = 3000

const IDLE_LABEL = '重置存档'
const ARMED_LABEL = '再点一次确认'

export class SettingsPanel implements Panel {
  private readonly ctx: UiCtx
  private readonly texts: Phaser.GameObjects.Text[] = []
  private readonly button: Button
  private armed: Phaser.Time.TimerEvent | null = null

  /** onReset：真正重置存档（改 state、存档、切回背包页），由场景做 */
  constructor(scene: Phaser.Scene, ctx: UiCtx, onReset: () => void) {
    this.ctx = ctx
    // 5 行：攻击|生命、暴击率|暴击伤害、攻速|冷却缩减、战力、累计击杀|阵亡次数；下标 = 行 × 2 + 列
    for (let i = 0; i < 10; i++) {
      const x = i % 2 === 0 ? LEFT_X : RIGHT_X
      this.texts.push(addText(scene, x, FIRST_Y + Math.floor(i / 2) * ROW_H, 26, TEXT.white).setDepth(PANEL_DEPTH + 1))
    }
    // 第一次点：字变成"再点一次确认"；3 秒内再点才重置，3 秒没点就恢复。不用浏览器的确认框（微信里没有）
    this.button = addButton(
      scene,
      210,
      1060,
      300,
      88,
      IDLE_LABEL,
      () => {
        if (this.armed) {
          this.disarm()
          onReset()
        } else {
          this.button.setLabel(ARMED_LABEL)
          this.armed = scene.time.delayedCall(CONFIRM_MS, () => this.disarm())
        }
      },
      { fill: FILL.red, size: 30 },
    )
  }

  show(): void {
    for (const t of this.texts) t.setVisible(true)
    this.button.setVisible(true)
  }

  hide(): void {
    for (const t of this.texts) t.setVisible(false)
    this.button.setVisible(false)
    this.disarm() // 切走再回来，按钮恢复原样
  }

  refresh(state: GameState): void {
    const st = heroStats(state, this.ctx.balance)
    const values = [
      `攻击 ${st.atk.toFixed(1)}`,
      `生命 ${Math.round(st.maxHp)}`,
      `暴击率 ${(st.critRate * 100).toFixed(1)}%`,
      `暴击伤害 ${Math.round(st.critDmg * 100)}%`,
      `攻速 ${st.atkSpeed.toFixed(2)}/秒`,
      `冷却缩减 ${(st.cdr * 100).toFixed(1)}%`,
      `战力 ${power(st)}`,
      '',
      `累计击杀 ${state.totalKills}`,
      `阵亡次数 ${state.deaths}`,
    ]
    values.forEach((v, i) => setText(this.texts[i], v))
  }

  private disarm(): void {
    this.armed?.remove(false)
    this.armed = null
    this.button.setLabel(IDLE_LABEL)
  }
}
