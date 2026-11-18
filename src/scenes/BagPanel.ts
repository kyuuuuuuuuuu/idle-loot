import type Phaser from 'phaser'
import { bagView, salvageWorse } from '../logic/bag.ts'
import { salvageValue } from '../logic/loot.ts'
import { enhance, enhanceCost, equip, salvage } from '../logic/progress.ts'
import { powerOf, powerWithItem } from '../logic/stats.ts'
import { SLOTS } from '../logic/types.ts'
import type { GameState, Slot } from '../logic/types.ts'
import type { ModalSpec } from './Modal.ts'
import {
  addButton,
  addCard,
  addText,
  describeItem,
  FILL,
  fmtDelta,
  itemTitle,
  mainName,
  PANEL_DEPTH,
  RARITY_COLORS,
  setText,
  SLOT_NAMES,
  statLines,
  TEXT,
} from './ui.ts'
import type { Button, Panel, UiCtx } from './ui.ts'

// 背包页（y 700–1190）：身上四件 → 工具行（页码、翻页、分解更差的）→ 列表，每页 4 行。坐标照 design.md「背包页」
const CARD_Y = 708
const TOOL_Y = 836
const LIST_Y = 908
const ROW_STEP = 70
const PAGE_SIZE = 4

interface CardParts {
  title: Phaser.GameObjects.Text
  rarity: Phaser.GameObjects.Text
  main: Phaser.GameObjects.Text
}

interface RowParts {
  card: Phaser.GameObjects.Rectangle
  head: Phaser.GameObjects.Text
  affixes: Phaser.GameObjects.Text
  delta: Phaser.GameObjects.Text
}

type Line = ModalSpec['lines'][number]
const plain = (texts: string[]): Line[] => texts.map((text) => ({ text }))

export class BagPanel implements Panel {
  private readonly ctx: UiCtx
  private readonly parts: Array<{ setVisible(v: boolean): unknown }> = []
  private readonly cards: CardParts[] = []
  private readonly rows: RowParts[] = []
  private readonly pageText: Phaser.GameObjects.Text
  private readonly emptyText: Phaser.GameObjects.Text
  private readonly prev: Button
  private readonly next: Button
  private currentPage = 1
  private currentRows: number[] = []

  constructor(scene: Phaser.Scene, ctx: UiCtx) {
    this.ctx = ctx
    const above = PANEL_DEPTH + 1

    // 身上四件：168 × 120，间隔 8，从 x 12 起
    SLOTS.forEach((slot, i) => {
      const x = 12 + i * 176
      const card = addCard(scene, x, CARD_Y, 168, 120, () => this.openSlot(slot))
      const title = addText(scene, x + 10, CARD_Y + 8, 26, TEXT.white).setDepth(above)
      const rarity = addText(scene, x + 10, CARD_Y + 46, 22, TEXT.gray).setDepth(above)
      const main = addText(scene, x + 10, CARD_Y + 80, 22, TEXT.white).setDepth(above)
      this.cards.push({ title, rarity, main })
      this.parts.push(card, title, rarity, main)
    })

    // 工具行：第 p/q 页、‹ ›、分解更差的
    this.pageText = addText(scene, 24, TOOL_Y + 32, 26, TEXT.gray).setOrigin(0, 0.5).setDepth(above)
    this.prev = addButton(scene, 200, TOOL_Y, 96, 64, '‹', () => this.turn(-1), { size: 36 })
    this.next = addButton(scene, 304, TOOL_Y, 96, 64, '›', () => this.turn(1), { size: 36 })
    const worse = addButton(scene, 528, TOOL_Y, 180, 64, '分解更差的', () => this.salvageAll(), { fill: FILL.red, size: 26 })
    this.parts.push(this.pageText, this.prev, this.next, worse)

    // 列表：每行占 70 高，底色块 696 × 66 从 x 12 起；左边两行字，右边战力变化
    for (let i = 0; i < PAGE_SIZE; i++) {
      const y = LIST_Y + i * ROW_STEP
      const card = addCard(scene, 12, y, 696, 66, () => {
        const id = this.currentRows[i]
        if (id !== undefined) this.openItem(id)
      })
      const head = addText(scene, 24, y + 6, 24, TEXT.white).setDepth(above)
      const affixes = addText(scene, 24, y + 38, 20, TEXT.gray).setDepth(above)
      const delta = addText(scene, 696, y + 33, 28, TEXT.green).setOrigin(1, 0.5).setDepth(above)
      this.rows.push({ card, head, affixes, delta })
      this.parts.push(card, head, affixes, delta)
    }
    this.emptyText = addText(scene, 360, LIST_Y + 140, 28, TEXT.gray).setOrigin(0.5).setDepth(above)
    this.emptyText.setText('背包是空的')
    this.parts.push(this.emptyText)
  }

  /** 当前页码，从 1 数 */
  get page(): number {
    return this.currentPage
  }

  /** 本页从上到下每一行的装备 id（最近一次 refresh 时的） */
  get rowIds(): number[] {
    return this.currentRows
  }

  setPage(page: number): void {
    this.currentPage = page
  }

  show(): void {
    for (const p of this.parts) p.setVisible(true)
  }

  hide(): void {
    for (const p of this.parts) p.setVisible(false)
  }

