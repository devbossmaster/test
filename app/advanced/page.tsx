// app/advanced/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import useSWR from "swr";
import { TOKENS } from "@/lib/tokens";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useAdvancedScan(params: {
  base: string;        // e.g. "WMATIC"
  maxIn: string;       // e.g. "5"
  maxHops: string;     // "2" | "3" | "4"
  minBps?: string;     // e.g. "-500" for -5.00%
  profitable?: string; // "0" to allow ≤0 nets
}) {
  const qs = new URLSearchParams({
    base: params.base,
    maxIn: params.maxIn,
    maxHops: params.maxHops,
  });
  if (params.minBps != null) qs.set("minBps", params.minBps);
  if (params.profitable != null) qs.set("profitable", params.profitable);

  const url = `/api/scan-advanced?${qs.toString()}`;

  const swr = useSWR(url, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  return { ...swr, url };
}

function makeAddrToSymbol() {
  const map = new Map<string, string>();
  Object.values(TOKENS).forEach((t) =>
    map.set((t.address as string).toLowerCase(), t.symbol)
  );
  return (addr: string) =>
    map.get(addr.toLowerCase()) || addr.slice(0, 6) + "…" + addr.slice(-4);
}

function HeaderTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-1">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function SectionCard({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {right ? right : <div />}
      </div>
      <div className="space-y-3">
        {/* children injected at usage */}
      </div>
    </div>
  );
}

function RouteCardSingle({
  item,
  addrToSymbol,
}: {
  item: {
    pair: string;
    pathTokens: `0x${string}`[];
    dexes: string[];
    size: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  };
  addrToSymbol: (a: string) => string;
}) {
  const [size, setSize] = useState(item.size);
  const colorBps = item.netBps >= 0 ? "text-emerald-400" : "text-rose-400";
  const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  const pathReadable = useMemo(
    () => item.pathTokens.map(addrToSymbol).join(" / "),
    [item.pathTokens, addrToSymbol]
  );

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-slate-700 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{pathReadable}</div>
        <div className="text-xs text-slate-400">route</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center justify-between">
          <div>best size:</div>
          <div className="font-mono">{item.size}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>net:</div>
          <div className="font-mono">{item.net}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>dexes:</div>
          <div className="font-mono">{item.dexes.join(" → ")}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>pnl/gas:</div>
          <div className="font-mono">{(item.pnlPerGas ?? 0).toFixed(3)}</div>
        </div>
      </div>

      <div className={`text-sm font-semibold ${colorBps}`}>
        net bps: {fmtPct(item.netBps)}
      </div>

      <div className="mt-2">
        <input
          type="range"
          min="1"
          max={item.size}
          defaultValue={item.size}
          className="w-full"
          onChange={(e) => setSize(e.target.value)}
        />
        <div className="text-xs text-right text-slate-400">size: {size}</div>
      </div>

      <div className="mt-1 flex gap-2">
        <button
          className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm"
          onClick={() => {
            const obj = { type: "single", ...item, sizeOverride: size };
            navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
          }}
        >
          Copy JSON
        </button>
        <button
          className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm"
          onClick={() =>
            alert("Hook this to your /api/txs simulate endpoint for a preview.")
          }
        >
          Test
        </button>
      </div>
    </div>
  );
}

function RouteCardMulti({
  item,
  addrToSymbol,
}: {
  item: {
    path: string;
    pathTokens: `0x${string}`[];
    dexes: string[];
    bestSize: string;
    net: string;
    netBps: number;
    pnlPerGas?: number;
  };
  addrToSymbol: (a: string) => string;
}) {
  const [size, setSize] = useState(item.bestSize);
  const colorBps = item.netBps >= 0 ? "text-emerald-400" : "text-rose-400";
  const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  const pathReadable = useMemo(
    () => item.pathTokens.map(addrToSymbol).join(" / "),
    [item.pathTokens, addrToSymbol]
  );

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-slate-700 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{pathReadable}</div>
        <div className="text-xs text-slate-400">route</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center justify-between">
          <div>best size:</div>
          <div className="font-mono">{item.bestSize}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>net:</div>
          <div className="font-mono">{item.net}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>dexes:</div>
          <div className="font-mono">{item.dexes.join(" → ")}</div>
        </div>
        <div className="flex items-center justify-between">
          <div>pnl/gas:</div>
          <div className="font-mono">{(item.pnlPerGas ?? 0).toFixed(3)}</div>
        </div>
      </div>

      <div className={`text-sm font-semibold ${colorBps}`}>
        net bps: {fmtPct(item.netBps)}
      </div>

      <div className="mt-2">
        <input
          type="range"
          min="1"
          max={item.bestSize}
          defaultValue={item.bestSize}
          className="w-full"
          onChange={(e) => setSize(e.target.value)}
        />
        <div className="text-xs text-right text-slate-400">size: {size}</div>
      </div>

      <div className="mt-1 flex gap-2">
        <button
          className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm"
          onClick={() => {
            const obj = { type: "multi", ...item, sizeOverride: size };
            navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
          }}
        >
          Copy JSON
        </button>
        <button
          className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm"
          onClick={() =>
            alert("Hook this to your /api/txs simulate endpoint for a preview.")
          }
        >
          Test
        </button>
      </div>
    </div>
  );
}

