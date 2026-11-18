import type { Platform } from './index.ts'

// 全项目唯一直接碰 window / document / localStorage 的地方（scripts/ 和 index.html 除外）。
export function createWebPlatform(): Platform {
  return {
    // 隐私模式、禁用存储时访问 localStorage 会抛异常：读失败当作没有存档，写失败只打警告，都不崩
    storageGet(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    storageSet(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch (err) {
        console.warn('idle-loot: 存档写入失败', err)
      }
    },
    now: () => Date.now(),
    onHide(cb) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') cb()
      })
      window.addEventListener('pagehide', cb)
    },
    // 切回前台有两种：标签页重新可见；浏览器从"往返缓存"里把整页恢复出来（此时 visibilitychange 不一定触发）
    onShow(cb) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') cb()
      })
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) cb()
      })
    },
    pixelRatio: () => window.devicePixelRatio || 1,
    // 只有地址带 ?debug=1 才暴露，冒烟脚本靠它读状态和界面状态
    exposeDebug(api) {
      if (location.search.includes('debug=1')) {
        ;(window as unknown as Record<string, unknown>).__IDLE_LOOT__ = api
      }
    },
  }
}
