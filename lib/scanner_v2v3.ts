import { getPublicClient } from './viemClient';
import type { SupportedChain } from './viemClient';
import type { Address, PublicClient } from 'viem';
import { V2_FACTORY_ABI, V2_PAIR_ABI } from './abis/v2';
import { V2_FACTORY_EVENT_ABI, ERC20_ABI_MIN } from './abis/common';
import { POLYGON_V2_DEXS } from './dexConfigs';
import { V3_POLYGON, QS_V3_POLYGON } from './dexV3Configs';
import { quoteV2Single, quoteV3Single } from './quote';
import { quoteAlgebraSingle } from './quoteAlgebra';
import { buildKHopPaths, simulatePathWithSlippage, type Edge } from './graph';
// NEW (dynamic discovery)

export type Token = { symbol: string; address: Address; decimals: number };

export type AdvancedScanCfg = {
  chain?: SupportedChain;
  base: Token;
  quoteCandidates?: Token[];
  discoverAll?: boolean;
  maxDiscover?: number;
  amountInBaseMax: bigint;
  gasPriceWei?: bigint;
  priorityFeeWei?: bigint;
  flashFeeBps: number;
  maxHops?: 2 | 3;
  maxSlippageBps?: number;
  onlyProfitable?: boolean;
  minNetBase?: bigint;
  minNetBps?: number;
  dexAllow?: string[];
  minBaseReserve?: bigint;
  minBaseReserveUsd?: number;   // USD screen for base-side pool depth
  maxStaleSec?: number;
  bridgeSymbols?: string[];
  discoverWindowBlocks?: number;
};

// helpers
const DEN = 10_000n;
const toBps = (num: bigint, deno: bigint) => Number((num * 10_000n) / (deno || 1n));
const lc = (a: Address) => a.toLowerCase() as Address;

type V2Pool = {
  dexKey: string; token0: Address; token1: Address;
  reserve0: bigint; reserve1: bigint; feeBps: number; ts: number;
};

// -------- discovery via V2 PairCreated logs ----------
async function discoverTokensV2(
  client: PublicClient,
  factories: { key:string; factory: Address }[],
  base: Token,
  max: number,
  windowBlocks: number
): Promise<Token[]> {
  const set = new Map<string, Token>();
  set.set(lc(base.address), base);

  const latest = await client.getBlockNumber();
  const from = latest > BigInt(windowBlocks) ? latest - BigInt(windowBlocks) : 0n;

  for (const f of factories) {
    try {
      const logs = await client.getLogs({
        address: f.factory,
        fromBlock: from,
        toBlock: latest,
        events: V2_FACTORY_EVENT_ABI,
      });
      for (const lg of logs) {
        const t0 = lc((lg as any).args.token0 as Address);
        const t1 = lc((lg as any).args.token1 as Address);
        if (!set.has(t0)) set.set(t0, { symbol: 'T0', address: t0, decimals: 18 } as Token);
        if (!set.has(t1)) set.set(t1, { symbol: 'T1', address: t1, decimals: 18 } as Token);
        if (set.size >= max) break;
      }
    } catch { /* ignore */ }
    if (set.size >= max) break;
  }

  // fetch decimals + symbol (best effort)
  const entries = Array.from(set.values()).slice(0, Math.min(set.size, max));
  await Promise.all(entries.map(async (t, i) => {
    try {
      const [dec, sym] = await Promise.all([
        client.readContract({ address: t.address, abi: ERC20_ABI_MIN, functionName: 'decimals' }).catch(()=>18),
        client.readContract({ address: t.address, abi: ERC20_ABI_MIN, functionName: 'symbol'   }).catch(()=>`TOK${i}`),
      ]);
      t.decimals = Number(dec as number ?? 18);
      t.symbol = String(sym ?? `TOK${i}`);
    } catch { /* keep defaults */ }
  }));

  return entries;
}