export default function AdvancedScannerPage() {
  // Controls
  const [base, setBase] = useState("WMATIC");
  const [maxIn, setMaxIn] = useState("5");   // base units
  const [maxHops, setMaxHops] = useState("4");

  // Show down to -5.00% and include ≤0 PnL for testing
  const { data, isLoading, error, url } = useAdvancedScan({
    base,
    maxIn,
    maxHops,
    minBps: "-500",    // allow negative (e.g., -5.00%)
    profitable: "0",   // include zero/negative for testing
  });

  const ts = useMemo(() => {
    if (!data?.ts) return "-";
    const d = new Date(data.ts * 1000);
    return d.toLocaleString();
  }, [data?.ts]);

  const addrToSymbol = useMemo(() => makeAddrToSymbol(), []);

  const thresholdPct = useMemo(() => {
    const bps = Number(data?.filters?.minBps ?? 150);
    return (bps / 100).toFixed(2);
  }, [data?.filters?.minBps]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Polygon Arbitrage Scanner (Pro, up to 4 hops)</h1>

      {/* Top controls / tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
          <div className="text-xs text-slate-400 mb-2">Base Token</div>
          <select
            className="w-full bg-slate-800 rounded-xl px-3 py-2"
            value={base}
            onChange={(e) => setBase(e.target.value.toUpperCase())}
          >
            <option>WMATIC</option>
            <option>USDC</option>
            <option>USDT</option>
            <option>WETH</option>
            <option>WBTC</option>
          </select>

          <div className="text-xs text-slate-400 mt-4 mb-1">Max In (base units)</div>
          <input
            className="w-full bg-slate-800 rounded-xl px-3 py-2"
            value={maxIn}
            onChange={(e) => setMaxIn(e.target.value)}
          />

          <div className="text-xs text-slate-400 mt-4 mb-1">Max Hops</div>
          <select
            className="w-full bg-slate-800 rounded-xl px-3 py-2"
            value={maxHops}
            onChange={(e) => setMaxHops(e.target.value)}
          >
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>

          <button
            className="mt-4 w-full rounded-xl bg-sky-600 hover:bg-sky-500 py-2 font-semibold"
            onClick={() => window.location.assign(`/advanced?base=${base}&maxIn=${maxIn}&maxHops=${maxHops}`)}
          >
            Scan Now
          </button>
        </div>

        <HeaderTile label="Last Scan" value={ts} />
        <HeaderTile label="Status" value={isLoading ? "Scanning…" : error ? "Error" : "Ready"} />
        <HeaderTile
          label="Request"
          value={<div className="text-xs break-all text-slate-400">{url}</div>}
        />
      </div>

      {/* Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Single-hop */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              Single-hop opportunities (≥ {thresholdPct}% net)
            </h3>
          </div>
          <div className="flex flex-col gap-3">
            {(data?.single ?? []).map((it: any, i: number) => (
              <RouteCardSingle key={i} item={it} addrToSymbol={addrToSymbol} />
            ))}
            {!data?.single?.length && (
              <div className="text-sm text-slate-400">
                No single-hop routes at current filter.
              </div>
            )}
          </div>
        </div>

        {/* Multi-hop */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              Multi-hop opportunities (≤ {maxHops} hops, ≥ {thresholdPct}% net)
            </h3>
          </div>
          <div className="flex flex-col gap-3">
            {(data?.multi ?? []).map((it: any, i: number) => (
              <RouteCardMulti key={i} item={it} addrToSymbol={addrToSymbol} />
            ))}
            {!data?.multi?.length && (
              <div className="text-sm text-slate-400">
                No multi-hop routes at current filter.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-500">
        Auto-scans every 30s • Threshold is dynamic from API • Liquidity-aware mids • Up to 4 hops
      </div>
    </div>
  );
}
