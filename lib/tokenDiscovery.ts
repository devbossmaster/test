// lib/tokenDiscovery.ts
import type { Address } from 'viem';

export type Token = { symbol: string; address: Address; decimals: number };

export const PINNED: Token[] = [
  { symbol:'WMATIC', address:'0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals:18 },
  { symbol:'USDC',   address:'0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals:6  },
  { symbol:'USDT',   address:'0xc2132D05D31c914a87C6611C10748AaCbA11cA93', decimals:6  },
];

/** Accepts either a full URL or a bare key and returns a valid Polygon Alchemy URL. */
function normalizeAlchemyUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  // assume it's a key
  return `https://polygon-mainnet.g.alchemy.com/v2/${v}`;
}

const ALCHEMY_URL =
  normalizeAlchemyUrl(process.env.ALCHEMY_POLYGON_URL) ||
  normalizeAlchemyUrl(process.env.NEXT_PUBLIC_ALCHEMY_POLYGON_URL) ||
  normalizeAlchemyUrl(process.env.ALCHEMY_KEY as any) || // optional generic key env
  '';

type AssetTransfer = {
  rawContract?: { address?: string };
  contract?: { address?: string };
};

async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  if (!ALCHEMY_URL) throw new Error('Missing ALCHEMY_POLYGON_URL / NEXT_PUBLIC_ALCHEMY_POLYGON_URL / ALCHEMY_KEY');
  const r = await fetch(ALCHEMY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Alchemy RPC error ${r.status}: ${txt}`);
  }
  const j = await r.json();
  if (j?.error) throw new Error(j.error.message || 'alchemy rpc error');
  return j.result as T;
}

const toHex = (n: bigint) => '0x' + n.toString(16);

// popular v2 routers on Polygon (extend if you want)
const ROUTERS = [
  '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // QuickSwap V2
  '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506', // Sushi V2
  '0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607', // ApeSwap V2
].map(a => a.toLowerCase());

export async function discoverTopTokensFromAlchemy(opts?: {
  blocksBack?: number;
  perPage?: number;
  limit?: number;
}): Promise<Token[]> {
  const blocksBack = Math.max(1000, opts?.blocksBack ?? 50_000);
  const perPage = Math.min(1000, Math.max(100, opts?.perPage ?? 1000));
  const limit = Math.max(25, Math.min(500, opts?.limit ?? 120));

  const latestHex: string = await rpc('eth_blockNumber', []);
  const latest = BigInt(latestHex);
  const fromHex = toHex(latest - BigInt(blocksBack));

  const counts = new Map<string, number>();

  const pull = async (direction: 'fromAddress' | 'toAddress', who: string) => {
    let pageKey: string | undefined;
    for (let i = 0; i < 10; i++) {
      const params: any = [{
        category: ['erc20'],
        withMetadata: false,
        maxCount: '0x' + perPage.toString(16),
        fromBlock: fromHex,
        toBlock: 'latest',
        [direction]: who,
      }];
      if (pageKey) params[0].pageKey = pageKey;

      const res = await rpc<{ transfers: AssetTransfer[]; pageKey?: string }>(
        'alchemy_getAssetTransfers',
        params
      );

      for (const t of res.transfers || []) {
        const addr = (t.rawContract?.address || t.contract?.address || '').toLowerCase();
        if (!addr) continue;
        counts.set(addr, (counts.get(addr) || 0) + 1);
      }
      if (!res.pageKey) break;
      pageKey = res.pageKey;
    }
  };

  for (const r of ROUTERS) {
    await pull('fromAddress', r);
    await pull('toAddress', r);
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2)
    .map(([addr]) => addr);

  const metas = await Promise.all(
    ranked.map(async (addr): Promise<Token> => {
      try {
        const md = await rpc<any>('alchemy_getTokenMetadata', [addr]);
        return {
          symbol: (md?.symbol || 'TOK').toString(),
          address: addr as Address,
          decimals: Number(md?.decimals ?? 18),
        };
      } catch {
        return { symbol:'TOK', address: addr as Address, decimals:18 };
      }
    })
  );

  const uniq = new Map<string, Token>();
  for (const tok of metas) {
    const k = (tok.address as string).toLowerCase();
    if (!uniq.has(k)) uniq.set(k, tok);
  }
  for (const p of PINNED) {
    const k = (p.address as string).toLowerCase();
    if (!uniq.has(k)) uniq.set(k, p);
  }

  return [...uniq.values()].slice(0, limit);
}

// ---- Compatibility export so existing imports keep working ----
export async function getAlchemyTopTokensPolygon(opts?: {
  blocksBack?: number; perPage?: number; limit?: number
}): Promise<Token[]> {
  return discoverTopTokensFromAlchemy(opts);
}
