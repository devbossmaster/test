// lib/scanner_v2v3.ts
// Pro-grade Polygon/Mainnet arb scanner core.
// - V2 discovery via multicall (batched, index-safe)
// - Optional V3 quoter best-of
// - Liquidity-aware mid-token selection
// - Path search up to 4 hops (uses ./graph)
// - Golden-section(ish) sizing on BigInt
// - Returns per-path token list + per-leg chosen DEX keys for clear UI

import {
  Address,
  createPublicClient,
  getAddress,
  http,
} from "viem";
import { polygon } from "viem/chains";
import {
  buildKHopPaths,
  simulatePathWithSlippage,
  type Edge,
} from "./graph";

// ---------- Exported types ----------
export type Token = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
};

export type V2Dex = {
  key: string;          // e.g. "quickswap_v2"
  factory: Address;     // factory address
  feeBps?: number;      // default 30 bps if omitted
};

export type V3Dex = {
  key: string;          // e.g. "uniswap_v3"
  quoter: Address;      // quoter (or algebra quoter) address
  feeTiers: number[];   // e.g. [500, 3000, 10000]
};

export type AdvancedScanCfg = {
  chain: "polygon" | "mainnet";
  base: Token;
  universe: Token[];
  amountInBaseMax: bigint;

  v2Dexes: V2Dex[];
  v3Dexes?: V3Dex[];

  slippageBps?: number;           // default 30
  flashFeeBps?: number;           // default 9
  minNetBps?: number;             // default 150 (1.5%). Can be negative/zero.
  minNetBase?: bigint;
  onlyProfitable?: boolean;       // default true
  maxHops?: 2 | 3 | 4;            // default 3

  gasGwei?: number;
  priorityGwei?: number;
  maxStaleSec?: number;

  bridgeSymbols?: string[];
  dexAllow?: string[];
};

// ---------- Minimal ABIs ----------
const UNI_V2_FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const UNI_V2_PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_reserve0", type: "uint112" },
      { name: "_reserve1", type: "uint112" },
      { name: "_blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const UNI_V3_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "amountIn", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// ---------- Public client (accepts full URL or bare Alchemy key) ----------
function normalizePolygonRpc(raw?: string | null): string {
  if (!raw) return "https://polygon-rpc.com";
  const v = raw.trim();
  if (!v) return "https://polygon-rpc.com";
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `https://polygon-mainnet.g.alchemy.com/v2/${v}`;
}

const RPC_URL = normalizePolygonRpc(
  process.env.NEXT_PUBLIC_ALCHEMY_POLYGON_URL ||
    process.env.ALCHEMY_POLYGON_URL ||
    process.env.POLYGON_RPC_URL ||
    (process.env.ALCHEMY_KEY as any)
);

const client = createPublicClient({
  chain: polygon,
  transport: http(RPC_URL),
});

// ---------- Small utils ----------
const lc = (a: Address | string) => (a as string).toLowerCase();
const ZERO: Address = getAddress("0x0000000000000000000000000000000000000000");

function getFeeBps(d?: V2Dex) {
  return d?.feeBps ?? 30; // default 0.30%
}

// V2 constant product quote
function getAmountOutV2(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps = 30
) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const feeDen = 10_000n;
  const amountInWithFee = (amountIn * (feeDen - BigInt(feeBps))) / feeDen;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  return numerator / denominator;
}

// ---------- V2 discovery & quoting ----------
type PairInfo = {
  pair: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
};

// Cache for factory.getPair
const pairCache = new Map<string, Address>(); // key: `${factory}-${A}-${B}` (lc)

