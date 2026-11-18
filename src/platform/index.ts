// 平台层接口：网页和微信小游戏的差别（存档、时间、切后台和切回来的事件、设备像素比、调试入口）都关在这里。
// 逻辑和画面只认这个接口；网页版实现在 web.ts，以后加 wx.ts 即可搬到微信。
export interface Platform {
  storageGet(key: string): string | null
  storageSet(key: string, value: string): void
  now(): number
  /** 切到后台 */
  onHide(cb: () => void): void
  /** 切回前台（没刷新页面） */
  onShow(cb: () => void): void
  /** 设备像素比：高清屏 2、3，普通屏 1 */
  pixelRatio(): number
  exposeDebug(api: { getState(): unknown; getUi(): unknown }): void
}
