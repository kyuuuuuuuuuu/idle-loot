// 打包：esbuild 把 src/main.ts 打成 dist/game.js（含 Phaser），index.html 原样拷过去。
// node scripts/build.mjs           打一次包
// node scripts/build.mjs --serve   在 0.0.0.0:8080 提供 dist/，改了 src 自动重建
import { context } from 'esbuild'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const dist = path('../dist')
mkdirSync(dist, { recursive: true })

const report = {
  name: 'report',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return
      copyFileSync(path('../index.html'), `${dist}/index.html`)
      console.log(`dist/game.js ${statSync(`${dist}/game.js`).size} bytes`)
    })
  },
}

const ctx = await context({
  entryPoints: [path('../src/main.ts')],
  outfile: `${dist}/game.js`,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: 'external',
  legalComments: 'none',
  logLevel: 'info',
  plugins: [report],
})

try {
  await ctx.rebuild() // --serve 也先完整打一次，保证 dist/index.html 在服务起来之前就在
} catch {
  process.exitCode = 1 // esbuild 已经把错误打印出来了
}

if (process.argv.includes('--serve') && !process.exitCode) {
  await ctx.watch()
  await ctx.serve({ host: '0.0.0.0', port: 8080, servedir: dist })
  console.log('serving dist/ on http://0.0.0.0:8080 (watching src/)')
} else {
  await ctx.dispose()
}