// SAFE, BATCHED discovery (fixes undefined res[index] cases)
async function discoverV2Pairs(
  tokens: Token[],
  v2dexes: V2Dex[],
  dexAllow?: string[]
): Promise<Address[]> {
  const allowed = dexAllow ? new Set(dexAllow.map((k) => k.toLowerCase())) : undefined;

  type Q = {
    address: Address;
    abi: typeof UNI_V2_FACTORY_ABI;
    functionName: "getPair";
    args: readonly [Address, Address];
    k: string; // `${factory}-${A}-${B}`
  };

  const queries: Q[] = [];

  for (const dex of v2dexes) {
    if (allowed && !allowed.has(dex.key.toLowerCase())) continue;
    const factory = getAddress(dex.factory);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const A = getAddress(tokens[i].address);
        const B = getAddress(tokens[j].address);
        const k1 = `${lc(factory)}-${lc(A)}-${lc(B)}`;
        const k2 = `${lc(factory)}-${lc(B)}-${lc(A)}`;

        if (!pairCache.has(k1)) {
          queries.push({
            address: factory,
            abi: UNI_V2_FACTORY_ABI,
            functionName: "getPair",
            args: [A, B],
            k: k1,
          });
        }
        if (!pairCache.has(k2)) {
          queries.push({
            address: factory,
            abi: UNI_V2_FACTORY_ABI,
            functionName: "getPair",
            args: [B, A],
            k: k2,
          });
        }
      }
    }
  }

  if (queries.length) {
    const BATCH = 1024;
    for (let i = 0; i < queries.length; i += BATCH) {
      const slice = queries.slice(i, i + BATCH);
      const res = await client.multicall({
        contracts: slice.map(({ k, ...call }) => call),
        allowFailure: true,
      });

      for (let j = 0; j < res.length; j++) {
        const out = res[j];
        const q = slice[j];
        const addr = out && out.status === "success" ? (out.result as Address) : ZERO;
        pairCache.set(q.k, addr && lc(addr) !== lc(ZERO) ? getAddress(addr) : ZERO);
      }
    }
  }

  // Consolidate discovered pair addresses for keys we care about
  const discovered = new Set<Address>();
  for (const dex of v2dexes) {
    if (allowed && !allowed.has(dex.key.toLowerCase())) continue;
    const factory = getAddress(dex.factory);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const A = getAddress(tokens[i].address);
        const B = getAddress(tokens[j].address);
        const k1 = `${lc(factory)}-${lc(A)}-${lc(B)}`;
        const k2 = `${lc(factory)}-${lc(B)}-${lc(A)}`;
        const p1 = pairCache.get(k1);
        const p2 = pairCache.get(k2);
        if (p1 && lc(p1) !== lc(ZERO)) discovered.add(getAddress(p1));
        if (p2 && lc(p2) !== lc(ZERO)) discovered.add(getAddress(p2));
      }
    }
  }

  return [...discovered];
}

async function readV2PairsInfo(pairs: Address[]): Promise<Map<Address, PairInfo>> {
  const infos = new Map<Address, PairInfo>();
  if (!pairs.length) return infos;

  const t0Calls = pairs.map((p) => ({
    address: p,
    abi: UNI_V2_PAIR_ABI,
    functionName: "token0" as const,
    args: [] as const,
  }));
  const t1Calls = pairs.map((p) => ({
    address: p,
    abi: UNI_V2_PAIR_ABI,
    functionName: "token1" as const,
    args: [] as const,
  }));
  const rCalls = pairs.map((p) => ({
    address: p,
    abi: UNI_V2_PAIR_ABI,
    functionName: "getReserves" as const,
    args: [] as const,
  }));

  const [t0Res, t1Res, rRes] = await Promise.all([
    client.multicall({ contracts: t0Calls, allowFailure: true }),
    client.multicall({ contracts: t1Calls, allowFailure: true }),
    client.multicall({ contracts: rCalls, allowFailure: true }),
  ]);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const a = t0Res[i];
    const b = t1Res[i];
    const r = rRes[i];
    if (!a || !b || !r) continue;
    if (a.status !== "success" || b.status !== "success" || r.status !== "success") continue;

    const token0 = getAddress(a.result as Address);
    const token1 = getAddress(b.result as Address);
    const [reserve0, reserve1] = r.result as unknown as [bigint, bigint, number];

    infos.set(pair, { pair, token0, token1, reserve0, reserve1 });
  }

  return infos;
}

