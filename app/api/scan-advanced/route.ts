// app/api/scan-advanced/route.ts  (or the file you call from your Advanced UI)
import { NextResponse } from 'next/server';
import { TOKENS } from '@/lib/tokens'; // keep for base token info
import { discoverTopTokensFromAlchemy } from '@/lib/tokenDiscovery';
import { scanAdvancedSingleAndMulti } from '@/lib/scanner_v2v3';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseSym = (searchParams.get('base') || 'WMATIC').toUpperCase();
  const amountInBase = BigInt((searchParams.get('maxIn') || '5')) * 10n ** 18n;

  // pull top ~120 tokens from Alchemy (no CMC)
  const universe = await discoverTopTokensFromAlchemy({
    blocksBack: 50_000, // ~2–3 days
    perPage: 1000,
    limit: 120,
  });

  const base = TOKENS[baseSym as keyof typeof TOKENS] || TOKENS.WMATIC;

  const res = await scanAdvancedSingleAndMulti({
    chain: 'polygon',
    base,
    quoteCandidates: universe.filter(t => t.address !== base.address),
    discoverAll: false,           // you already have dynamic universe
    amountInBaseMax: amountInBase,
    maxHops: 3,
    maxSlippageBps: 10,
    flashFeeBps: Number(searchParams.get('flashBps') || 9),
    onlyProfitable: true,
    minNetBps: 5,
    minNetBase: 10n**16n,         // 0.01 base
    minBaseReserveUsd: 10_000,    // optional; keeps noise down
    maxStaleSec: 600,
    bridgeSymbols: ['USDC','WETH','DAI'],
    // dexAllow: [...] // your V2 list if you want to restrict
  });

  return NextResponse.json({
    chainId: 137,
    ts: Math.floor(Date.now()/1000),
    blockNumber: null, // (optional) you can include getBlockNumber() here
    universeCount: universe.length,
    single: res.single,
    multi: res.multi,
  });
}
