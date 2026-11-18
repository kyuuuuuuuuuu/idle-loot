import Phaser from 'phaser'
import balance from './data/balance.json'
import { grantOffline } from './logic/offline.ts'
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

// 2. 离线收益：直接加进 state，汇总交给场景弹窗
const offline = grantOffline(state, balance, rng, now)

// 3. 存档：定时存，切后台再存一次。下面立刻存一次，免得刚发的离线收益因为没存而下次又发一遍
const save = (): void => {
  state.lastSavedAt = platform.now()
  platform.storageSet(SAVE_KEY, serialize(state))
}
save()
platform.onHide(save)

// 4. 清晰度：高清屏上画布按 2 倍分辨率建（1440 × 2560），场景里镜头放大 2 倍，坐标照样按 720 × 1280 写
const zoom = platform.pixelRatio() >= 1.5 ? 2 : 1

const scene = new BattleScene({ state, balance, rng, platform, save, offline, zoom })

// 5. 切回前台（没刷新页面）也结算一次离线收益，按离开的时长算；结算完立刻存档，同一段时间不会发两次
platform.onShow(() => {
  const summary = grantOffline(state, balance, rng, platform.now())
  if (summary) save()
  scene.onResume(summary)
})
platform.exposeDebug({ getState: () => state, getUi: () => scene.uiState() })

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 720 * zoom,
  height: 1280 * zoom,
  backgroundColor: '#1e1f24',
  banner: false,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene,
})
