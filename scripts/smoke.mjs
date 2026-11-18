// 冒烟：无头浏览器打开 dist/，等 12 秒，看有没有报错、有没有打死怪。
// 只启动 playwright-core 自己的 chromium，不连任何已有的浏览器。先 npm run build。
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = join(root, 'dist')
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

const errors = []
const screenshot = join(root, '.smoke', 'smoke.png')
let kills = 0
let stage = 0
let browser
try {
  browser = await chromium.launch({ headless: true })
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
  mkdirSync(dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })
} catch (err) {
  errors.push(`smoke: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  await browser?.close()
  server.closeAllConnections()
  server.close()
}

console.log(JSON.stringify({ errors, kills, stage, screenshot }))
process.exit(errors.length > 0 || kills < 1 ? 1 : 0)
