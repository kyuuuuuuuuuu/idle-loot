import type Phaser from 'phaser'
import { addButton, addText, FILL, TEXT } from './ui.ts'
import type { Button } from './ui.ts'

export type ModalKind = 'offline' | 'item' | 'slot'

export interface ModalSpec {
  kind: ModalKind
  title: string
  titleColor?: string
  /** 正文，一行一条；text 为空串 = 空一行 */
  lines: Array<{ text: string; color?: string }>
  buttons: Array<{ label: string; fill: number; enabled?: boolean; onTap: () => void }>
}

// 版式照 design.md「弹窗」：面板 640 × 800 从 (40, 240) 起；按钮高 88、等宽、间隔 20、左右各留 15
const PANEL_X = 40
const PANEL_Y = 240
const PANEL_W = 640
const PANEL_H = 800
const BTN_H = 88
const BTN_GAP = 20
const BTN_SIDE = 15
const LINE_H = 40

/**
 * 弹窗 = 一层全屏半透明黑的遮罩（能点，把点击吞掉，下面的按钮就点不到）+ 面板 + 面板上的字和按钮。
 * 深度：遮罩 200，面板 201，字和按钮 202，都比游戏画面高。
 */
export class Modal {
  private readonly scene: Phaser.Scene
  private current: ModalKind | null = null
  private objects: Phaser.GameObjects.GameObject[] = []
  private buttons: Button[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  get kind(): ModalKind | null {
    return this.current
  }

  /** 再次 open 直接换内容（部位弹窗强化后刷新就靠这个） */
  open(spec: ModalSpec): void {
    this.close()
    const scene = this.scene
    this.current = spec.kind
    this.objects.push(
      scene.add.rectangle(0, 0, 720, 1280, 0x000000, 0.6).setOrigin(0, 0).setDepth(200).setInteractive(),
      scene.add
        .rectangle(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, FILL.panel)
        .setOrigin(0, 0)
        .setStrokeStyle(2, FILL.tabOn)
        .setDepth(201),
    )

    const title = addText(scene, PANEL_X + PANEL_W / 2, PANEL_Y + 30, 30, spec.titleColor ?? TEXT.white)
      .setOrigin(0.5, 0)
      .setDepth(202)
      .setText(spec.title)
    this.objects.push(title)

    spec.lines.forEach((line, i) => {
      if (line.text === '') return
      const t = addText(scene, PANEL_X + 32, PANEL_Y + 100 + i * LINE_H, 24, line.color ?? TEXT.white).setDepth(202).setText(line.text)
      this.objects.push(t)
    })

    const n = spec.buttons.length
    const w = (PANEL_W - 2 * BTN_SIDE - BTN_GAP * (n - 1)) / n
    spec.buttons.forEach((b, i) => {
      const btn = addButton(
        scene,
        PANEL_X + BTN_SIDE + i * (w + BTN_GAP),
        PANEL_Y + PANEL_H - BTN_SIDE - BTN_H,
        w,
        BTN_H,
        b.label,
        b.onTap,
        { fill: b.fill, size: 28, depth: 202 },
      )
      btn.setEnabled(b.enabled ?? true)
      this.buttons.push(btn)
    })
  }

  close(): void {
    for (const o of this.objects) o.destroy()
    for (const b of this.buttons) b.destroy()
    this.objects = []
    this.buttons = []
    this.current = null
  }
}
