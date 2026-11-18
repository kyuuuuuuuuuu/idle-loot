import Phaser from 'phaser'
import balance from './data/balance.json'
import { applyOffline, computeOffline } from './logic/offline.ts'
import { createRng } from './logic/rng.ts'
import { deserialize, SAVE_KEY, serialize } from './logic/save.ts'
import { createState } from './logic/types.ts'
import { createWebPlatform } from './platform/web.ts'
import { BattleScene } from './scenes/BattleScene.ts'

const platform = createWebPlatform()
const now = platform.now()
// logic 不读时钟，所以随机种子由入口取
const rng = createRng(now)

// 1. 读档，失败就开新档
const saved = platform.storageGet(SAVE_KEY)
const loaded = saved === null ? null : deserialize(saved)
if (saved !== null && loaded === null) console.warn('idle-loot: 存档读取失败（解析错误、版本不对或缺字段），开新档')
const state = loaded ?? createState(balance, now)

// 2. 离线收益
const offline = computeOffline(state, balance, rng, now)
const applied = applyOffline(state, balance, offline)
const offlineLine =
  offline.seconds > 0
    ? `离线 ${Math.round(offline.seconds / 60)} 分钟：金币 +${offline.gold + applied.salvageGold}，经验 +${offline.exp}，装备 +${offline.items.length}`
    : '离线收益：无'

// 3. 存档：定时存，切后台再存一次。下面立刻存一次，免得刚发的离线收益因为没存而下次又发一遍
const save = (): void => {
  state.lastSavedAt = platform.now()
  platform.storageSet(SAVE_KEY, serialize(state))
}
save()
platform.onHide(save)
platform.exposeDebug({ getState: () => state })

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 720,
  height: 1280,
  backgroundColor: '#1e1f24',
  banner: false,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: new BattleScene({ state, balance, rng, platform, save, offlineLine }),
})
