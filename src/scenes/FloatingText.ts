import Phaser from 'phaser'
import { FONT } from './Hud.ts'

interface Entry {
  text: Phaser.GameObjects.Text
  /** 剩余毫秒；<= 0 表示空闲，可以被复用 */
  life: number
  color: string
  size: number
}

const LIFE_MS = 900
const RISE_PX_PER_S = 70
const FADE_MS = 300

/** 飘字对象池：开场一次建好固定数量的 Text，之后只改字、颜色、位置，不在战斗中 new / destroy */
export class FloatingTextPool {
  private readonly entries: Entry[] = []

  constructor(scene: Phaser.Scene, size = 48) {
    for (let i = 0; i < size; i++) {
      const text = scene.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '28px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(100)
        .setVisible(false)
      this.entries.push({ text, life: 0, color: '#ffffff', size: 28 })
    }
  }

  spawn(x: number, y: number, str: string, color = '#ffffff', size = 28): void {
    // 有空闲的用空闲的；池子满了就顶掉最老的那个
    let e = this.entries.find((en) => en.life <= 0)
    if (!e) {
      e = this.entries[0]
      for (const en of this.entries) if (en.life < e.life) e = en
    }
    e.life = LIFE_MS
    e.text.setText(str)
    // 改颜色和字号都会让 Text 重绘，所以没变就别碰
    if (e.color !== color) {
      e.text.setColor(color)
      e.color = color
    }
    if (e.size !== size) {
      e.text.setFontSize(size)
      e.size = size
    }
    e.text.setPosition(x, y).setAlpha(1).setVisible(true)
  }

  update(dtMs: number): void {
    for (const e of this.entries) {
      if (e.life <= 0) continue
      e.life -= dtMs
      if (e.life <= 0) {
        e.text.setVisible(false)
        continue
      }
      e.text.y -= (RISE_PX_PER_S * dtMs) / 1000
      e.text.setAlpha(Math.min(1, e.life / FADE_MS))
    }
  }
}
