// app/api/scan-advanced/route.ts
import { NextResponse } from "next/server";
import { TOKENS } from "@/lib/tokens";
import { discoverTopTokensFromAlchemy } from "@/lib/tokenDiscovery";
import { scanAdvancedSingleAndMulti, type V2Dex, type V3Dex } from "@/lib/scanner_v2v3";
import { POLYGON_V2_DEXS } from "@/lib/dexConfigs";
import { V3_POLYGON, QS_V3_POLYGON } from "@/lib/dexV3Configs";
import type { Address } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const baseSym = (searchParams.get("base") || "WMATIC").toUpperCase();
  const base = TOKENS[baseSym] || TOKENS.WMATIC;

  const maxInStr = searchParams.get("maxIn") || "5";
  const amountInBaseMax =
    BigInt(Math.floor(Number(maxInStr) * 1e6)) *
    (10n ** BigInt(base.decimals)) / 1_000_000n;

 // thresholds from query (now allows negative)
const minBps = Number(searchParams.get("minBps") ?? "150"); // e.g. -50 = -0.50%
const profitableParam = (searchParams.get("profitable") ?? "1").toLowerCase();
const onlyProfitable =
  profitableParam === "0" || profitableParam === "false" ? false : true; // set ?profitable=0 to allow ≤0 nets

  // Universe via Alchemy (fallback handled inside tokenDiscovery or use your earlier fallback)
  const universe = await discoverTopTokensFromAlchemy({
    blocksBack: 50_000,
    perPage: 1000,
    limit: 140,
  });

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
    chain: "polygon",
    base,
    universe,
    amountInBaseMax,

    v2Dexes,
    v3Dexes,

    slippageBps: 30,
    flashFeeBps: 9,
    minNetBps: minBps,          // ← from query
    onlyProfitable,             // ← from query
    maxHops: 4,

    maxStaleSec: 600,
    bridgeSymbols: ["USDC","USDT","DAI","WETH","WMATIC"],
  });

  return NextResponse.json({
    chainId: 137,
    ts: Math.floor(Date.now() / 1000),
    base: base.symbol,
    universeCount: universe.length,
    single: res.single,
    multi: res.multi,
  });
}
