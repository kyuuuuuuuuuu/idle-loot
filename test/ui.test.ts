import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Balance, Item } from '../src/logic/types.ts'
import { describeItem, fmtDelta, itemTitle, statLines } from '../src/scenes/ui.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

// scenes/ui.ts 里这几个函数是纯格式化，不碰 Phaser（Phaser 只以 type 引入），所以 Node 里能直接测。
// 格式来自 design.md「背包页」「弹窗」，改格式时这里要跟着改。

test('ui: fmtDelta 变高带 +，变低用 U+2212 减号，不变不带符号', () => {
  assert.equal(fmtDelta(0.12), '+12.0%')
  assert.equal(fmtDelta(-0.05), '−5.0%')
  assert.equal(fmtDelta(0), '0.0%')
  assert.equal(fmtDelta(1.2663), '+126.6%')
})

test('ui: describeItem 第一行「[品质] 部位 Lv等级  主属性」，第二行是词缀，没有词缀写「无词缀」', () => {
  const epic: Item = { id: 1, slot: 'weapon', rarity: 2, level: 5, main: 17, affixes: [{ id: 'critRate', value: 0.05 }, { id: 'atkPct', value: 0.081 }] }
  assert.deepEqual(describeItem(balance, epic), ['[史诗] 武器 Lv5  攻击 +17', '暴击率 +5.0%  攻击% +8.1%'])
  const plain: Item = { id: 2, slot: 'amulet', rarity: 0, level: 1, main: 18, affixes: [] }
  assert.deepEqual(describeItem(balance, plain), ['[普通] 项链 Lv1  生命 +18', '无词缀'])
  assert.equal(itemTitle(balance, epic), '[史诗] 武器 Lv5')
  assert.deepEqual(statLines(epic), ['攻击 +17', '暴击率 +5.0%', '攻击% +8.1%'])
})