// ---------- Liquidity scoring (stable-side reserves) ----------
function buildLiquidityScoresFromStableSides(
  tokenList: Token[],
  stableAddrsLc: Set<string>,
  v2dexes: V2Dex[],
  dexAllow?: string[]
) {
  const allowed = dexAllow ? new Set(dexAllow.map((k) => k.toLowerCase())) : undefined;
  const scores = new Map<string, bigint>(); // tokenAddrLc -> sum of stable-side reserves
  const push = (addrLc: string, inc: bigint) =>
    scores.set(addrLc, (scores.get(addrLc) ?? 0n) + inc);

  return {
    async compute(): Promise<Map<string, bigint>> {
      const stables = tokenList.filter((t) => stableAddrsLc.has(lc(t.address)));
      const others = tokenList.filter((t) => !stableAddrsLc.has(lc(t.address)));
      const combined = [...stables, ...others];

      const v2Filtered = allowed
        ? v2dexes.filter((d) => allowed.has(lc(d.key)))
        : v2dexes;

      const pairs = await discoverV2Pairs(combined, v2Filtered);
      const infos = await readV2PairsInfo(pairs);

      for (const info of infos.values()) {
        const aLc = lc(info.token0);
        const bLc = lc(info.token1);
        const aStable = stableAddrsLc.has(aLc);
        const bStable = stableAddrsLc.has(bLc);
        if (aStable && !bStable) push(bLc, info.reserve0);
        else if (bStable && !aStable) push(aLc, info.reserve1);
      }
      return scores;
    },
  };
}

// ---------- Optional V3 quoting ----------
async function quoteV3(
  dex: V3Dex,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number
): Promise<bigint> {
  try {
    const out = (await client.readContract({
      address: dex.quoter,
      abi: UNI_V3_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          sqrtPriceLimitX96: 0n,
        } as any,
      ],
    })) as bigint;
    return out ?? 0n;
  } catch {
    return 0n;
  }
}

// ---------- Golden section over BigInt (discrete ternary search) ----------
type EvalFn = (x: bigint) => Promise<bigint> | bigint;

async function maximizeOverSize(
  f: EvalFn,
  lo: bigint,
  hi: bigint,
  iters: number
): Promise<{ size: bigint; value: bigint }> {
  if (hi <= lo) {
    const v = await f(lo);
    return { size: lo, value: v };
  }
  let bestSize = lo;
  let bestVal = await f(lo);
  let L = lo,
    R = hi;

  for (let i = 0; i < iters; i++) {
    const mid1 = L + (R - L) / 3n;
    const mid2 = R - (R - L) / 3n;
    const [v1, v2] = await Promise.all([f(mid1), f(mid2)]);
    const betterMid = v2 > v1 ? mid2 : mid1;
    const betterVal = v2 > v1 ? v2 : v1;
    if (betterVal > bestVal) {
      bestVal = betterVal;
      bestSize = betterMid;
    }
    if (v1 < v2) L = mid1 + 1n;
    else R = mid2 - 1n;
    if (R <= L) break;
  }
  return { size: bestSize, value: bestVal };
}