// ------- tiny USDC price for base, then USD screen -------
async function priceBaseInUSDC(
  client: PublicClient,
  base: Token,
  usdc: Token,
  v3s: { cfg: { quoterV2?: Address; feeTiers: number[] }, kind: 'univ3'|'algebra' }[],
  v2BestOut: (a: Address, b: Address, amt: bigint)=>bigint
): Promise<number> {
  const tiny = 10n ** BigInt(Math.max(0, base.decimals - 6)); // ~1e-6 base
  let out: bigint = 0n;

  for (const v of v3s) {
    const outs: bigint[] = await Promise.all(v.cfg.feeTiers.map(async ft => {
      if (v.kind === 'univ3') {
        return await quoteV3Single(client, { quoterV2: v.cfg.quoterV2!, feeTiers:[ft] }, base.address, usdc.address, ft, tiny);
      } else {
        return await quoteAlgebraSingle(client, v.cfg.quoterV2, base.address, usdc.address, tiny);
      }
    }));
    const best = outs.reduce<bigint>((a,b)=> a>b ? a : b, 0n);
    if (best > out) out = best;
  }

  if (out === 0n) out = v2BestOut(base.address, usdc.address, tiny);
  if (out === 0n) return 0;

  const outFloat = Number(out) / Number(10n ** BigInt(usdc.decimals));
  const inFloat  = Number(tiny) / Number(10n ** BigInt(base.decimals));
  return outFloat / inFloat; // USDC per 1 base
}

// ------- Golden-section optimizer (bigint-safe) -------
async function maximizeOverSize(
  f: (x: bigint)=>Promise<bigint>,
  lo: bigint,
  hi: bigint,
  iters = 12
): Promise<{ size: bigint; value: bigint }> {
  if (hi <= lo) return { size: lo, value: await f(lo) };
  const SCALE = 1_000_000_000n;
  const R = 618_033_989n; // ~0.618 * 1e9

  let a = lo, b = hi;
  let x1 = a + ((b - a) * (SCALE - R)) / SCALE;
  let x2 = a + ((b - a) * R) / SCALE;
  let f1 = await f(x1);
  let f2 = await f(x2);

  for (let i = 0; i < iters; i++) {
    if (f1 < f2) {
      a = x1; x1 = x2; f1 = f2;
      x2 = a + ((b - a) * R) / SCALE;
      f2 = await f(x2);
    } else {
      b = x2; x2 = x1; f2 = f1;
      x1 = a + ((b - a) * (SCALE - R)) / SCALE;
      f1 = await f(x1);
    }
  }
  return (f1 > f2) ? { size:x1, value:f1 } : { size:x2, value:f2 };
}

