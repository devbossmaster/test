// app/components/MultiRouteCard.tsx
"use client";

import { useMemo, useState } from "react";

type Multi = {
  path: string;
  pathTokens: `0x${string}`[];
  dexes: string[];
  bestSize: string; // bigint string
  net: string;      // bigint string
  netBps: number;
  pnlPerGas?: number;
};

export default function RouteCardMulti({
  item,
  addrToSymbol,
}: {
  item: Multi;
  addrToSymbol: (a: string) => string;
}) {
  const [size, setSize] = useState(item.bestSize);

  const pathSymbols = useMemo(
    () => item.pathTokens.map(a => addrToSymbol(a)).join(" / "),
    [item.pathTokens, addrToSymbol]
  );

  const colorBps = item.netBps >= 0 ? "text-emerald-400" : "text-rose-400";
  const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  return (
    <div className="rounded-2xl bg-slate-900/60 border border-slate-700 p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{pathSymbols}</div>
        <div className="text-xs text-slate-400">route</div>
      </div>

      <div className="text-sm">
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
          onClick={() => alert("Hook this to your /api/txs simulate endpoint")}
        >
          Test
        </button>
      </div>
    </div>
  );
}