// ---------- Edge builder from V2 reserves and optional V3 ----------
function buildEdgesFromData(opts: {
  tokens: Token[];
  v2pairsInfo: Map<Address, PairInfo>;
  useV3?: boolean;
  v3dexes?: V3Dex[];
}): Edge[] {
  const { tokens, v2pairsInfo, useV3, v3dexes } = opts;

  type ABKey = `${string}-${string}`;
  const byTokens: Map<
    ABKey,
    { pairs: { pair: Address; t0: Address; t1: Address; r0: bigint; r1: bigint }[] }
  > = new Map();

  for (const info of v2pairsInfo.values()) {
    const a = lc(info.token0),
      b = lc(info.token1);
    const keyAB: ABKey = `${a}-${b}`;
    const keyBA: ABKey = `${b}-${a}`;
    if (!byTokens.has(keyAB)) byTokens.set(keyAB, { pairs: [] });
    if (!byTokens.has(keyBA)) byTokens.set(keyBA, { pairs: [] });
    const item = { pair: info.pair, t0: info.token0, t1: info.token1, r0: info.reserve0, r1: info.reserve1 };
    byTokens.get(keyAB)!.pairs.push(item);
    byTokens.get(keyBA)!.pairs.push(item);
  }

  function bestV2Quote(tokenIn: Address, tokenOut: Address, amountIn: bigint): bigint {
    const list = byTokens.get(`${lc(tokenIn)}-${lc(tokenOut)}`);
    if (!list || !list.pairs.length) return 0n;

    let best = 0n;
    const feeBps = 30; // approx per V2 fork
    for (const p of list.pairs) {
      if (lc(p.t0) === lc(tokenIn) && lc(p.t1) === lc(tokenOut)) {
        const out = getAmountOutV2(amountIn, p.r0, p.r1, feeBps);
        if (out > best) best = out;
      } else if (lc(p.t1) === lc(tokenIn) && lc(p.t0) === lc(tokenOut)) {
        const out = getAmountOutV2(amountIn, p.r1, p.r0, feeBps);
        if (out > best) best = out;
      }
    }
    return best;
  }

  const edges: Edge[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = 0; j < tokens.length; j++) {
      if (i === j) continue;
      const A = tokens[i].address as Address;
      const B = tokens[j].address as Address;

      // V2 best-of edge
      edges.push({
        from: A,
        to: B,
        dexKey: "v2-best",
        quote: (amt: bigint) => bestV2Quote(A, B, amt),
      });

      // Optional V3 best-of edge
      if (useV3 && v3dexes && v3dexes.length) {
        edges.push({
          from: A,
          to: B,
          dexKey: "v3-best",
          quote: async (amt: bigint) => {
            let best = 0n;
            for (const dex of v3dexes) {
              for (const fee of dex.feeTiers) {
                const out = await quoteV3(dex, A, B, amt, fee);
                if (out > best) best = out;
              }
            }
            return best;
          },
        });
      }
    }
  }

  return edges;
}

// ---------- New helpers to expose chosen DEX per hop ----------
type BestQuote = { out: bigint; dexKey: string };

async function bestQuoteWithDex(
  edges: Edge[],
  A: Address,
  B: Address,
  amt: bigint
): Promise<BestQuote> {
  let best: BestQuote = { out: 0n, dexKey: "" };
  const pending: Promise<void>[] = [];
  for (const e of edges) {
    if (lc(e.from) === lc(A) && lc(e.to) === lc(B)) {
      const q = e.quote(amt);
      if (q instanceof Promise) {
        pending.push(
          q.then((v) => {
            if (v > best.out) best = { out: v, dexKey: e.dexKey };
          })
        );
      } else {
        if (q > best.out) best = { out: q, dexKey: e.dexKey };
      }
    }
  }
  if (pending.length) await Promise.all(pending);
  return best;
}

async function simulatePathDetails(
  allEdges: Edge[],
  path: { edges: Edge[] },
  amountIn: bigint,
  slippageBps: number
): Promise<{ amountOut: bigint; dexes: string[] }> {
  let amt = amountIn;
  const dexes: string[] = [];
  for (const e of path.edges) {
    const { out, dexKey } = await bestQuoteWithDex(allEdges, e.from as Address, e.to as Address, amt);
    if (out <= 0n) return { amountOut: 0n, dexes: [] };
    // per-hop haircut (same slippage model you use elsewhere)
    amt = (out * BigInt(10_000 - slippageBps)) / 10_000n;
    dexes.push(dexKey || "best-of");
  }
  return { amountOut: amt, dexes };
}

