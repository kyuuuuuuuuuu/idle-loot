import type Phaser from 'phaser'
import { setSkillOrder } from '../logic/progress.ts'
import { heroStats } from '../logic/stats.ts'
import type { GameState, SkillId } from '../logic/types.ts'
import { addButton, addCard, addText, PANEL_DEPTH, setText, TEXT } from './ui.ts'
import type { Button, Panel, UiCtx } from './ui.ts'

// 技能页（y 700–1190）：三行，每行 102 高、间隔 8、从 y 712 起；右边「↑」「↓」各 88 × 88
const ROW_Y = 712
const ROW_STEP = 110

/** 百分比去掉多余的 0：0.2 → "20%"，0.075 → "7.5%" */
const pct = (v: number): string => `${parseFloat((v * 100).toFixed(1))}%`

export class SkillPanel implements Panel {
  private readonly ctx: UiCtx
  private readonly parts: Array<{ setVisible(v: boolean): unknown }> = []
  private readonly rows: Array<{ name: Phaser.GameObjects.Text; desc: Phaser.GameObjects.Text; up: Button; down: Button }> = []

  constructor(scene: Phaser.Scene, ctx: UiCtx) {
    this.ctx = ctx
    for (let i = 0; i < 3; i++) {
      const y = ROW_Y + i * ROW_STEP
      // 底色块先建，字和按钮都比它高一层：同一深度时后建的盖住先建的
      const card = addCard(scene, 12, y, 696, 102)
      const name = addText(scene, 28, y + 14, 28, TEXT.white).setDepth(PANEL_DEPTH + 1)
      const desc = addText(scene, 28, y + 60, 20, TEXT.gray).setDepth(PANEL_DEPTH + 1)
      const up = addButton(scene, 520, y + 7, 88, 88, '↑', () => this.move(i, -1), { size: 40, depth: PANEL_DEPTH + 1 })
      const down = addButton(scene, 620, y + 7, 88, 88, '↓', () => this.move(i, 1), { size: 40, depth: PANEL_DEPTH + 1 })
      this.rows.push({ name, desc, up, down })
      this.parts.push(card, name, desc, up, down)
    }
    // 中文没有空格，要 useAdvancedWrap 才会按字折行
    const note = addText(scene, 24, 1060, 22, TEXT.gray, { wordWrap: { width: 672, useAdvancedWrap: true } }).setDepth(PANEL_DEPTH + 1)
    note.setText('排在前面的先放：冷却好了、放了有用，就放它。普攻一直在打，不占顺序。')
    this.parts.push(note)
  }

  show(): void {
    for (const p of this.parts) p.setVisible(true)
  }

  hide(): void {
    for (const p of this.parts) p.setVisible(false)
  }

  refresh(state: GameState): void {
    const { balance } = this.ctx
    const sk = balance.skills
    // 实际冷却 = 表里的冷却 × (1 − 冷却缩减)，保留 1 位小数
    const cdr = heroStats(state, balance).cdr
    const cd = (id: SkillId): string => ((sk[id].cdMs / 1000) * (1 - cdr)).toFixed(1)
    const desc: Record<SkillId, string> = {
      heavy: `打最前面一个怪，攻击 ×${sk.heavy.mult} · 冷却 ${cd('heavy')} 秒`,
      whirl: `打前方 ${sk.whirl.radius} 像素内所有怪，攻击 ×${sk.whirl.mult} · 冷却 ${cd('whirl')} 秒`,
      heal: `回复 ${pct(sk.heal.pct)} 最大生命（掉血够多才放）· 冷却 ${cd('heal')} 秒`,
    }
    this.rows.forEach((row, i) => {
      const id = state.skills.order[i]
      setText(row.name, `${i + 1}. ${sk[id].name}`)
      setText(row.desc, desc[id])
      row.up.setEnabled(i > 0)
      row.down.setEnabled(i < this.rows.length - 1)
    })
  }

  /** 第 i 行和上一行（dir = −1）或下一行（dir = 1）对调 */
  private move(i: number, dir: -1 | 1): void {
    const order = [...this.ctx.state.skills.order]
    const j = i + dir
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    setSkillOrder(this.ctx.state, order)
    this.ctx.changed()
  }
}
