import type Phaser from 'phaser'
import { mainKind } from '../logic/types.ts'
import type { AffixId, Balance, GameState, Item, Slot } from '../logic/types.ts'
import type { Modal } from './Modal.ts'

// 公用的界面零件：字体、颜色、文字、按钮。全项目只有这个文件直接创建 Text 对象——
// 高清屏的清晰度（resolution）要每个 Text 都带上，集中在这里才不会漏。

export const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

// 品质颜色：普通、精良、史诗、传说
export const RARITY_COLORS = ['#e0e0e0', '#4aa3ff', '#b26bff', '#ff9f1a'] as const

/** 底色 */
export const FILL = {
  green: 0x2e7d32,
  red: 0x8e3b3b,
  gray: 0x4a4d55,
  purple: 0x9b59d6,
  panel: 0x24262b,
  card: 0x2c3038,
  tabOn: 0x3a3d44,
} as const

/** 字色 */
export const TEXT = {
  white: '#ffffff',
  gray: '#9aa0a6',
  green: '#7bd88f',
  red: '#ff6b6b',
  gold: '#ffd54a',
  purple: '#b26bff',
} as const

/** 面板里的卡片、列表行用这个深度，它们上面的字 +1 */
export const PANEL_DEPTH = 10

export const SLOT_NAMES: Record<Slot, string> = { weapon: '武器', ring: '戒指', armor: '衣服', amulet: '项链' }
const AFFIX_NAMES: Record<AffixId, string> = {
  atkPct: '攻击%',
  hpPct: '生命%',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  atkSpeedPct: '攻速%',
  cdr: '冷却缩减',
}

/** 主属性叫什么：武器、戒指是攻击，衣服、项链是生命 */
export const mainName = (slot: Slot): string => (mainKind(slot) === 'atk' ? '攻击' : '生命')

/** 「[品质] 部位 Lv等级」，弹窗标题和列表第一行都用 */
export function itemTitle(balance: Balance, item: Item): string {
  return `[${balance.items.rarityNames[item.rarity]}] ${SLOT_NAMES[item.slot]} Lv${item.level}`
}

const mainText = (item: Item): string => `${mainName(item.slot)} +${item.main}`
const affixTexts = (item: Item): string[] => item.affixes.map((a) => `${AFFIX_NAMES[a.id]} +${(a.value * 100).toFixed(1)}%`)

/** 一件装备写成两行：「[品质] 部位 等级 主属性」和「词缀」。背包列表和最新掉落都用它 */
export function describeItem(balance: Balance, item: Item): [string, string] {
  return [`${itemTitle(balance, item)}  ${mainText(item)}`, affixTexts(item).join('  ') || '无词缀']
}

/** 弹窗里逐行列出：主属性、每条词缀 */
export const statLines = (item: Item): string[] => [mainText(item), ...affixTexts(item)]

/** 战力变化比例写成「+12.0%」「−5.0%」（减号是设计稿里的 U+2212）；0 写成「0.0%」 */
export function fmtDelta(delta: number): string {
  const v = (Math.abs(delta) * 100).toFixed(1)
  return delta > 0 ? `+${v}%` : delta < 0 ? `−${v}%` : `${v}%`
}

/** 带高清分辨率的文字：fontFamily、fontSize、color、resolution 统一在这里设；extra 放描边、换行宽度这类额外样式 */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  color: string,
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, '', {
    ...extra,
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    resolution: scene.registry.get('zoom') ?? 1,
  })
}

/** 改字（和颜色）：没变就不碰，因为 Phaser 的 Text 每次 setColor 都会重画 */
export function setText(text: Phaser.GameObjects.Text, str: string, color?: string): void {
  text.setText(str)
  if (color !== undefined && text.style.color !== color) text.setColor(color)
}

/** 画一块底色（卡片、列表行）。给了 onTap 就能点，点的时候它得是可见的 */
export function addCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  onTap?: () => void,
): Phaser.GameObjects.Rectangle {
  const rect = scene.add.rectangle(x, y, w, h, FILL.card).setOrigin(0, 0).setDepth(PANEL_DEPTH)
  if (onTap) {
    rect.setInteractive().on('pointerdown', () => {
      if (rect.visible) onTap()
    })
  }
  return rect
}

export interface Button {
  setLabel(s: string): void
  /** 不可用：底色变暗、字变灰，点了不调 onTap */
  setEnabled(b: boolean): void
  setVisible(b: boolean): void
  setFill(color: number): void
  /** 可用时的字色，默认白；标签栏用它区分当前标签 */
  setTextColor(color: string): void
  /** 弹窗换内容时把旧按钮拆掉 */
  destroy(): void
}

const dim = (c: number): number =>
  ((((c >> 16) & 0xff) * 0.45) << 16) | ((((c >> 8) & 0xff) * 0.45) << 8) | ((c & 0xff) * 0.45)

/**
 * canvas 里没有现成的按钮：按钮 = 一块能点的矩形 + 居中的一行字。x, y 是左上角。
 * 点的时候按钮得是「可用且可见」才会调 onTap。
 */
export function addButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onTap: () => void,
  opts: { fill?: number; size?: number; depth?: number } = {},
): Button {
  const depth = opts.depth ?? PANEL_DEPTH
  let fill: number = opts.fill ?? FILL.gray
  let textColor: string = TEXT.white
  let enabled = true
  let visible = true
  // 字和矩形同一个深度：后创建的画在上面
  const rect = scene.add.rectangle(x, y, w, h, fill).setOrigin(0, 0).setDepth(depth).setInteractive()
  const text = addText(scene, x + w / 2, y + h / 2, opts.size ?? 28, textColor).setOrigin(0.5).setDepth(depth)
  setText(text, label)

  const paint = (): void => {
    rect.setFillStyle(enabled ? fill : dim(fill))
    setText(text, text.text, enabled ? textColor : TEXT.gray)
  }
  rect.on('pointerdown', () => {
    if (enabled && visible) onTap()
  })

  return {
    setLabel: (s) => setText(text, s),
    setEnabled(b) {
      if (b === enabled) return
      enabled = b
      paint()
    },
    setVisible(b) {
      if (b === visible) return
      visible = b
      rect.setVisible(b)
      text.setVisible(b)
    },
    setFill(color) {
      if (color === fill) return
      fill = color
      paint()
    },
    setTextColor(color) {
      if (color === textColor) return
      textColor = color
      paint()
    },
    destroy() {
      rect.destroy()
      text.destroy()
    },
  }
}

/** 面板、标签栏、弹窗共用的上下文：state 和数值表，加上"打开弹窗""飘字""state 变了，重画"三件事 */
export interface UiCtx {
  state: GameState
  balance: Balance
  modal: Modal
  /** 在战斗区中央飘一行字 */
  toast(text: string, color: string): void
  /** 玩家点了按钮、state 变了：立刻重画当前面板 */
  changed(): void
}

/** 面板页：show / hide 控制整页显隐，refresh 按当前 state 重画（切标签、点按钮之后、每 0.5 秒各调一次） */
export interface Panel {
  show(): void
  hide(): void
  refresh(state: GameState): void
}
