// components/ScannerTable.tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

// ---- types that mirror your /api/scan response ----
type ScanToken = { symbol: string };
type ScanDex = { label: string };
type ScanPair = { base: ScanToken; quote: ScanToken };

type ScanOpportunity = {
  pair: ScanPair;
  buyDex: ScanDex;
  sellDex: ScanDex;
  grossDeltaBase: string; // bigint serialized as string
  netDeltaBase: string;   // bigint serialized as string
  netDeltaPct: number;    // e.g. 0.42
};

type ScanResponse = {
  blockNumber: number;
  chainId: number;
  ts: number; // unix seconds
  opportunities: ScanOpportunity[];
};

type ScanParams = {
  amountIn: string;
  base: string;
  gasGwei: string;
  includeLosses: string;
  limit: string;
  useAlchemy: string;     // "1"|"0"
  alchemyLimit: string;   // "100" etc.
};

function useScan(params: ScanParams) {
  const qs = useMemo(() => new URLSearchParams(params as any).toString(), [params]);

  return useQuery<ScanResponse>({
    queryKey: ['scan', qs],
    queryFn: async () => {
      const r = await fetch('/api/scan?' + qs, { cache: 'no-store' });
      if (!r.ok) throw new Error(`scan error (${r.status})`);
      // Ensure the API returns this exact shape
      const json = (await r.json()) as ScanResponse;
      return json;
    },
    refetchInterval: 8000,
    // v4/v5 pattern to keep the previous data during refetch
    placeholderData: keepPreviousData,
  });
}

export default function ScannerTable() {
  // UI state
  const [amountIn, setAmountIn] = useState('10'); // base units (human)
  const [base, setBase] = useState('WMATIC');
  const [gasGwei, setGasGwei] = useState('30');
  const [includeLosses, setIncludeLosses] = useState(false);
  const [limit, setLimit] = useState('50');

  // Use Alchemy dynamic universe by default
  const [useAlchemy, setUseAlchemy] = useState(true);
  const [alchemyLimit, setAlchemyLimit] = useState('120');

  const { data, isLoading, error } = useScan({
    amountIn,
    base,
    gasGwei,
    includeLosses: includeLosses ? '1' : '0',
    limit,
    useAlchemy: useAlchemy ? '1' : '0',
    alchemyLimit,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-8 gap-3 items-end">
        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Amount In (base)</span>
          <input
            value={amountIn}
            onChange={e => setAmountIn(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
            inputMode="decimal"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Base Token</span>
          <select
            value={base}
            onChange={e => setBase(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
          >
            <option>WMATIC</option>
            <option>WETH</option>
            <option>USDC</option>
          </select>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Gas (gwei)</span>
          <input
            value={gasGwei}
            onChange={e => setGasGwei(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
            inputMode="numeric"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Results</span>
          <select
            value={limit}
            onChange={e => setLimit(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useAlchemy}
            onChange={e => setUseAlchemy(e.target.checked)}
          />
          <span className="text-sm">Use Alchemy top tokens</span>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Alchemy Limit</span>
          <input
            value={alchemyLimit}
            onChange={e => setAlchemyLimit(e.target.value)}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800"
            inputMode="numeric"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeLosses}
            onChange={e => setIncludeLosses(e.target.checked)}
          />
          <span className="text-sm">Include non-profitable</span>
        </label>

        <div className="text-xs text-neutral-500 md:col-span-2">
          {error && <span className="text-red-400">Error: {(error as Error).message}</span>}
          {data && (
            <>
              Block: {data.blockNumber} · ChainId: {data.chainId} · Updated:{' '}
              {new Date(data.ts * 1000).toLocaleTimeString()}
              {useAlchemy && ' · Universe: Alchemy'}
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900">
            <tr>
              <th className="p-3 text-left">Pair</th>
              <th className="p-3 text-left">Buy @</th>
              <th className="p-3 text-left">Sell @</th>
              <th className="p-3 text-right">Gross Δ (base)</th>
              <th className="p-3 text-right">Net Δ (base)</th>
              <th className="p-3 text-right">Net %</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="p-3" colSpan={6}>Scanning…</td>
              </tr>
            )}

            {!isLoading && (!data?.opportunities || data.opportunities.length === 0) && (
              <tr>
                <td className="p-3" colSpan={6}>
                  {includeLosses ? 'No routes (even including losses).' : 'No profitable routes at these params.'}
                </td>
              </tr>
            )}

            {data?.opportunities?.map((o, i) => {
              const gross = Number(o.grossDeltaBase) / 1e18;
              const net = Number(o.netDeltaBase) / 1e18;
              const negative = net <= 0;
              return (
                <tr key={i} className="border-t border-neutral-800">
                  <td className="p-3">
                    {o.pair.base.symbol}/{o.pair.quote.symbol}
                  </td>
                  <td className="p-3">{o.buyDex.label}</td>
                  <td className="p-3">{o.sellDex.label}</td>
                  <td className="p-3 text-right">{gross.toFixed(6)}</td>
                  <td className={`p-3 text-right ${negative ? 'text-red-400' : 'text-green-400'}`}>
                    {net.toFixed(6)}
                  </td>
                  <td className={`p-3 text-right ${negative ? 'text-red-400' : 'text-green-400'}`}>
                    {o.netDeltaPct.toFixed(4)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
