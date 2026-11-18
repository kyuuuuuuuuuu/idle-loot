import Phaser from 'phaser'
import { step } from '../logic/battle.ts'
import type { Rng } from '../logic/rng.ts'
import { heroStats } from '../logic/stats.ts'
import type { Balance, BattleEvent, GameState } from '../logic/types.ts'
import type { Platform } from '../platform/index.ts'
import { FloatingTextPool } from './FloatingText.ts'
import { Hud } from './Hud.ts'

export interface BattleDeps {
  state: GameState
  balance: Balance
  rng: Rng
  platform: Platform
  /** 存档：盖时间戳、序列化、写存储都由调用方负责 */
  save: () => void
  /** 底部那行离线收益文字 */
  offlineLine: string
}

// 固定步长：逻辑永远按 50ms 一步走；渲染每帧把经过的时间累加起来，攒够一步就走一步。
const STEP_MS = 50
// 一帧最多补 1 秒（20 步）。切后台再回来、或者卡住很久时，多出来的时间直接丢掉，不一口气快进。
const MAX_FRAME_MS = 1000

const WIDTH = 720
const GROUND_Y = 560
const HERO_SIZE = 72
const MONSTER_SIZE = 60
const BOSS_SIZE = 130

const fmt = (v: number): string => String(Math.max(1, Math.round(v)))

export class BattleScene extends Phaser.Scene {
  private readonly deps: BattleDeps
  private lastTime: number | null = null
  private acc = 0
  private lastSaveAt: number
  private scroll = 0
  private floatSeq = 0
  private monsterBodies: Phaser.GameObjects.Rectangle[] = []
  private ground!: Phaser.GameObjects.Graphics
  private bars!: Phaser.GameObjects.Graphics
  private floats!: FloatingTextPool
  private hud!: Hud

  constructor(deps: BattleDeps) {
    super('battle')
    this.deps = deps
    this.lastSaveAt = deps.platform.now()
  }

  create(): void {
    const { balance } = this.deps
    this.add
      .graphics()
      .setDepth(0)
      .fillStyle(0x2c3038)
      .fillRect(0, 140, WIDTH, 560)
      .fillStyle(0x454951)
      .fillRect(0, GROUND_Y, WIDTH, 700 - GROUND_Y)
      .fillStyle(0x8a8f98)
      .fillRect(0, GROUND_Y, WIDTH, 4)
    this.ground = this.add.graphics().setDepth(1)
    this.add.rectangle(balance.hero.x, GROUND_Y - HERO_SIZE / 2, HERO_SIZE, HERO_SIZE, 0x3b82f6).setDepth(2)
    this.bars = this.add.graphics().setDepth(3)
    this.floats = new FloatingTextPool(this)
    this.hud = new Hud(this, balance, this.deps.offlineLine)
  }

  update(time: number): void {
    const { state, balance, rng, platform } = this.deps

    const dt = this.lastTime === null ? 0 : Math.min(Math.max(time - this.lastTime, 0), MAX_FRAME_MS)
    this.lastTime = time
    this.acc += dt
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS
      for (const e of step(state, balance, rng, STEP_MS)) this.onEvent(e)
    }

    this.floats.update(dt)
    this.draw(dt)