// ================== MAIN SCANNER =========================
export async function scanAdvancedSingleAndMulti(cfg: AdvancedScanCfg) {
  const chain = cfg.chain ?? 'polygon';
  const client = getPublicClient(chain);

  const uniV3 = V3_POLYGON;
  const qsV3  = QS_V3_POLYGON.quoterV2 !== ('0x0000000000000000000000000000000000000000' as Address)
              ? QS_V3_POLYGON : undefined;

  // EIP-1559 gas (fallback ~30 + 3 gwei)
  let gasPriceWei = cfg.gasPriceWei;
  if (!gasPriceWei) {
    const blk = await client.getBlock();
    const base = blk.baseFeePerGas ?? 30_000_000_000n;
    const tip  = cfg.priorityFeeWei ?? 3_000_000_000n;
    gasPriceWei = base + tip;
  }

  // V2 allowlist
  let v2Dexes = POLYGON_V2_DEXS;
  if (cfg.dexAllow?.length) {
    const allow = new Set(cfg.dexAllow.map(s => s.toLowerCase()));
    v2Dexes = v2Dexes.filter(d => allow.has(d.key.toLowerCase()));
  }

  // Token universe (manual + discovery)
  let universe: Token[] = [cfg.base, ...(cfg.quoteCandidates ?? [])];
  if (cfg.discoverAll) {
    const discovered = await discoverTokensV2(
      client,
      v2Dexes.map(d => ({ key:d.key, factory:d.factory })),
      cfg.base,
      Math.max(25, Math.min(cfg.maxDiscover ?? 250, 1000)),
      cfg.discoverWindowBlocks ?? 500_000
    );
    const seen = new Set(universe.map(t => lc(t.address)));
    for (const t of discovered) {
      const key = lc(t.address);
      if (!seen.has(key)) { universe.push(t); seen.add(key); }
    }
  }

  // Build unordered pairs for V2 probes
  const addrLc = (a: Address) => a.toLowerCase();
  const unorderedPairs: [Token, Token][] = [];
  for (let i = 0; i < universe.length; i++) {
    for (let j = i + 1; j < universe.length; j++) unorderedPairs.push([universe[i], universe[j]]);
  }

  // ---- V2 pair map
  const v2Pools: Record<string, V2Pool[]> = {};
  const pairCalls: any[] = []; const meta: any[] = [];
  for (const dex of v2Dexes) for (const [A,B] of unorderedPairs) {
    const t0 = addrLc(A.address) < addrLc(B.address) ? A.address : B.address;
    const t1 = (t0 === A.address) ? B.address : A.address;
    pairCalls.push({ address: dex.factory, abi: V2_FACTORY_ABI, functionName: 'getPair', args: [t0, t1] });
    meta.push({ dex, t0, t1 });
  }

  const pairRes = await client.multicall({ allowFailure: true, contracts: pairCalls });
  const havePairs: { addr: Address; dexKey: string; t0: Address; t1: Address }[] = [];
  pairRes.forEach((r,i) => {
    if (r?.status === 'success' && r.result !== '0x0000000000000000000000000000000000000000') {
      havePairs.push({ addr: r.result as Address, dexKey: meta[i].dex.key, t0: meta[i].t0, t1: meta[i].t1 });
    }
  });

  const reads = await Promise.all(havePairs.map(n => Promise.all([
    client.readContract({ address: n.addr, abi: V2_PAIR_ABI, functionName: 'token0' }),
    client.readContract({ address: n.addr, abi: V2_PAIR_ABI, functionName: 'token1' }),
    client.readContract({ address: n.addr, abi: V2_PAIR_ABI, functionName: 'getReserves' }),
  ])));

  reads.forEach((rr,i) => {
    const token0 = rr[0] as Address, token1 = rr[1] as Address; const g = rr[2] as any;
    const key = `${token0}-${token1}`.toLowerCase();
    const pool: V2Pool = {
      dexKey: havePairs[i].dexKey,
      token0, token1,
      reserve0: BigInt(g[0]), reserve1: BigInt(g[1]),
      ts: Number(g[2]), feeBps: 30
    };
    (v2Pools[key] = v2Pools[key] || []).push(pool);
  });

  // staleness filter
  if (cfg.maxStaleSec && cfg.maxStaleSec > 0) {
    const nowSec = Math.floor(Date.now()/1000);
    for (const k of Object.keys(v2Pools)) {
      v2Pools[k] = v2Pools[k].filter(p => (nowSec - p.ts) <= cfg.maxStaleSec!);
      if (!v2Pools[k].length) delete v2Pools[k];
    }
  }

  // v2 best-of helper + optional base-side reserve
  const minBaseReserve = cfg.minBaseReserve ?? 0n;
  function bestV2Out(inToken: Address, outToken: Address, amt: bigint): bigint {
    const key1 = `${inToken}-${outToken}`.toLowerCase();
    const key2 = `${outToken}-${inToken}`.toLowerCase();
    const pools = [...(v2Pools[key1]||[]), ...(v2Pools[key2]||[])];
    let best = 0n;
    for (const p of pools) {
      const isBaseSide = addrLc(inToken) === addrLc(cfg.base.address) || addrLc(outToken) === addrLc(cfg.base.address);
      if (isBaseSide && minBaseReserve > 0n) {
        const baseReserve = addrLc(cfg.base.address) === addrLc(p.token0) ? p.reserve0
                           : addrLc(cfg.base.address) === addrLc(p.token1) ? p.reserve1 : 0n;
        if (baseReserve && baseReserve < minBaseReserve) continue;
      }
      const out = quoteV2Single(
        { dex:{ key:p.dexKey, label:p.dexKey, factory:'0x0000000000000000000000000000000000000000' as Address, feeBps:p.feeBps }, token0:p.token0, token1:p.token1, reserve0:p.reserve0, reserve1:p.reserve1 },
        inToken, outToken, amt
      );
      if (out > best) best = out;
    }
    return best;
  }

  // USD depth screen on base-side pools (optional but recommended)
  let minUsdOK: (p: V2Pool) => boolean = () => true;
  if (cfg.minBaseReserveUsd && cfg.minBaseReserveUsd > 0) {
    const USDC =
      universe.find(t => t.symbol.toUpperCase().includes('USDC')) ??
      { symbol:'USDC', address:'0x2791bca1f2de4661ed88a30c99a7a9449aa84174' as Address, decimals:6 };

    const priceBaseUsd = await priceBaseInUSDC(
      client, cfg.base, USDC,
      [
        { cfg: uniV3, kind:'univ3' as const },
        ...(qsV3 ? [{ cfg: qsV3, kind:'algebra' as const }] : [])
      ],
      bestV2Out
    );

    minUsdOK = (p: V2Pool) => {
      const baseReserve = addrLc(cfg.base.address) === addrLc(p.token0) ? p.reserve0
                        : addrLc(cfg.base.address) === addrLc(p.token1) ? p.reserve1 : 0n;
      if (baseReserve === 0n) return true; // not a base pool
      const baseUnits = Number(baseReserve) / Number(10n ** BigInt(cfg.base.decimals));
      const usd = baseUnits * priceBaseUsd;
      return usd >= cfg.minBaseReserveUsd!;
    };

    for (const k of Object.keys(v2Pools)) {
      v2Pools[k] = v2Pools[k].filter(minUsdOK);
      if (!v2Pools[k].length) delete v2Pools[k];
    }
  }

  // ---- Single-hop scanning (with optimizer)
  const gasUnitsTwoLeg = 350_000n;
  const slippageBps = cfg.maxSlippageBps ?? 10;
  const flashFeeBps = BigInt(cfg.flashFeeBps);

  async function bestNetForMix(q: Token, buy: 'v2'|'v3u'|'v3q', size: bigint): Promise<bigint> {
    let qOut: bigint = 0n;
    if (buy === 'v2') {
      qOut = bestV2Out(cfg.base.address, q.address, size);
    } else if (buy === 'v3u') {
      const outs: bigint[] = await Promise.all(uniV3.feeTiers.map((f)=>quoteV3Single(client, uniV3, cfg.base.address, q.address, f, size)));
      qOut = outs.reduce<bigint>((a,b)=>a>b?a:b, 0n);
    } else {
      const out = await quoteAlgebraSingle(client, QS_V3_POLYGON.quoterV2, cfg.base.address, q.address, size);
      qOut = out;
    }
    qOut -= (qOut * BigInt(slippageBps)) / DEN;

    const sellCandidates: Array<Promise<bigint>> = [];
    sellCandidates.push(Promise.resolve(bestV2Out(q.address, cfg.base.address, qOut)));
    sellCandidates.push((async ()=> {
      const outs: bigint[] = await Promise.all(uniV3.feeTiers.map((f)=>quoteV3Single(client, uniV3, q.address, cfg.base.address, f, qOut)));
      return outs.reduce<bigint>((a,b)=>a>b?a:b, 0n);
    })());
    if (QS_V3_POLYGON.quoterV2) {
      sellCandidates.push(quoteAlgebraSingle(client, QS_V3_POLYGON.quoterV2, q.address, cfg.base.address, qOut));
    }

    let back = (await Promise.all(sellCandidates)).reduce<bigint>((a,b)=>a>b?a:b, 0n);
    back -= (back * BigInt(slippageBps)) / DEN;

    const gasCost = (gasPriceWei!) * gasUnitsTwoLeg;
    const flash = (size * flashFeeBps) / DEN;
    return back - size - flash - gasCost;
  }

  const candidateQs = (cfg.quoteCandidates?.length ? cfg.quoteCandidates : universe)
    .filter(t => lc(t.address) !== lc(cfg.base.address));
  const single: any[] = [];

  const sampleSizes = [1n, 2n, 5n, 10n].map(v => v * 10n**BigInt(cfg.base.decimals))
                                        .filter(v => v <= cfg.amountInBaseMax);

  for (const q of candidateQs) {
    for (const buy of ['v2','v3u','v3q'] as const) {
      if (buy === 'v3q' && !QS_V3_POLYGON.quoterV2) continue;

      for (const sz of sampleSizes) {
        const baseNet = await bestNetForMix(q, buy, sz);
        const netBps = toBps(baseNet, sz);
        const passProf = (cfg.onlyProfitable !== false) ? (baseNet > 0n) : true;
        const passNet  = cfg.minNetBase ? baseNet >= cfg.minNetBase : true;
        const passBps  = cfg.minNetBps ? netBps >= cfg.minNetBps : true;

        if (passProf && passNet && passBps) {
          const lo = (sz / 5n) > 0n ? (sz / 5n) : 1n;
          const hi = (5n*sz <= cfg.amountInBaseMax) ? 5n*sz : cfg.amountInBaseMax;
          const opt = await maximizeOverSize((x)=>bestNetForMix(q, buy, x), lo, hi, 10);
          const pnlPerGas = Number(opt.value) / Number((gasPriceWei! * gasUnitsTwoLeg) || 1n);
          single.push({
            route: `${buy.toUpperCase()}→BEST`,
            pair: `${cfg.base.symbol}/${q.symbol}`,
            bestSize: opt.size.toString(),
            net: opt.value.toString(),
            netBps: toBps(opt.value, opt.size),
            pnlPerGas
          });
          break;
        }
      }
    }
  }

  // ---- Multi-hop (≤3) edges
  const bridges = new Set((cfg.bridgeSymbols && cfg.bridgeSymbols.length ? cfg.bridgeSymbols : ['USDC','WETH','DAI']).map(s=>s.toUpperCase()));
  const bridgeAddrs = new Set(
    universe.filter(t => bridges.has(t.symbol.toUpperCase())).map(t => t.address.toLowerCase())
  );

  const edges: Edge[] = [];
  for (const A of universe) for (const B of universe) if (lc(A.address)!==lc(B.address)) {
    for (const f of uniV3.feeTiers) {
      edges.push({ from:A.address, to:B.address, dexKey:`uniV3-${f}`, quote:(amt)=>quoteV3Single(client, uniV3, A.address, B.address, f, amt) });
    }
    if (QS_V3_POLYGON.quoterV2) {
      edges.push({ from:A.address, to:B.address, dexKey:`qsV3`, quote:(amt)=>quoteAlgebraSingle(client, QS_V3_POLYGON.quoterV2!, A.address, B.address, amt) });
    }
  }
  for (const [key] of Object.entries(v2Pools)) {
    const [t0,t1] = key.split('-') as Address[];
    edges.push({ from:t0, to:t1, dexKey:'v2*', quote:(amt)=>bestV2Out(t0,t1,amt) });
    edges.push({ from:t1, to:t0, dexKey:'v2*', quote:(amt)=>bestV2Out(t1,t0,amt) });
  }

  const paths = buildKHopPaths(edges, cfg.base.address, cfg.base.address, cfg.maxHops ?? 3, bridgeAddrs.size ? bridgeAddrs : undefined);
  const multi: any[] = [];
  const gasUnitsMulti = (cfg.maxHops ?? 3) === 2 ? 450_000n : 650_000n;

  const tests = [1n, 2n, 5n, 10n].map(v => v * 10n**BigInt(cfg.base.decimals)).filter(v => v <= cfg.amountInBaseMax);

  for (const p of paths) for (const s of tests) {
    const back = await simulatePathWithSlippage(p, s, slippageBps);
    const flash = (s * flashFeeBps) / DEN;
    const gasCost = gasPriceWei! * gasUnitsMulti;
    const net = back - s - flash - gasCost;

    const passProf = (cfg.onlyProfitable !== false) ? (net > 0n) : true;
    const passNet  = cfg.minNetBase ? net >= cfg.minNetBase : true;
    const nbps     = toBps(net, s);
    const passBps  = cfg.minNetBps ? nbps >= cfg.minNetBps : true;

    if (passProf && passNet && passBps) {
      const pnlPerGas = Number(net) / Number(gasCost || 1n);
      multi.push({
        path: p.edges.map(e=>e.dexKey).join(' -> '),
        bestSize: s.toString(),
        net: net.toString(),
        netBps: nbps,
        pnlPerGas
      });
    }
  }

  // sort
  single.sort((a,b) => {
    const an = BigInt(a.net), bn = BigInt(b.net);
    if (bn === an) return (b.pnlPerGas ?? 0) - (a.pnlPerGas ?? 0);
    return bn > an ? 1 : -1;
  });
  multi.sort((a,b) => {
    const an = BigInt(a.net), bn = BigInt(b.net);
    if (bn === an) return (b.pnlPerGas ?? 0) - (a.pnlPerGas ?? 0);
    return bn > an ? 1 : -1;
  });

  return { single, multi };
}

