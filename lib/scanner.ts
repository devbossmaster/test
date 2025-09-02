// lib/scanner.ts
import type { Address } from 'viem';
import { scanAdvancedSingleAndMulti } from './scanner_v2v3';
import { TOKENS, DEFAULT_UNIVERSE, loadUniverseFromAlchemy, type Token } from './tokens';

/** ---------- Public input shape you can call from your API route / UI ---------- */
export type ScanInput = {
  chain?: 'polygon' | 'mainnet';

  // Base token: if omitted, WMATIC on Polygon
  base?: { symbol?: keyof typeof TOKENS; address?: Address; decimals?: number };

  /** Universe options */
  csvUniverse?: string;          // e.g. "USDC,USDT,WETH,DAI"
  useAlchemyUniverse?: boolean;  // pull ~top100 Polygon tokens from Alchemy
  alchemyLimit?: number;         // default 100 when useAlchemyUniverse=true

  /** Sizing & fees */
  maxInBase?: number;            // human units, e.g. 5 (WMATIC)
  flashFeeBps?: number;          // default 9
  slippageBps?: number;          // per-leg; default 10 (0.10%)
  maxHops?: 2 | 3;               // default 3

  /** Gas (optional). If omitted we infer EIP-1559 inside the scanner */
  gasGwei?: number;
  priorityGwei?: number;

  /** Filters */
  onlyProfitable?: boolean;      // default true
  minNetBps?: number;            // >= 5 bps recommended
  minNetBase?: number;           // human units (e.g. 0.01 WMATIC)
  minBaseReserveRaw?: string;    // raw bigint string (legacy guard, optional)
  minBaseReserveUsd?: number;    // USD depth on base-side; requires pricing
  maxStaleSec?: number;

  /** DEX & routing */
  dexAllow?: string[];           // normalized V2 keys from dexConfigs
  bridges?: string[];            // e.g. ['USDC','WETH','DAI']
};

/** ---------- Helpers ---------- */
function lc(a: Address) {
  return (a as string).toLowerCase() as Address;
}

function toUnits(amountHuman: number | undefined, decimals: number): bigint {
  if (!amountHuman || amountHuman <= 0) return 0n;
  // Do this without floating precision issues: split integer / fraction parts
  const s = String(amountHuman);
  const [ints, fr = ''] = s.split('.');
  const frac = fr.slice(0, decimals); // trim extra precision
  const padded = frac.padEnd(decimals, '0');
  return BigInt(ints || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function parseCsvUniverse(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}

function dedupeByAddress(tokens: Token[]): Token[] {
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const t of tokens) {
    const k = (t.address as string).toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Build the quoteCandidates list from either:
 *  - Alchemy curated set (recommended), or
 *  - CSV of known symbols, or
 *  - Static DEFAULT_UNIVERSE fallback.
 */
async function buildUniverse(params: {
  useAlchemy: boolean;
  alchemyLimit?: number;
  csv?: string;
  base: Token;
}): Promise<Token[]> {
  if (params.useAlchemy) {
    // Pull ~top100 tokens (liquid set) and always include majors
    const alch = await loadUniverseFromAlchemy({
      limit: Math.max(1, Math.min(params.alchemyLimit ?? 100, 300)),
      alwaysInclude: ['WMATIC', 'USDC', 'USDT'],
    });
    // Exclude base itself for quotes
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

/** ---------- Main entry you call from routes/UI ---------- */
export async function runAdvancedScan(input: ScanInput) {
  const chain = input.chain ?? 'polygon';

  // Resolve base
  const base: Token = input.base?.address
    ? {
        symbol: input.base.symbol || 'BASE',
        address: input.base.address,
        decimals: input.base.decimals ?? 18,
      }
    : TOKENS[input.base?.symbol || 'WMATIC']; // default WMATIC on Polygon

  // Universe
  const quoteCandidates = await buildUniverse({
    useAlchemy: !!input.useAlchemyUniverse,
    alchemyLimit: input.alchemyLimit,
    csv: input.csvUniverse,
    base,
  });

  // Amount & filters
  const amountInBaseMax =
    toUnits(input.maxInBase ?? 5, base.decimals);      // default 5 base

  const minNetBase =
    input.minNetBase !== undefined
      ? toUnits(input.minNetBase, base.decimals)
      : undefined;

  const minBaseReserve =
    input.minBaseReserveRaw ? BigInt(input.minBaseReserveRaw) : undefined;

  // Gas (optional override)
  const gasPriceWei =
    typeof input.gasGwei === 'number'
      ? BigInt(Math.round(input.gasGwei * 1e9))
      : undefined;

  const priorityFeeWei =
    typeof input.priorityGwei === 'number'
      ? BigInt(Math.round(input.priorityGwei * 1e9))
      : undefined;

  // Bridges default
  const bridgeSymbols =
    (input.bridges && input.bridges.length ? input.bridges : ['USDC', 'WETH', 'DAI']);

  // Call the engine
  const res = await scanAdvancedSingleAndMulti({
    chain,
    base,
    quoteCandidates,
    amountInBaseMax,
    gasPriceWei,
    priorityFeeWei,
    flashFeeBps: input.flashFeeBps ?? 9,
    maxHops: input.maxHops ?? 3,
    maxSlippageBps: input.slippageBps ?? 10,
    onlyProfitable: input.onlyProfitable !== false, // default true
    minNetBase,
    minNetBps: input.minNetBps ?? undefined,
    dexAllow: input.dexAllow ?? undefined,
    minBaseReserve, // legacy raw guard
    minBaseReserveUsd: input.minBaseReserveUsd, // USD depth guard (scanner will price)
    maxStaleSec: input.maxStaleSec ?? 600,
    bridgeSymbols,
  });

  return res;
}

/** Optional small convenience for your API route:
 * Converts query params into ScanInput, calls runAdvancedScan, returns JSON.
 *
 * Example in /pages/api/scan-advanced.ts:
 *
 *   export default async function handler(req, res) {
 *     try {
 *       const data = await runAdvancedScan(fromQuery(req.query));
 *       res.status(200).json(data);
 *     } catch (e:any) {
 *       res.status(500).json({ error: e.message || 'scan failed' });
 *     }
 *   }
 */
export function fromQuery(q: Record<string, any>): ScanInput {
  const num = (x: any) => (x === undefined ? undefined : Number(x));
  const arr = (x: any) =>
    typeof x === 'string' && x.length
      ? x.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

  return {
    chain: (q.chain as any) || 'polygon',
    base: q.base
      ? { symbol: q.base.toUpperCase() as any }
      : undefined,
    csvUniverse: q.q, // same as your UI "Quote CSV (universe)"
    useAlchemyUniverse: q.useAlchemy === '1' || q.useAlchemy === 'true',
    alchemyLimit: num(q.alchemyLimit),
    maxInBase: num(q.maxInBase),
    gasGwei: num(q.gas),
    priorityGwei: num(q.priority),
    flashFeeBps: num(q.flashFeeBps),
    slippageBps: num(q.slippageBps),
    maxHops: q.maxHops ? Number(q.maxHops) as 2 | 3 : undefined,
    onlyProfitable: q.onlyProfitable !== '0',
    minNetBps: num(q.minNetBps),
    minNetBase: num(q.minNetBase),
    minBaseReserveRaw: q.minBaseReserveRaw,
    minBaseReserveUsd: num(q.minBaseReserveUsd),
    maxStaleSec: q.maxStaleSec ? Number(q.maxStaleSec) : undefined,
    dexAllow: arr(q.dexAllow),
    bridges: arr(q.bridges),
  };
}
