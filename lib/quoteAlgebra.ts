import type { Address, PublicClient } from 'viem';
import { ALGEBRA_QUOTER_ABI } from './abis/algebraQuoter';

export async function quoteAlgebraSingle(
  client: PublicClient,
  quoter: Address | undefined,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  limitSqrtPrice: bigint = 0n,
): Promise<bigint> {
  if (!quoter || amountIn === 0n) return 0n;
  try {
    const out = await client.readContract({
      address: quoter,
      abi: ALGEBRA_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [tokenIn, tokenOut, amountIn, limitSqrtPrice],
    });
    return BigInt(out as any);
  } catch {
    return 0n;
  }
}
