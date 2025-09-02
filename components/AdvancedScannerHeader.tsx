'use client';

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

type ScanData = {
  chainId: number;
  blockNumber: number;
  ts: number;
  single: { route: string; pair: string; bestSize: string; net: string; netBps: number; pnlPerGas: number }[];
  multi:  { path: string; bestSize: string; net: string; netBps: number; pnlPerGas: number }[];
};

export default function AdvancedScannerHeader() {
  // ----- MIN defaults -----
  const [base, setBase] = useState('WMATIC');
  const [maxIn, setMaxIn] = useState('2');              // 2 base
  const [slippageBps, setSlippageBps] = useState('5');  // 5 bps
  const [flashBps, setFlashBps] = useState('5');        // 5 bps
  const [results, setResults] = useState('50');
  const [refresh, setRefresh] = useState('10s');

  // Alchemy universe
  const [useAlchemy, setUseAlchemy] = useState(true);
  const [alchemyLimit, setAlchemyLimit] = useState('120');

  // Gas: auto by default (EIP-1559)
  const [gasMode, setGasMode] = useState<'auto'|'manual'>('auto');
  const [gasGwei, setGasGwei] = useState('30');

  const refetchMs = useMemo(() => {
    const n = Number(refresh.replace('s',''));
    return isNaN(n) ? 10000 : n * 1000;
  }, [refresh]);

  const qs = useMemo(() => {
    const sp = new URLSearchParams({
      base, maxIn, slippageBps, flashFeeBps: flashBps,
      limit: results,
      gasMode,
      gasGwei,
      includeLosses: '0',
      maxHops: '3',
      useAlchemy: useAlchemy ? '1' : '0',
      alchemyLimit,
    });
    return sp.toString();
  }, [base, maxIn, slippageBps, flashBps, results, gasMode, gasGwei, useAlchemy, alchemyLimit]);

  const { data, isFetching } = useQuery<ScanData>({
    queryKey: ['adv-scan', qs],
    queryFn: async () => {
      const r = await fetch('/api/scan-advanced?' + qs, { cache: 'no-store' });
      if (!r.ok) throw new Error('scan failed');
      return r.json();
    },
    refetchInterval: refetchMs,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-8 gap-3 items-end">
        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Base</span>
          <select value={base} onChange={e=>setBase(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            <option>WMATIC</option>
            <option>WETH</option>
            <option>USDC</option>
          </select>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Max In (base)</span>
          <input value={maxIn} onChange={e=>setMaxIn(e.target.value)}
                 className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Gas</span>
          <div className="flex gap-2">
            <select value={gasMode} onChange={e=>setGasMode(e.target.value as any)}
                    className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
              <option value="auto">Auto (EIP-1559)</option>
              <option value="manual">Manual</option>
            </select>
            <input value={gasGwei} onChange={e=>setGasGwei(e.target.value)}
                   disabled={gasMode === 'auto'}
                   className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 w-24"
                   placeholder="gwei" />
          </div>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Flash fee (bps)</span>
          <input value={flashBps} onChange={e=>setFlashBps(e.target.value)}
                 className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Slippage (bps)</span>
          <input value={slippageBps} onChange={e=>setSlippageBps(e.target.value)}
                 className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Token Source</span>
          <div className="flex gap-2 items-center">
            <input id="use-alchemy" type="checkbox" checked={useAlchemy} onChange={e=>setUseAlchemy(e.target.checked)} />
            <label htmlFor="use-alchemy" className="text-sm">Alchemy Top-N</label>
            <input value={alchemyLimit} onChange={e=>setAlchemyLimit(e.target.value)}
                   className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 w-20" />
          </div>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Results</span>
          <select value={results} onChange={e=>setResults(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
          </select>
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-muted-foreground mb-1">Refresh</span>
          <select value={refresh} onChange={e=>setRefresh(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            <option>5s</option>
            <option>10s</option>
            <option>20s</option>
          </select>
        </label>
      </div>

      <div className="text-xs text-neutral-500">
        {data && <>Block: {data.blockNumber} · ChainId: {data.chainId} · Updated: {new Date(data.ts * 1000).toLocaleTimeString()}</>}
        {isFetching && <span className="ml-2 text-neutral-400">Scanning…</span>}
      </div>

      {/* Tables you already render can consume data.single / data.multi */}
    </div>
  );
}
