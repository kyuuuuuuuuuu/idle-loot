import Phaser from 'phaser'
import { autoChallengeTarget, challengeBoss, step } from '../logic/battle.ts'
import type { OfflineSummary } from '../logic/offline.ts'
import type { Rng } from '../logic/rng.ts'
import { heroStats, powerOf, powerWithItem } from '../logic/stats.ts'
import { createState } from '../logic/types.ts'
import type { Balance, BattleEvent, GameState } from '../logic/types.ts'
import type { Platform } from '../platform/index.ts'
import { BagPanel } from './BagPanel.ts'
import { FloatingTextPool } from './FloatingText.ts'
import { Hud } from './Hud.ts'
import { Modal } from './Modal.ts'
import type { ModalSpec } from './Modal.ts'
import { SettingsPanel } from './SettingsPanel.ts'
import { SkillPanel } from './SkillPanel.ts'
import { TabBar } from './TabBar.ts'
import type { Tab } from './TabBar.ts'
import { addButton, addText, FILL, TEXT } from './ui.ts'
import type { Button, Panel, UiCtx } from './ui.ts'

export interface BattleDeps {
  state: GameState
  balance: Balance
  rng: Rng
  platform: Platform
  /** 存档：盖时间戳、序列化、写存储都由调用方负责 */
  save: () => void
  /** 打开游戏时结算出的离线收益，没有就是 null；有的话 create() 末尾弹窗 */
  offline: OfflineSummary | null
  /** 清晰度倍数：高清屏 2，否则 1。画布按它放大，镜头缩放它，文字按它的分辨率画 */
  zoom: number
}

/** 给调试入口 / 冒烟脚本看的界面状态；page 从 1 数，rows 是背包当前页从上到下的装备 id */
export interface UiState {
  tab: Tab
  modal: 'offline' | 'item' | 'slot' | null
  page: number
  rows: number[]
}

// 固定步长：逻辑永远按 50ms 一步走；渲染每帧把经过的时间累加起来，攒够一步就走一步。
const STEP_MS = 50
// 一帧最多补 1 秒（20 步）。切后台再回来、或者卡住很久时，多出来的时间直接丢掉，不一口气快进。
const MAX_FRAME_MS = 1000

// 面板每隔这么久按当前状态重画一次（切标签、点按钮之后也会立刻重画）
const PANEL_REFRESH_MS = 500

const WIDTH = 720
const HEIGHT = 1280
const GROUND_Y = 560
const HERO_SIZE = 72
const MONSTER_SIZE = 60
const BOSS_SIZE = 130

const fmt = (v: number): string => String(Math.max(1, Math.round(v)))

export class BattleScene extends Phaser.Scene {
  private readonly deps: BattleDeps
  private lastTime: number | null = null
  private acc = 0
  private panelAcc = 0
  private lastSaveAt: number
  private scroll = 0
  private floatSeq = 0
  private tab: Tab = 'bag'
  /** 还没弹出的离线收益：启动时的那份，或者场景没建好时就切回前台带来的那份 */
  private pendingOffline: OfflineSummary | null
  private monsterBodies: Phaser.GameObjects.Rectangle[] = []
  private ground!: Phaser.GameObjects.Graphics
  private bars!: Phaser.GameObjects.Graphics
  private floats!: FloatingTextPool
  private hud!: Hud
  private modal!: Modal
  private tabBar!: TabBar
  private bagPanel!: BagPanel
  private panels!: Record<Tab, Panel>
  private challengeBtn!: Button
  private challengeNote!: Phaser.GameObjects.Text

  constructor(deps: BattleDeps) {
    super('battle')
    this.deps = deps
    this.lastSaveAt = deps.platform.now()
    this.pendingOffline = deps.offline
  }

  create(): void {
    const { state, balance, zoom } = this.deps
    // 清晰度：必须第一件事做，后面每个 Text 创建时都从 registry 读 zoom 当分辨率。
    // 画布是 720 × 1280 的 zoom 倍，镜头放大 zoom 倍，所以下面所有坐标照样按 720 × 1280 写
    this.registry.set('zoom', zoom)
    this.cameras.main.setZoom(zoom).centerOn(WIDTH / 2, HEIGHT / 2)

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
    this.hud = new Hud(this, balance)

    // 「挑战首领」和它下面的小字：只在刷怪时显示
    this.challengeBtn = addButton(this, 520, 588, 180, 72, '挑战首领', () => this.challenge(), {
      fill: FILL.purple,
      size: 30,
      depth: 20,
    })
    this.challengeNote = addText(this, 610, 680, 20, TEXT.gray).setOrigin(0.5).setDepth(20)
    this.challengeBtn.setVisible(false)
    this.challengeNote.setVisible(false)

    // 弹窗、标签栏、三个面板。面板只管把 state 画出来、点按钮时调用 logic 里的函数
    this.modal = new Modal(this)
    const ctx: UiCtx = {
      state,
      balance,
      modal: this.modal,
      toast: (text, color) => this.floats.spawn(WIDTH / 2, 300, text, color, 44),
      changed: () => this.refreshPanel(),
    }
    this.tabBar = new TabBar(this, (tab) => this.switchTab(tab))
    this.bagPanel = new BagPanel(this, ctx)
    this.panels = {
      bag: this.bagPanel,
      skill: new SkillPanel(this, ctx),
      settings: new SettingsPanel(this, ctx, () => this.resetSave()),
    }
    this.switchTab('bag')

    if (this.pendingOffline) this.openOffline(this.pendingOffline)
    this.pendingOffline = null
  }

