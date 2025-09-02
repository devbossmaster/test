import type { Address } from 'viem';

export type V3Config = {
  key: 'uniswap_v3' | 'quickswap_v3';
  label: string;
  quoterV2: Address;
  feeTiers: number[];
};

// Polygon — Uniswap V3
export const V3_POLYGON: V3Config = {
  key: 'uniswap_v3',
  label: 'Uniswap V3',
  quoterV2: (process.env.UNI_V3_QUOTER_POLYGON as Address) ?? '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  feeTiers: [100, 500, 3000, 10000],
};

// Mainnet fallback so imports don’t break (adjust if you use it)
export const V3_MAINNET: V3Config = {
  key: 'uniswap_v3',
  label: 'Uniswap V3 (Mainnet)',
  quoterV2: (process.env.UNI_V3_QUOTER_MAINNET as Address) ?? '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  feeTiers: [500, 3000, 10000],
};

// Polygon — QuickSwap V3 (Algebra)
export const QS_V3_POLYGON: V3Config = {
  key: 'quickswap_v3',
  label: 'QuickSwap V3 (Algebra)',
  quoterV2: (process.env.QS_V3_QUOTER_POLYGON as Address) ?? ('0x0000000000000000000000000000000000000000' as Address),
  // Algebra doesn’t use fee tiers, but we keep the shape consistent
  feeTiers: [100, 500, 3000, 10000],
};
