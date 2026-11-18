// 平台层接口：网页和微信小游戏的差别（存档、时间、切后台事件、调试入口）都关在这里。
// 逻辑和画面只认这个接口；网页版实现在 web.ts，以后加 wx.ts 即可搬到微信。
export interface Platform {
  storageGet(key: string): string | null
  storageSet(key: string, value: string): void
  now(): number
  onHide(cb: () => void): void
  exposeDebug(api: { getState(): unknown }): void
}