  refresh(state: GameState): void {
    const { balance } = this.ctx

    for (const [i, slot] of SLOTS.entries()) {
      const item = state.equipped[slot]
      const card = this.cards[i]
      setText(card.title, `${SLOT_NAMES[slot]} +${state.enhance[slot]}`)
      if (item) {
        const main = Math.round(item.main * (1 + balance.enhance.perLevel * state.enhance[slot])) // 已算强化
        setText(card.rarity, `${balance.items.rarityNames[item.rarity]} Lv${item.level}`, RARITY_COLORS[item.rarity])
        setText(card.main, `${mainName(slot)} +${main}`)
      } else {
        setText(card.rarity, '空', TEXT.gray)
        setText(card.main, '')
      }
    }

    const view = bagView(state, balance)
    const pages = Math.max(1, Math.ceil(view.length / PAGE_SIZE))
    this.currentPage = Math.min(Math.max(1, this.currentPage), pages) // 背包变少、当前页没了：退到最后一页
    const shown = view.slice((this.currentPage - 1) * PAGE_SIZE, this.currentPage * PAGE_SIZE)
    this.currentRows = shown.map((r) => r.item.id)

    this.rows.forEach((row, i) => {
      const r = shown[i]
      for (const o of [row.card, row.head, row.affixes, row.delta]) o.setVisible(r !== undefined)
      if (!r) return
      const [head, affixes] = describeItem(balance, r.item)
      setText(row.head, head, RARITY_COLORS[r.item.rarity])
      setText(row.affixes, affixes)
      setText(row.delta, `${r.upgrade ? '↑' : '↓'} ${fmtDelta(r.delta)}`, r.upgrade ? TEXT.green : TEXT.red)
    })
    this.emptyText.setVisible(view.length === 0)

    setText(this.pageText, `第 ${this.currentPage}/${pages} 页`)
    this.prev.setEnabled(this.currentPage > 1)
    this.next.setEnabled(this.currentPage < pages)
  }

  private turn(dir: -1 | 1): void {
    this.currentPage += dir
    this.ctx.changed() // refresh 会把越界的页码收回来
  }

  private salvageAll(): void {
    const { state, balance } = this.ctx
    const r = salvageWorse(state, balance)
    if (r.count > 0) this.ctx.toast(`分解 ${r.count} 件 +${r.gold} 金`, TEXT.gold)
    else this.ctx.toast('没有更差的', TEXT.white)
    this.ctx.changed()
  }

  /** 装备弹窗：这件和身上的并排对比，战力变化写在最后 */
  private openItem(id: number): void {
    const { state, balance, modal } = this.ctx
    const item = state.bag.find((it) => it.id === id)
    if (!item) return
    const worn = state.equipped[item.slot]
    const before = powerOf(state, balance)
    const after = powerWithItem(state, balance, item)
    const lines: Line[] = [{ text: '这件', color: TEXT.gray }, ...plain(statLines(item)), { text: '' }]
    if (worn) lines.push({ text: `身上的：${itemTitle(balance, worn)}`, color: RARITY_COLORS[worn.rarity] }, ...plain(statLines(worn)))
    else lines.push({ text: '身上的：空', color: TEXT.gray })
    lines.push(
      { text: '' },
      {
        text: `战力 ${before} → ${after}（${fmtDelta(before > 0 ? after / before - 1 : 0)}）`,
        color: after > before ? TEXT.green : TEXT.red,
      },
    )
    modal.open({
      kind: 'item',
      title: itemTitle(balance, item),
      titleColor: RARITY_COLORS[item.rarity],
      lines,
      buttons: [
        {
          label: '换上',
          fill: FILL.green,
          onTap: () => {
            equip(state, id)
            modal.close()
            this.ctx.changed()
          },
        },
        {
          label: `分解 +${salvageValue(balance, item)} 金`,
          fill: FILL.red,
          onTap: () => {
            salvage(state, balance, id)
            modal.close()
            this.ctx.changed()
          },
        },
        { label: '关闭', fill: FILL.gray, onTap: () => modal.close() },
      ],
    })
  }

  /** 部位弹窗：看身上那件、强化。强化后弹窗不关，换一份新内容再打开，可以连点 */
  private openSlot(slot: Slot): void {
    const { state, balance, modal } = this.ctx
    const item = state.equipped[slot]
    const k = state.enhance[slot]
    const per = balance.enhance.perLevel
    const cost = enhanceCost(balance, k)
    modal.open({
      kind: 'slot',
      title: `${SLOT_NAMES[slot]} +${k}`,
      lines: [
        ...(item ? plain(statLines(item)) : [{ text: '空', color: TEXT.gray }]),
        { text: '' },
        { text: `强化 +${k}：主属性 ×${(1 + per * k).toFixed(2)}` },
        { text: `下一级：主属性 ×${(1 + per * (k + 1)).toFixed(2)}` },
      ],
      buttons: [
        {
          label: `强化（${cost} 金）`,
          fill: FILL.green,
          enabled: state.gold >= cost,
          onTap: () => {
            enhance(state, balance, slot)
            this.ctx.changed()
            this.openSlot(slot)
          },
        },
        { label: '关闭', fill: FILL.gray, onTap: () => modal.close() },
      ],
    })
  }
}