// ---------------- Multi-base & concurrency wrapper ----------------
export type AdvancedMultiBaseCfg =
  Omit<AdvancedScanCfg, 'base'> & { bases: Token[]; topPerBase?: number };

type WithBaseTag<T> = T & { baseSymbol: string; baseAddress: Address };

async function mapWithConcurrency<T, R>(
  items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(concurrency || 1, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

export async function scanAdvancedManyBasesConcurrent(
  cfg: AdvancedMultiBaseCfg,
  opts?: { concurrency?: number }
): Promise<{
  single: WithBaseTag<{ route: string; pair: string; bestSize: string; net: string; netBps: number; pnlPerGas?: number; }>[]; 
  multi:  WithBaseTag<{ path: string; bestSize: string; net: string; netBps: number; pnlPerGas?: number; }>[]; 
}> {
  const topN = cfg.topPerBase ?? 50;
  const conc = Math.max(1, opts?.concurrency ?? 3);

  const perBase = await mapWithConcurrency(cfg.bases, conc, async (base) => {
    const res = await scanAdvancedSingleAndMulti({ ...cfg, base, maxHops: cfg.maxHops ?? 3 });
    const tagSingle = res.single.map((r) => ({ ...r, baseSymbol: base.symbol, baseAddress: base.address })).slice(0, topN);
    const tagMulti  = res.multi .map((r) => ({ ...r, baseSymbol: base.symbol, baseAddress: base.address })).slice(0, topN);
    return { tagSingle, tagMulti };
  });

  const allSingle = perBase.flatMap(x => x.tagSingle);
  const allMulti  = perBase.flatMap(x => x.tagMulti);

  allSingle.sort((a: any, b: any) => {
    const an = BigInt(a.net), bn = BigInt(b.net);
    if (bn === an) return (b.pnlPerGas ?? 0) - (a.pnlPerGas ?? 0);
    return bn > an ? 1 : -1;
  });
  allMulti.sort((a: any, b: any) => {
    const an = BigInt(a.net), bn = BigInt(b.net);
    if (bn === an) return (b.pnlPerGas ?? 0) - (a.pnlPerGas ?? 0);
    return bn > an ? 1 : -1;
  });

  return { single: allSingle as any, multi: allMulti as any };
}
