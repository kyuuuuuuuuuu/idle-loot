export interface Rng {
  /** [0, 1) */
  next(): number
  /** 整数，闭区间 [min, max] */
  int(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
}

// mulberry32：同一个种子永远给同一串数，模拟器和测试靠它复现结果。
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  }
}
