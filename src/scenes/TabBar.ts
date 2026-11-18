import type Phaser from 'phaser'
import { addButton, FILL, PANEL_DEPTH, TEXT } from './ui.ts'
import type { Button } from './ui.ts'

export type Tab = 'bag' | 'skill' | 'settings'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'bag', label: '背包' },
  { id: 'skill', label: '技能' },
  { id: 'settings', label: '设置' },
]

/** 底部标签栏（y 1190–1280）：三个标签各 240 × 90。当前标签底色亮一档、字白色，其余字灰色 */
export class TabBar {
  private readonly buttons = new Map<Tab, Button>()

  constructor(scene: Phaser.Scene, onSelect: (tab: Tab) => void) {
    scene.add.rectangle(0, 1190, 720, 2, FILL.tabOn).setOrigin(0, 0).setDepth(PANEL_DEPTH)
    TABS.forEach((t, i) => {
      this.buttons.set(t.id, addButton(scene, i * 240, 1190, 240, 90, t.label, () => onSelect(t.id), { fill: FILL.panel, size: 32 }))
    })
  }

  setActive(tab: Tab): void {
    for (const [id, button] of this.buttons) {
      button.setFill(id === tab ? FILL.tabOn : FILL.panel)
      button.setTextColor(id === tab ? TEXT.white : TEXT.gray)
    }
  }
}
