import type { Balance } from './types.ts'

/** 第 n 关 = wavesPerStage 波小怪 + 1 波首领；wave 从 1 数起 */
export function isBossWave(balance: Balance, wave: number): boolean {
  return wave === balance.stage.wavesPerStage + 1
}

/** 第 n 关第 wave 波有几只怪：小怪波 = base + floor((n−1) / every)，首领波只有首领 1 只 */
export function waveSize(balance: Balance, n: number, wave: number): number {
  if (isBossWave(balance, wave)) return 1
  return balance.stage.monstersPerWaveBase + Math.floor((n - 1) / balance.stage.monstersPerWaveEvery)
}

export function monsterHp(balance: Balance, n: number, isBoss: boolean): number {
  return balance.monster.hpBase * balance.monster.hpGrowth ** (n - 1) * (isBoss ? balance.boss.hpMult : 1)
}

export function monsterAtk(balance: Balance, n: number, isBoss: boolean): number {
  return balance.monster.atkBase * balance.monster.atkGrowth ** (n - 1) * (isBoss ? balance.boss.atkMult : 1)
}

/** 一只怪死后给的金币和经验（取整；首领乘 rewardMult 后再取整） */
export function killReward(balance: Balance, n: number, isBoss: boolean): { gold: number; exp: number } {
  const r = balance.rewards
  const mult = isBoss ? balance.boss.rewardMult : 1
  return {
    gold: Math.round(r.goldBase * r.goldGrowth ** (n - 1) * mult),
    exp: Math.round(r.expBase * r.expGrowth ** (n - 1) * mult),
  }
}
