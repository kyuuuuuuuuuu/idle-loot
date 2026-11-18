// 冒烟：无头浏览器打开 dist/，两个场景。
//  A 战斗：等 12 秒，看有没有报错、有没有打死怪。
//  B 界面：像素比 3 的手机（走 zoom = 2 那条路，和 OPPO 一样），载入一份预置存档，把离线弹窗、换装、技能顺序、
//    挑战首领、重置存档逐项点一遍，每项是一条有名字的检查；前一项失败后面照跑。
// 只启动 playwright-core 自己的 chromium，不连任何已有的浏览器。先 npm run build。
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'dist')
const balance = JSON.parse(readFileSync(join(root, 'src', 'data', 'balance.json'), 'utf8'))
const wavesPerStage = balance.stage.wavesPerStage
if (!existsSync(join(dist, 'game.js'))) {
  console.error('dist/game.js 不存在：先跑 npm run build')
  process.exit(1)
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json' }
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const file = join(dist, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

// 界面场景用到的坐标都是 design.md「界面」里的逻辑坐标（720 × 1280）
const TAB_Y = 1235 // 标签栏 1190–1280 的中线；背包、技能、设置三个标签的中心 x 是 120、360、600
const MODAL_BTN_Y = 981 // 弹窗按钮行：y 937–1025
const ROW0_Y = 941 // 背包列表第 1 行（y 908–974）的中线，每行下移 70
const SKILL_DOWN_X = 664 // 技能页第 1 行的「↓」：x 620–708、y 719–807
const SKILL_DOWN_Y = 763
const CHALLENGE = [610, 624] // 「挑战首领」：x 520–700、y 588–660
const RESET = [360, 1104] // 「重置存档」：x 210–510、y 1060–1148

async function runUiScene(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`ui pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`ui console: ${m.text()}`)
  })

  // 1. 预置存档：version 2，等级 1、金币 1000、身上全空；背包两件；离开 10 分钟（所以一开场就有离线弹窗）
  const save = {
    version: 2,
    hero: { level: 1, exp: 0, hp: balance.hero.hpBase },
    gold: 1000,
    bag: [
      { id: 101, slot: 'weapon', rarity: 2, level: 5, main: 17, affixes: [{ id: 'critRate', value: 0.05 }] },
      { id: 102, slot: 'ring', rarity: 0, level: 1, main: 2, affixes: [] },
    ],
    nextItemId: 103,
    equipped: { weapon: null, ring: null, armor: null, amulet: null },
    enhance: { weapon: 0, ring: 0, armor: 0, amulet: 0 },
    skillOrder: balance.skills.defaultOrder,
    stage: 1,
    farming: false,
    failPower: 0,
    totalKills: 0,
    deaths: 0,
    rate: { curMs: 0, buckets: [{ gold: 0, exp: 0, kills: 0 }] },
    lastSavedAt: Date.now() - 10 * 60 * 1000,
  }
  await context.addInitScript((json) => localStorage.setItem('idle-loot-save', json), JSON.stringify(save))
  await page.goto(`http://127.0.0.1:${port}/?debug=1`)

  const getState = () => page.evaluate(() => window.__IDLE_LOOT__.getState())
  const getUi = () => page.evaluate(() => window.__IDLE_LOOT__.getUi())
  const shot = async (name) => {
    const path = join(root, '.smoke', name)
    await page.screenshot({ path })
    screenshots.push(path)
  }

  // 逻辑坐标 (X, Y) → 网页坐标：画布按宽度缩放，s = 画布网页宽度 / 720
  const tap = async (X, Y, how) => {
    const r = await page.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect()
      return { left: c.left, top: c.top, width: c.width }
    })
    const s = r.width / 720
    const x = r.left + X * s
    const y = r.top + Y * s
    if (how === 'mouse') await page.mouse.click(x, y)
    else await page.touchscreen.tap(x, y)
    await page.waitForTimeout(300)
  }
  // 先用触摸点；点完 done() 还不成立（状态没变），就改用鼠标再点一次，并记一笔
  const tapUntil = async (X, Y, done) => {
    await tap(X, Y, 'touch')
    if (await done()) return
    mouseFallbacks++
    await tap(X, Y, 'mouse')
  }
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }
  const check = async (name, fn) => {
    try {
      await fn()
      ui.passed.push(name)
    } catch (err) {
      ui.failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 2. 离线弹窗：开场就在，金币已经加上；点「收下」关掉
  await check('offline-modal', async () => {
    await page.waitForTimeout(1500)
    expect((await getUi()).modal === 'offline', `打开后 modal = ${(await getUi()).modal}`)
    expect((await getState()).gold > 1000, '离线金币没有加进 state')
    await shot('ui-offline.png')
    await tapUntil(360, MODAL_BTN_Y, async () => (await getUi()).modal === null)
    expect((await getUi()).modal === null, '点「收下」后弹窗还在')
  })

  // 3. 换装：点背包里 101 那一行 → 装备弹窗 → 「换上」
  await check('equip', async () => {
    const { rows } = await getUi()
    const i = rows.indexOf(101)
    expect(i >= 0, `rows = ${JSON.stringify(rows)}，里面没有 101`)
    await tapUntil(360, ROW0_Y + 70 * i, async () => (await getUi()).modal === 'item')
    expect((await getUi()).modal === 'item', `点第 ${i + 1} 行后 modal = ${(await getUi()).modal}`)
    await shot('ui-item.png')
    await tapUntil(150, MODAL_BTN_Y, async () => (await getState()).equipped.weapon?.id === 101)
    expect((await getState()).equipped.weapon?.id === 101, '点「换上」后身上的武器不是 101')
    expect((await getUi()).modal === null, '换上后弹窗没关')
    await shot('ui-bag.png')
  })

  // 4. 技能顺序：技能页第 1 行的「↓」，前两个对调
  await check('skill-order', async () => {
    await tapUntil(360, TAB_Y, async () => (await getUi()).tab === 'skill')
    expect((await getUi()).tab === 'skill', '点「技能」标签后没切过去')
    const before = (await getState()).skills.order
    await tapUntil(SKILL_DOWN_X, SKILL_DOWN_Y, async () => (await getState()).skills.order[0] !== before[0])
    const after = (await getState()).skills.order
    expect(
      after[0] === before[1] && after[1] === before[0],
      `顺序 ${before.join()} → ${after.join()}，前两个没对调`,
    )
    await shot('ui-skill.png')
  })

  // 5. 挑战首领：从外面把状态改成"刷怪中、门槛极高"，点按钮应立刻退出刷怪、进首领波
  await check('challenge', async () => {
    await page.evaluate(() => {
      const st = window.__IDLE_LOOT__.getState().stage
      st.farming = true
      st.failPower = 1e12
    })
    await page.waitForTimeout(600)
    await shot('ui-farming.png') // 刷怪中：顶栏写"刷怪中"，右下角出现「挑战首领」和小字
    await tapUntil(CHALLENGE[0], CHALLENGE[1], async () => (await getState()).stage.farming === false)
    const st = (await getState()).stage
    expect(st.farming === false, `点「挑战首领」后 farming = ${st.farming}`)
    expect(st.wave === wavesPerStage + 1, `wave = ${st.wave}，应该是首领波 ${wavesPerStage + 1}`)
  })

  // 6. 重置存档：第一次点只是确认，1 秒内再点才重置
  await check('reset', async () => {
    await tapUntil(600, TAB_Y, async () => (await getUi()).tab === 'settings')
    expect((await getUi()).tab === 'settings', '点「设置」标签后没切过去')
    await shot('ui-settings.png')
    await tap(RESET[0], RESET[1], 'touch')
    expect((await getState()).equipped.weapon?.id === 101, '只点一次就重置了，或者武器丢了')
    await tapUntil(RESET[0], RESET[1], async () => (await getState()).equipped.weapon === null)
    expect((await getState()).equipped.weapon === null, '再点一次后身上的武器还在')
    expect((await getUi()).tab === 'bag', `重置后 tab = ${(await getUi()).tab}，应该切回背包`)
  })

  await context.close()
}

const errors = []
const screenshot = join(root, '.smoke', 'smoke.png')
let kills = 0
let stage = 0
const ui = { passed: [], failed: [] }
const screenshots = [screenshot]
let mouseFallbacks = 0
let browser
try {
  browser = await chromium.launch({ headless: true })
  mkdirSync(dirname(screenshot), { recursive: true })

  // ---------- 场景 A：战斗 ----------
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.goto(`http://127.0.0.1:${port}/?debug=1`)
  await page.waitForTimeout(12000)
  const state = await page.evaluate(() => window.__IDLE_LOOT__?.getState())
  if (!state) errors.push('window.__IDLE_LOOT__ 不存在（debug=1 没生效或游戏没启动）')
  kills = state?.totalKills ?? 0
  stage = state?.stage?.n ?? 0
  await page.screenshot({ path: screenshot })
  await page.close()

  // ---------- 场景 B：界面 ----------
  await runUiScene(browser)
} catch (err) {
  errors.push(`smoke: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  await browser?.close()
  server.closeAllConnections()
  server.close()
}

console.log(JSON.stringify({ errors, kills, stage, screenshot, ui, screenshots, mouseFallbacks }))
process.exit(errors.length > 0 || kills < 1 || ui.failed.length > 0 ? 1 : 0)
