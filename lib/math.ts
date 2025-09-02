import { formatUnits } from 'viem';

export function getAmountOutV2({ amountIn, reserveIn, reserveOut, feeBps }:{
  amountIn: bigint; reserveIn: bigint; reserveOut: bigint; feeBps: number;
}): bigint {
  if (amountIn === 0n) return 0n;
  const den = 10_000n;
  const amountInWithFee = amountIn * (den - BigInt(feeBps)) / den;
  const num = amountInWithFee * reserveOut;
  const d   = reserveIn + amountInWithFee;
  return d === 0n ? 0n : num / d;
}

export function asNumber(x: bigint, decimals: number) { return Number(formatUnits(x, decimals)); }