// ---------- Main entry ----------
export async function scanAdvancedSingleAndMulti(cfg: AdvancedScanCfg): Promise<{
  single: Array<{
    pair: string;
    pathTokens: `0x${string}`[];  // [base, mid, base]
    dexes: string[];              // [leg1, leg2]
    size: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  }>;
  multi: Array<{
    path: string;                 // human label of DEXes
    pathTokens: `0x${string}`[];  // full token path base -> ... -> base
    dexes: string[];              // per-leg DEX choices
    bestSize: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  }>;
}> {
  const slippageBps = cfg.slippageBps ?? 30;
  const flashFeeBps = cfg.flashFeeBps ?? 9;
  const minNetBps = cfg.minNetBps ?? 150;
  const onlyProfitable = cfg.onlyProfitable !== false;
  const maxHops = (cfg.maxHops ?? 3) as 2 | 3 | 4;

  // Gas price
  const baseFee =
    cfg.gasGwei != null
      ? BigInt(Math.floor(cfg.gasGwei * 1e9))
      : await client.getGasPrice();
  const priority = cfg.priorityGwei != null ? BigInt(Math.floor(cfg.priorityGwei * 1e9)) : 0n;
  const gasPriceWei = baseFee + priority;

  // Approx gas units
  const GAS_UNITS_SINGLE = 120_000n;
  const GAS_UNITS_MULTI = 260_000n;

  // 1) Liquidity-aware mids
  const stableSyms = new Set(["USDC", "USDT", "DAI"]);
  const stableAddrsLc = new Set(
    cfg.universe.filter((t) => stableSyms.has(t.symbol)).map((t) => lc(t.address))
  );
  const universe = cfg.universe.slice(0, 160);

  const scorer = buildLiquidityScoresFromStableSides(
    universe,
    stableAddrsLc,
    cfg.v2Dexes,
    cfg.dexAllow
  );
  const scores = await scorer.compute();

  const bridgeAddrs = (cfg.bridgeSymbols ?? ["USDC", "USDT", "DAI", "WETH", "WMATIC"])
    .map((sym) => universe.find((t) => t.symbol === sym)?.address)
    .filter(Boolean) as Address[];

  const TOP_MIDS = Math.max(25, Math.min(60, universe.length));
  const topByLiq = [...scores.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, TOP_MIDS);

  const allowedMidLc = new Set<string>([
    ...bridgeAddrs.map((a) => lc(a)),
    ...topByLiq.map(([addrLc]) => addrLc),
  ]);

  const tokenSet: Token[] = [];
  const seen = new Set<string>();
  const addToken = (t?: Token) => {
    if (!t) return;
    const k = lc(t.address);
    if (seen.has(k)) return;
    seen.add(k);
    tokenSet.push(t);
  };
  addToken(cfg.base);
  for (const t of universe) {
    if (lc(t.address) === lc(cfg.base.address)) continue;
    if (allowedMidLc.has(lc(t.address))) addToken(t);
  }

  // 2) Discover V2 pairs + read reserves
  const v2Pairs = await discoverV2Pairs(tokenSet, cfg.v2Dexes, cfg.dexAllow);
  const v2pairsInfo = await readV2PairsInfo(v2Pairs);

  // 3) Build edges (V2 best-of, optional V3 best-of)
  const edges = buildEdgesFromData({
    tokens: tokenSet,
    v2pairsInfo,
    useV3: !!(cfg.v3Dexes && cfg.v3Dexes.length),
    v3dexes: cfg.v3Dexes,
  });

  // 4) SINGLE-HOP round-trips (base -> mid -> base)
  const single: Array<{
    pair: string;
    pathTokens: `0x${string}`[];
    dexes: string[];
    size: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  }> = [];

  const base = cfg.base;
  const sampleSizes: bigint[] = [
    cfg.amountInBaseMax / 10n,
    cfg.amountInBaseMax / 4n,
    cfg.amountInBaseMax / 2n,
    cfg.amountInBaseMax,
  ].filter((x) => x > 0n);

  const bestQuoteRaw = async (A: Address, B: Address, amt: bigint) =>
    bestQuoteWithDex(edges, A, B, amt);

  for (const mid of tokenSet) {
    if (lc(mid.address) === lc(base.address)) continue;

    for (const sz of sampleSizes) {
      const leg1 = await bestQuoteRaw(base.address, mid.address, sz);
      if (leg1.out <= 0n) continue;
      const leg2 = await bestQuoteRaw(mid.address, base.address, leg1.out);
      if (leg2.out <= 0n) continue;

      const out2 = leg2.out;
      const flashCost = (sz * BigInt(flashFeeBps)) / 10_000n;
      const net = out2 - sz - flashCost;
      const nbps = Number((net * 10_000n) / (sz || 1n));

      const gasCostBaseWei = gasPriceWei * GAS_UNITS_SINGLE;
      const pnlPerGas = Number(net) / Number(gasCostBaseWei || 1n);

      const passProf = onlyProfitable ? net > 0n : true;
      const passNet = cfg.minNetBase ? net >= cfg.minNetBase : true;
      const passBps = nbps >= (cfg.minNetBps ?? minNetBps);
      if (!(passProf && passNet && passBps)) continue;

      const lo = sz / 5n > 0n ? sz / 5n : 1n;
      const hi = cfg.amountInBaseMax;

      const objective: EvalFn = async (x) => {
        const l1 = await bestQuoteRaw(base.address, mid.address, x);
        if (l1.out <= 0n) return -1n;
        const l2 = await bestQuoteRaw(mid.address, base.address, l1.out);
        if (l2.out <= 0n) return -1n;
        const flash = (x * BigInt(flashFeeBps)) / 10_000n;
        return l2.out - x - flash;
      };

      const opt = await maximizeOverSize(objective, lo, hi, 10);
      const optBps = Number((opt.value * 10_000n) / (opt.size || 1n));
      const pnlGas = Number(opt.value) / Number(gasPriceWei * GAS_UNITS_SINGLE || 1n);

      // re-evaluate winning leg dexes at optimal size for display
      const l1opt = await bestQuoteRaw(base.address, mid.address, opt.size);
      const l2opt = await bestQuoteRaw(mid.address, base.address, l1opt.out);

      single.push({
        pair: `${base.symbol}/${mid.symbol}/${base.symbol}`,
        pathTokens: [base.address, mid.address, base.address],
        dexes: [l1opt.dexKey || "best-of", l2opt.dexKey || "best-of"],
        size: opt.size.toString(),
        net: opt.value.toString(),
        netBps: optBps,
        pnlPerGas: pnlGas,
      });
    }
  }

  single.sort((a, b) => b.netBps - a.netBps);
  if (single.length > 30) single.length = 30;

  // 5) MULTI-HOP cycles base -> ... -> base (≤ maxHops)
  const allowedMidSet = new Set<string>(tokenSet.map((t) => lc(t.address)));
  const paths = buildKHopPaths(edges, base.address, base.address, maxHops, allowedMidSet);

  const multi: Array<{
    path: string;
    pathTokens: `0x${string}`[];
    dexes: string[];
    bestSize: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  }> = [];

  for (const p of paths) {
    if (p.edges.length < 2) continue;

    const tokenPath: `0x${string}`[] = [
      p.edges[0].from as Address,
      ...p.edges.map((e) => e.to as Address),
    ];

    for (const sz of sampleSizes) {
      const out = await simulatePathWithSlippage(p, sz, slippageBps);
      if (out <= 0n) continue;

      const flashCost = (sz * BigInt(flashFeeBps)) / 10_000n;
      const net = out - sz - flashCost;
      const nbps = Number((net * 10_000n) / (sz || 1n));

      const passProf = onlyProfitable ? net > 0n : true;
      const passNet = cfg.minNetBase ? net >= cfg.minNetBase : true;
      const passBps = nbps >= (cfg.minNetBps ?? minNetBps);
      if (!(passProf && passNet && passBps)) continue;

      const lo = sz / 5n > 0n ? sz / 5n : 1n;
      const hi = cfg.amountInBaseMax;

      const objective: EvalFn = async (x) => {
        const y = await simulatePathWithSlippage(p, x, slippageBps);
        const flash = (x * BigInt(flashFeeBps)) / 10_000n;
        return y - x - flash;
      };

      const opt = await maximizeOverSize(objective, lo, hi, 10);
      const optBps = Number((opt.value * 10_000n) / (opt.size || 1n));
      const pnlGas = Number(opt.value) / Number(gasPriceWei * GAS_UNITS_MULTI || 1n);

      // choose per-leg DEXes for display at optimal size
      const det = await simulatePathDetails(edges, p, opt.size, slippageBps);
      const label = det.dexes.join(" -> ");

      multi.push({
        path: label,
        pathTokens: tokenPath,
        dexes: det.dexes,
        bestSize: opt.size.toString(),
        net: opt.value.toString(),
        netBps: optBps,
        pnlPerGas: pnlGas,
      });
    }
  }

  multi.sort((a, b) => b.netBps - a.netBps);
  if (multi.length > 50) multi.length = 50;

  return { single, multi };
}
