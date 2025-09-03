// lib/scanner.ts
import type { Address } from 'viem';
import { scanAdvancedSingleAndMulti, type V2Dex, type V3Dex } from './scanner_v2v3';
import { TOKENS, DEFAULT_UNIVERSE, loadUniverseFromAlchemy, type Token } from './tokens';

// ⬇️ use your existing config exports
import { POLYGON_V2_DEXS } from '@/lib/dexConfigs';
import { V3_POLYGON, QS_V3_POLYGON } from '@/lib/dexV3Configs';

export type ScanInput = {
  chain?: 'polygon' | 'mainnet';
  base?: { symbol?: keyof typeof TOKENS; address?: Address; decimals?: number };

  csvUniverse?: string;
  useAlchemyUniverse?: boolean;
  alchemyLimit?: number;

  maxInBase?: number;
  flashFeeBps?: number;
  slippageBps?: number;
  maxHops?: 2 | 3 | 4;

  gasGwei?: number;
  priorityGwei?: number;

  onlyProfitable?: boolean;
  minNetBps?: number;
  minNetBase?: number;
  maxStaleSec?: number;

  dexAllow?: string[];
  bridges?: string[];
};

function lc(a: Address | string) { return (a as string).toLowerCase(); }

function toUnits(amountHuman: number | undefined, decimals: number): bigint {
  if (!amountHuman || amountHuman <= 0) return 0n;
  const s = String(amountHuman);
  const [ints, fr = ''] = s.split('.');
  const frac = fr.slice(0, decimals);
  const padded = frac.padEnd(decimals, '0');
  return BigInt(ints || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function parseCsvUniverse(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}

function dedupeByAddress(tokens: Token[]): Token[] {
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const t of tokens) {
    const k = lc(t.address);
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

async function buildUniverse(params: {
  useAlchemy: boolean;
  alchemyLimit?: number;
  csv?: string;
  base: Token;
}): Promise<Token[]> {
  if (params.useAlchemy) {
    const alch = await loadUniverseFromAlchemy({
      limit: Math.max(1, Math.min(params.alchemyLimit ?? 100, 300)),
      alwaysInclude: ['WMATIC', 'USDC', 'USDT'],
    });
    return alch.filter(t => lc(t.address) !== lc(params.base.address));
  }
  const csvSyms = parseCsvUniverse(params.csv);
  const syms = csvSyms.length ? csvSyms : DEFAULT_UNIVERSE;
  const acc: Token[] = [];
  for (const sym of syms) {
    const t = TOKENS[sym as keyof typeof TOKENS];
    if (t) acc.push(t);
  }
  const uniq = dedupeByAddress(acc);
  return uniq.filter(t => lc(t.address) !== lc(params.base.address));
}

export async function runAdvancedScan(input: ScanInput) {
  const chain = input.chain ?? 'polygon';

  const base: Token = input.base?.address
    ? {
        symbol: input.base.symbol || 'BASE',
        address: input.base.address,
        decimals: input.base.decimals ?? 18,
      }
    : TOKENS[input.base?.symbol || 'WMATIC'];

  const universe = await buildUniverse({
    useAlchemy: !!input.useAlchemyUniverse,
    alchemyLimit: input.alchemyLimit,
    csv: input.csvUniverse,
    base,
  });

  const amountInBaseMax = toUnits(input.maxInBase ?? 5, base.decimals);
  const minNetBase =
    input.minNetBase !== undefined ? toUnits(input.minNetBase, base.decimals) : undefined;

  const bridgeSymbols =
    input.bridges && input.bridges.length ? input.bridges : ['USDC', 'WETH', 'DAI'];

  // Map your repo configs -> scanner types
  const v2Dexes: V2Dex[] = POLYGON_V2_DEXS.map((d) => ({
    key: d.key,
    factory: d.factory as Address,
    feeBps: d.feeBps,
  }));
  const v3Dexes: V3Dex[] = [
    { key: V3_POLYGON.key,    quoter: V3_POLYGON.quoterV2 as Address,    feeTiers: V3_POLYGON.feeTiers },
    { key: QS_V3_POLYGON.key, quoter: QS_V3_POLYGON.quoterV2 as Address, feeTiers: QS_V3_POLYGON.feeTiers },
  ].filter(d => d.quoter.toLowerCase() !== "0x0000000000000000000000000000000000000000");

  const res = await scanAdvancedSingleAndMulti({
    chain,
    base,
    universe,
    amountInBaseMax,

    v2Dexes,
    v3Dexes,

    slippageBps: input.slippageBps ?? 10,
    flashFeeBps: input.flashFeeBps ?? 9,
    minNetBps: input.minNetBps ?? undefined,
    minNetBase,
    onlyProfitable: input.onlyProfitable !== false,
    maxHops: input.maxHops ?? 3,

    gasGwei: input.gasGwei,
    priorityGwei: input.priorityGwei,
    maxStaleSec: input.maxStaleSec ?? 600,

    bridgeSymbols,
    dexAllow: input.dexAllow ?? undefined,
  });

  return res;
}

export function fromQuery(q: Record<string, any>): ScanInput {
  const num = (x: any) => (x === undefined ? undefined : Number(x));
  const arr = (x: any) =>
    typeof x === 'string' && x.length
      ? x.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

  return {
    chain: (q.chain as any) || 'polygon',
    base: q.base ? { symbol: q.base.toUpperCase() as any } : undefined,
    csvUniverse: q.q,
    useAlchemyUniverse: q.useAlchemy === '1' || q.useAlchemy === 'true',
    alchemyLimit: num(q.alchemyLimit),
    maxInBase: num(q.maxInBase),
    gasGwei: num(q.gas),
    priorityGwei: num(q.priority),
    flashFeeBps: num(q.flashFeeBps),
    slippageBps: num(q.slippageBps),
    maxHops: q.maxHops ? (Number(q.maxHops) as 2 | 3 | 4) : undefined,
    onlyProfitable: q.onlyProfitable !== '0',
    minNetBps: num(q.minNetBps),
    minNetBase: num(q.minNetBase),
    maxStaleSec: q.maxStaleSec ? Number(q.maxStaleSec) : undefined,
    dexAllow: arr(q.dexAllow),
    bridges: arr(q.bridges),
  };
}