    const now = platform.now()
    if (now - this.lastSaveAt >= balance.save.intervalMs) {
      this.deps.save()
      this.lastSaveAt = now
    }
  }

  /** 事件 → 飘字和掉落列表。伤害、掉落都是逻辑算好的，这里只负责显示 */
  private onEvent(e: BattleEvent): void {
    const { balance } = this.deps
    const heroX = balance.hero.x
    // 同一时刻冒出的几个数字轮流错开位置（左中右、高低），免得叠在一起
    const seq = this.floatSeq++
    const jx = ((seq % 3) - 1) * 34
    const jy = -(seq % 2) * 28
    switch (e.type) {
      case 'damage': {
        const x = e.x + jx
        const y = (e.target === 'hero' ? GROUND_Y - 130 : GROUND_Y - 120) + jy
        this.floats.spawn(x, y, fmt(e.value) + (e.crit ? '!' : ''), e.crit ? '#ffd54a' : '#ffffff', e.crit ? 36 : 28)
        break
      }
      case 'heal':
        this.floats.spawn(heroX + jx, GROUND_Y - 150 + jy, `+${fmt(e.value)}`, '#6be26b')
        break
      case 'skill':
        this.floats.spawn(heroX, GROUND_Y - 200, balance.skills[e.skill].name, '#ff9f1a', 30)
        break
      case 'loot':
        if (e.gold > 0) this.floats.spawn(e.x + jx, GROUND_Y - 70 + jy, `+${e.gold}金`, '#ffd54a', 24)
        for (const drop of e.drops) this.hud.addDrop(drop)
        break
      case 'levelUp':
        this.floats.spawn(heroX, GROUND_Y - 240, `升级! Lv ${e.level}`, '#7bd88f', 34)
        break
      case 'waveStart':
        if (e.isBoss) this.floats.spawn(WIDTH / 2, 300, '首领来袭!', '#b26bff', 44)
        break
      case 'stageClear':
        this.floats.spawn(WIDTH / 2, 260, '过关!', '#ffd54a', 54)
        break
      case 'heroDeath':
        this.floats.spawn(WIDTH / 2, 340, '阵亡，重打本关', '#ff6b6b', 44)
        break
      case 'kill':
        break
    }
  }

  /** 把 state 画出来：英雄、怪、血条、滚动的地面刻度、顶部和底部信息 */
  private draw(dtMs: number): void {
    const { state, balance } = this.deps

    // 清完一波后走路：地面刻度向左滚
    if (state.stage.phase === 'walk') this.scroll = (this.scroll + 0.18 * dtMs) % 90
    this.ground.clear().fillStyle(0x6a6f78)
    for (let x = -this.scroll; x < WIDTH; x += 90) this.ground.fillRect(x, GROUND_Y + 30, 40, 4)

    // 怪的方块按下标复用；怪死了下标会前移，方块只是换个目标，不销毁
    const monsters = state.monsters
    for (let i = 0; i < monsters.length; i++) {
      const m = monsters[i]
      const body = this.monsterBodies[i] ?? this.addMonsterBody()
      const size = m.isBoss ? BOSS_SIZE : MONSTER_SIZE
      body
        .setSize(size, size)
        .setFillStyle(m.isBoss ? 0x9b59d6 : 0xe74c3c)
        .setPosition(m.x, GROUND_Y - size / 2 + this.yOffset(m.id))
        .setVisible(true)
    }
    for (let i = monsters.length; i < this.monsterBodies.length; i++) this.monsterBodies[i].setVisible(false)

    // 血条
    const bars = this.bars
    bars.clear()
    const bar = (cx: number, top: number, w: number, frac: number, color: number): void => {
      bars.fillStyle(0x000000, 0.65).fillRect(cx - w / 2 - 1, top - 1, w + 2, 10)
      bars.fillStyle(color, 1).fillRect(cx - w / 2, top, w * Math.max(0, Math.min(1, frac)), 8)
    }
    bar(balance.hero.x, GROUND_Y - HERO_SIZE - 18, 84, state.hero.hp / heroStats(state, balance).maxHp, 0x4caf50)
    for (const m of monsters) {
      const size = m.isBoss ? BOSS_SIZE : MONSTER_SIZE
      bar(m.x, GROUND_Y - size - 18 + this.yOffset(m.id), size + 14, m.hp / m.maxHp, m.isBoss ? 0xb26bff : 0xff6b6b)
    }

    this.hud.update(state)
  }

  /** 怪停在同一个位置会重叠；画面上按 id 在 y 方向错开几像素，逻辑不变 */
  private yOffset(id: number): number {
    return ((id % 3) - 1) * 12
  }

  private addMonsterBody(): Phaser.GameObjects.Rectangle {
    const body = this.add.rectangle(0, 0, MONSTER_SIZE, MONSTER_SIZE, 0xe74c3c).setDepth(2).setVisible(false)
    this.monsterBodies.push(body)
    return body
  }
}
