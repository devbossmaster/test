export type DexKey = 'quickswap_v2' | 'sushiswap_v2' | 'uniswap_v3' | 'quickswap_v3'

export type Opportunity = {
  base: `0x${string}`
  quote: `0x${string}`
  priceA: number
  priceB: number
  spreadPct: number
  dexA: DexKey
  dexB: DexKey
  poolA: `0x${string}`
  poolB: `0x${string}`
  updatedAt: number
}

// ---- graph/path types for multihop
export type Edge = {
  from: `0x${string}`
  to: `0x${string}`
  // discovery info
  kind: 'v2' | 'v3'
  dex: DexKey
  address: `0x${string}`          // pair/pool
  fee?: number                     // v3 fee tier if any
}

export type PathQuote = {
  path: Edge[]                     // sequence of edges (2..5)
  amountIn: bigint
  amountOut: bigint
  roiPct: number                   // (out-in)/in * 100
  gasUsd: number
  netUsd: number
}
