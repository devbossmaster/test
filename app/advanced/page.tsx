// /app/advanced/page.tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_UNIVERSE } from '@/lib/tokens';

function useAdvancedScan(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: ['scan-advanced', qs],
    queryFn: async () => {
      const r = await fetch('/api/scan-advanced?' + qs, { cache: 'no-store' });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: Number(params.interval || '10000'),
  });
}

function human(n: string | number, decimals = 18) {
  const x = typeof n === 'string' ? BigInt(n) : BigInt(Math.floor(n));
  const dp = 10n ** BigInt(decimals);
  const i = x / dp; const f = x % dp;
  const fs = f.toString().padStart(decimals, '0').replace(/0+$/,'');
  return fs ? `${i}.${fs}` : `${i}`;
}

export default function AdvancedPage() {
  const [base, setBase] = useState('WMATIC');
  const [q, setQ] = useState(DEFAULT_UNIVERSE.join(','));
  const [maxInUi, setMaxInUi] = useState('10');   // in base units
  const [gas, setGas] = useState('30');           // gwei
  const [flashBps, setFlashBps] = useState('9');
  const [slip, setSlip] = useState('50');
  const [limit, setLimit] = useState('50');       // 10/20/50/100/250
  const [interval, setInterval] = useState('10000'); // ms

  const maxIn = useMemo(() => {
    const dp = 18; const [i,f=''] = maxInUi.split('.');
    return (i + f.padEnd(dp,'0')).slice(0, i.length + dp).replace(/\D/g,'') || '0';
  }, [maxInUi]);

  const params = { base, q, maxIn, gas, flashBps, slip, limit, interval };
  const { data, isLoading, refetch } = useAdvancedScan(params);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Advanced Scanner (Polygon — Live)</h1>

      <div className="grid grid-cols-1 md:grid-cols-8 gap-3">
        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Base</span>
          <select value={base} onChange={e=>setBase(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            <option>WMATIC</option>
          </select>
        </label>

        <label className="flex flex-col md:col-span-3">
          <span className="text-sm text-neutral-400 mb-1">Quote CSV (universe)</span>
          <input value={q} onChange={e=>setQ(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" placeholder="USDC,WETH,DAI,..." />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Max In (base)</span>
          <input value={maxInUi} onChange={e=>setMaxInUi(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Gas (gwei)</span>
          <input value={gas} onChange={e=>setGas(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Flash fee (bps)</span>
          <input value={flashBps} onChange={e=>setFlashBps(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Slippage (bps)</span>
          <input value={slip} onChange={e=>setSlip(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800" />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Results</span>
          <select value={limit} onChange={e=>setLimit(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            {['10','20','50','100','250'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-sm text-neutral-400 mb-1">Refresh</span>
          <select value={interval} onChange={e=>setInterval(e.target.value)} className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800">
            <option value="5000">5s</option>
            <option value="10000">10s</option>
            <option value="20000">20s</option>
            <option value="60000">60s</option>
          </select>
        </label>
        <div className="flex items-end">
          <button onClick={()=>refetch()} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500">{isLoading ? 'Scanning…' : 'Scan'}</button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-3 bg-neutral-900 font-medium">Single-hop</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="p-3">Route</th><th className="p-3">Pair</th><th className="p-3 text-right">Best Size</th><th className="p-3 text-right">Net (base)</th></tr></thead>
            <tbody>
              {isLoading && (<tr><td className="p-3" colSpan={4}>Scanning…</td></tr>)}
              {!isLoading && (!data?.single || data.single.length===0) && (<tr><td className="p-3" colSpan={4}>No profitable single-hop routes.</td></tr>)}
              {data?.single?.map((r:any,i:number)=>(
                <tr key={i} className="border-t border-neutral-800">
                  <td className="p-3">{r.route}</td>
                  <td className="p-3">{r.base}/{r.quote}</td>
                  <td className="p-3 text-right">{human(r.bestIn)}</td>
                  <td className="p-3 text-right">{human(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border border-neutral-800 rounded-2xl overflow-hidden">
          <div className="p-3 bg-neutral-900 font-medium">Multi-hop (≤2)</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="p-3">Path</th><th className="p-3 text-right">Best Size</th><th className="p-3 text-right">Net (base)</th></tr></thead>
            <tbody>
              {isLoading && (<tr><td className="p-3" colSpan={3}>Scanning…</td></tr>)}
              {!isLoading && (!data?.multi || data.multi.length===0) && (<tr><td className="p-3" colSpan={3}>No profitable multi-hop routes.</td></tr>)}
              {data?.multi?.map((r:any,i:number)=>(
                <tr key={i} className="border-t border-neutral-800">
                  <td className="p-3">{r.path}</td>
                  <td className="p-3 text-right">{human(r.bestIn)}</td>
                  <td className="p-3 text-right">{human(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
