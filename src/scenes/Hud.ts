import type Phaser from 'phaser'
import { expToNext } from '../logic/progress.ts'
import { isBossWave } from '../logic/stage.ts'
import type { Balance, Drop, GameState } from '../logic/types.ts'
import { addText, describeItem, FILL, RARITY_COLORS, setText, TEXT } from './ui.ts'

const DROP_MS = 4000
const DROP_FADE_MS = 500

/** 顶部信息栏（0–140）、底部面板区的底色，以及战斗区左上角的"最新掉落"一行。战斗区的其余部分由 BattleScene 自己画 */
export class Hud {
  private readonly balance: Balance
  private readonly stageText: Phaser.GameObjects.Text
  private readonly bagText: Phaser.GameObjects.Text
  private readonly levelText: Phaser.GameObjects.Text
  private readonly expText: Phaser.GameObjects.Text
  private readonly goldText: Phaser.GameObjects.Text
  private readonly expBar: Phaser.GameObjects.Graphics
  private readonly dropText: Phaser.GameObjects.Text
  /** 最新掉落还要显示多久，毫秒；<= 0 表示没有 */
  private dropLife = 0
  private dropAlpha = 1

  constructor(scene: Phaser.Scene, balance: Balance) {
    this.balance = balance
    const text = (x: number, y: number, size: number, color: string): Phaser.GameObjects.Text =>
      addText(scene, x, y, size, color).setDepth(5)

    scene.add.graphics().setDepth(0).fillStyle(FILL.panel).fillRect(0, 0, 720, 140).fillRect(0, 700, 720, 580)

    this.stageText = text(24, 14, 34, TEXT.white)
    this.bagText = text(696, 18, 28, '#c8ccd2').setOrigin(1, 0)
    this.levelText = text(24, 62, 30, TEXT.white)
    this.expBar = scene.add.graphics().setDepth(4)
    this.expText = text(340, 80, 20, TEXT.white).setOrigin(0.5)
    this.goldText = text(24, 100, 30, TEXT.gold)

    this.dropText = addText(scene, 24, 150, 24, TEXT.white, { wordWrap: { width: 672, useAdvancedWrap: true } }).setDepth(5).setVisible(false)
  }

  /** 每帧调用；文字没变时 Phaser 的 setText 不会重绘 */
  update(state: GameState, dtMs: number): void {
    const b = this.balance
    const st = state.stage
    const wave = st.farming ? '刷怪中' : isBossWave(b, st.wave) ? '首领' : `波 ${st.wave}/${b.stage.wavesPerStage}`
    this.stageText.setText(`第 ${st.n} 关 · ${wave}`)
    this.bagText.setText(`背包 ${state.bag.length}/${b.items.bagCapacity}`)
    this.levelText.setText(`Lv ${state.hero.level}`)
    this.goldText.setText(`金币 ${Math.floor(state.gold)}`)

    const need = expToNext(b, state.hero.level)
    const exp = Math.floor(state.hero.exp)
    this.expText.setText(`${exp}/${need}`)
    this.expBar
      .clear()
      .fillStyle(FILL.tabOn)
      .fillRect(130, 68, 420, 24)
      .fillStyle(0x4caf50)
      .fillRect(130, 68, 420 * Math.min(1, exp / need), 24)

    // 最新掉落：显示 DROP_MS，最后 DROP_FADE_MS 淡出
    if (this.dropLife > 0) {
      this.dropLife -= dtMs
      if (this.dropLife <= 0) this.dropText.setVisible(false)
      else this.dropText.setAlpha(this.dropAlpha * Math.min(1, this.dropLife / DROP_FADE_MS))
    }
  }

  /** 新掉落直接顶替旧的；up = 换上后战力会变高，在后面加"↑"。背包满被分解的写分解了多少金币，半透明 */
  addDrop(drop: Drop, up: boolean): void {
    const [head] = describeItem(this.balance, drop.item)
    const note = drop.salvaged ? `（背包满，分解 +${drop.gold} 金）` : up ? ' ↑' : ''
    setText(this.dropText, head + note, RARITY_COLORS[drop.item.rarity])
    this.dropAlpha = drop.salvaged ? 0.6 : 1
    this.dropLife = DROP_MS
    this.dropText.setAlpha(this.dropAlpha).setVisible(true)
  }

  clearDrop(): void {
    this.dropLife = 0
    this.dropText.setVisible(false)
  }
}
