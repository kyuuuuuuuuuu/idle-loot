import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isBossWave, killReward, monsterAtk, monsterHp, waveSize } from '../src/logic/stage.ts'
import type { Balance } from '../src/logic/types.ts'

const balance: Balance = JSON.parse(readFileSync(new URL('../src/data/balance.json', import.meta.url), 'utf8'))

test('stage: 第 n 关小怪的生命 = hpBase × hpGrowth^(n−1)，攻击同理', () => {
  assert.equal(monsterHp(balance, 1, false), 32)
  for (const n of [1, 2, 5, 10, 25]) {
    assert.equal(monsterHp(balance, n, false), 32 * 1.3 ** (n - 1))
    assert.equal(monsterAtk(balance, n, false), 4 * 1.22 ** (n - 1))
  }
})

test('stage: 每波怪数 = base + floor((n−1)/every)，测第 1、4、7 关', () => {
  assert.equal(waveSize(balance, 1, 1), 2)
  assert.equal(waveSize(balance, 4, 1), 3)
  assert.equal(waveSize(balance, 7, 1), 4)
  // 同一关里每个小怪波一样多
  assert.equal(waveSize(balance, 7, 3), 4)
})

test('stage: 第 wavesPerStage + 1 波是首领波，只有 1 只；首领倍率生效', () => {
  const boss = balance.stage.wavesPerStage + 1
  assert.equal(isBossWave(balance, boss), true)
  assert.equal(isBossWave(balance, boss - 1), false)
  assert.equal(waveSize(balance, 7, boss), 1)
  for (const n of [1, 3, 8]) {
    assert.equal(monsterHp(balance, n, true), monsterHp(balance, n, false) * balance.boss.hpMult)
    assert.equal(monsterAtk(balance, n, true), monsterAtk(balance, n, false) * balance.boss.atkMult)
  }
})

test('stage: 击杀奖励取整；首领乘 rewardMult 之后再取整', () => {
  assert.deepEqual(killReward(balance, 1, false), { gold: 3, exp: 5 })
  assert.deepEqual(killReward(balance, 3, false), { gold: 4, exp: 7 }) // 3.9675 → 4，7.2 → 7
  assert.deepEqual(killReward(balance, 1, true), { gold: 24, exp: 40 })
  assert.deepEqual(killReward(balance, 2, true), { gold: 28, exp: 48 }) // 3.45 × 8 = 27.6 → 28，不是 3 × 8
})
