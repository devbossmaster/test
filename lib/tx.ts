import type { Hex } from 'viem';
import { getPublicClient } from './viemClient';

export async function broadcastRawTxPolygon({ rawTx, usePrivate }: { rawTx: Hex; usePrivate?: boolean }) {
  if (usePrivate) {
    const url = process.env.PRIVATE_POLYGON_RPC_URL;
    if (!url) throw new Error('PRIVATE_POLYGON_RPC_URL not set');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_sendRawTransaction', params:[rawTx] }) });
    const j = await r.json(); if (j.error) throw new Error(j.error.message || 'private tx broadcast failed'); return j.result as string;
  }
  const client = getPublicClient();
  return client.request({ method: 'eth_sendRawTransaction', params: [rawTx] }) as Promise<string>;
}
