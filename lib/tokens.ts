// lib/tokens.ts
import type { Address } from 'viem';
import { getAlchemyTopTokensPolygon } from './tokenDiscovery';

export type Token = { symbol: string; address: Address; decimals: number };

// Static fallbacks (used only if Alchemy fails)
export const TOKENS: Record<string, Token> = {
  WMATIC: { symbol:'WMATIC', address:'0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals:18 },
  USDC:   { symbol:'USDC',   address:'0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals:6  },
  USDT:   { symbol:'USDT',   address:'0xc2132D05D31c914a87C6611C10748AaCbA11cA93', decimals:6  },
  WETH:   { symbol:'WETH',   address:'0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals:18 },
  DAI:    { symbol:'DAI',    address:'0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals:18 },
  WBTC:   { symbol:'WBTC',   address:'0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals:8  },
  LINK:   { symbol:'LINK',   address:'0x53E0bca35Ec356BD5ddDFebbD1Fc0fD03Fabad39', decimals:18 },
  AAVE:   { symbol:'AAVE',   address:'0xD6Df932A45C0f255f85145f286eA0b292B21C90B', decimals:18 },
  CRV:    { symbol:'CRV',    address:'0x172370d5Cd63279eFa6d502Dab29171933a610AF', decimals:18 },
  BAL:    { symbol:'BAL',    address:'0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3', decimals:18 },
  UNI:    { symbol:'UNI',    address:'0xb33EaAd8d922B1083446DC23f610c2567fB5180f', decimals:18 },
  SUSHI:  { symbol:'SUSHI',  address:'0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', decimals:18 },
};

export const DEFAULT_UNIVERSE = [
  'USDC','USDT','WETH','DAI','WBTC','LINK','AAVE','CRV','BAL','UNI','SUSHI',
] as const;

/**
 * Pure Alchemy-backed universe (no CMC). Always includes WMATIC/USDC/USDT.
 */
export async function loadUniverseFromAlchemy(
  opts?: { limit?: number; alwaysInclude?: (keyof typeof TOKENS)[] }
): Promise<Token[]> {
  const alwaysSyms = (opts?.alwaysInclude ?? ['WMATIC','USDC','USDT']) as (keyof typeof TOKENS)[];
  const always: Token[] = alwaysSyms.map((k) => TOKENS[k]);

  try {
    const tokens: Token[] = await getAlchemyTopTokensPolygon({
      limit: opts?.limit ?? 100,
    });

    // make sure pinned tokens are present
    const have = new Set<string>(tokens.map((t: Token) => (t.address as string).toLowerCase()));
    for (const must of always) {
      const key = (must.address as string).toLowerCase();
      if (!have.has(key)) tokens.unshift(must);
    }
    return tokens;
  } catch {
    // fallback to pinned + static majors
    const uniq = new Map<string, Token>();
    for (const t of always) uniq.set((t.address as string).toLowerCase(), t);
    for (const sym of DEFAULT_UNIVERSE) {
      const tok = TOKENS[sym];
      if (tok) uniq.set((tok.address as string).toLowerCase(), tok);
    }
    return Array.from(uniq.values());
  }
}