  /** 切回前台后由入口调用：已结算过离线收益（s），这里丢掉攒着的帧时间，免得把离开的那段时间当成一帧补战斗 */
  onResume(s: OfflineSummary | null): void {
    this.lastTime = null
    this.acc = 0
    if (!s) return
    if (this.modal) this.openOffline(s)
    else this.pendingOffline = s // 场景还没建好（后台标签页刚被切到前台），等 create 末尾再弹
  }

  uiState(): UiState {
    return { tab: this.tab, modal: this.modal.kind, page: this.bagPanel.page, rows: [...this.bagPanel.rowIds] }
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

    this.panelAcc += dt
    if (this.panelAcc >= PANEL_REFRESH_MS) {
      this.panelAcc = 0
      this.refreshPanel()
    }

    const now = platform.now()
    if (now - this.lastSaveAt >= balance.save.intervalMs) {
      this.deps.save()
      this.lastSaveAt = now
    }
  }

  /** 事件 → 飘字和掉落列表。伤害、掉落都是逻辑算好的，这里只负责显示 */
  private onEvent(e: BattleEvent): void {
    const { state, balance } = this.deps
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
      case 'loot': {
        if (e.gold > 0) this.floats.spawn(e.x + jx, GROUND_Y - 70 + jy, `+${e.gold}金`, '#ffd54a', 24)
        // "↑" 按收到这一刻的装备判断：换上后战力变高；被分解的不判断
        const power = powerOf(state, balance)
        for (const drop of e.drops) this.hud.addDrop(drop, !drop.salvaged && powerWithItem(state, balance, drop.item) > power)
        break
      }
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
        this.floats.spawn(WIDTH / 2, 340, '阵亡！先刷小怪变强', TEXT.red, 44)
        break
      case 'bossChallenge':
        this.floats.spawn(WIDTH / 2, 300, '战力够了，挑战首领!', TEXT.purple, 44)
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

    this.hud.update(state, dtMs)

    // 刷怪时才有「挑战首领」。小字写当前战力和自动挑战的目标
    const farming = state.stage.farming
    this.challengeBtn.setVisible(farming)
    this.challengeNote.setVisible(farming)
    if (farming) {
      const note = this.challengeNote
      note.setText(`战力 ${powerOf(state, balance)}/${autoChallengeTarget(state, balance)} 自动挑战`)
      note.x = Math.min(610, 712 - note.width / 2) // 目标数字很大时别伸出屏幕右边
    }
  }

  /** 玩家点「挑战首领」：和自动挑战同一个效果，只是不看战力 */
  private challenge(): void {
    if (challengeBoss(this.deps.state, this.deps.balance)) {
      this.floats.spawn(WIDTH / 2, 300, '挑战首领!', TEXT.purple, 44)
    }
  }

  private switchTab(tab: Tab): void {
    this.tab = tab
    for (const [id, panel] of Object.entries(this.panels)) {
      if (id === tab) panel.show()
      else panel.hide()
    }
    this.tabBar.setActive(tab)
    this.refreshPanel()
  }

  private refreshPanel(): void {
    this.panels[this.tab].refresh(this.deps.state)
  }

  private openOffline(s: OfflineSummary): void {
    const cap = this.deps.balance.offline.capHours
    const lines: ModalSpec['lines'] = [
      { text: s.seconds >= cap * 3600 ? `离开超过 ${cap} 小时，按 ${cap} 小时算` : `离开了 ${Math.round(s.seconds / 60)} 分钟` },
      { text: `金币 +${s.gold}`, color: TEXT.gold },
      { text: `经验 +${s.exp}`, color: TEXT.green },
      { text: `装备 +${s.items} 件` },
    ]
    if (s.salvaged > 0) lines.push({ text: `其中 ${s.salvaged} 件背包满，已分解`, color: TEXT.gray })
    this.modal.open({
      kind: 'offline',
      title: '离线收益',
      lines,
      buttons: [{ label: '收下', fill: FILL.green, onTap: () => this.modal.close() }], // 收益早就加好了，收下只是关弹窗
    })
  }

  /** 重置存档：state 回到新存档、立刻存档、切回背包页第 1 页。这是画面层唯一直接改 state 的地方 */
  private resetSave(): void {
    const { state, balance, platform } = this.deps
    Object.assign(state, createState(balance, platform.now()))
    this.deps.save()
    this.hud.clearDrop()
    this.bagPanel.setPage(1)
    this.switchTab('bag')
    this.floats.spawn(WIDTH / 2, 300, '存档已重置', TEXT.white, 44)
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
