// lib/abis/algebraQuoter.ts
export const ALGEBRA_QUOTER_ABI = [
  // Very permissive typing to avoid TS ABI friction across Algebra forks
  {
    "inputs":[
      {"internalType":"address","name":"tokenIn","type":"address"},
      {"internalType":"address","name":"tokenOut","type":"address"},
      {"internalType":"uint256","name":"amountIn","type":"uint256"},
      {"internalType":"uint160","name":"limitSqrtPrice","type":"uint160"}
    ],
    "name":"quoteExactInputSingle",
    "outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],
    "stateMutability":"view",
    "type":"function"
  }
] as const;
