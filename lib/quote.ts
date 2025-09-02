import type { Address, PublicClient } from 'viem';
import { QUOTER_V2_ABI } from './abis/v3';
import type { V2Dex } from './dexConfigs';

// V2 math (classic x*y=k)
export function getAmountOutV2(
  p: { amountIn: bigint; reserveIn: bigint; reserveOut: bigint; feeBps: number }
): bigint {
  if (p.amountIn === 0n || p.reserveIn === 0n || p.reserveOut === 0n) return 0n;
  const feeDen = 10_000n;
  const amountInWithFee = p.amountIn * BigInt(feeDen - BigInt(p.feeBps));
  const numerator = amountInWithFee * p.reserveOut;
  const denominator = (p.reserveIn * feeDen) + amountInWithFee;
  return numerator / denominator;
}

export type V2PoolShape = {
  dex: V2Dex;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
};

export function quoteV2Single(
  pool: V2PoolShape,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint
): bigint {
  const isToken0In = pool.token0.toLowerCase() === tokenIn.toLowerCase();
  const reserveIn  = isToken0In ? pool.reserve0 : pool.reserve1;
  const reserveOut = isToken0In ? pool.reserve1 : pool.reserve0;
  return getAmountOutV2({ amountIn, reserveIn, reserveOut, feeBps: pool.dex.feeBps });
}

export async function quoteV3Single(
  client: PublicClient,
  v3: { quoterV2: Address; feeTiers: number[] },
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  amountIn: bigint,
  sqrtPriceLimitX96: bigint = 0n,
): Promise<bigint> {
  if (!v3.quoterV2 || amountIn === 0n) return 0n;
  try {
    const out = await client.readContract({
      address: v3.quoterV2,
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      args: [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
    });
    return BigInt(out as any);
  } catch {
    return 0n;
  }
}
