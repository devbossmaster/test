import { NextRequest } from 'next/server';
import { broadcastRawTxPolygon } from '@/lib/tx';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { rawTx, private: usePrivate } = await req.json();
    const hash = await broadcastRawTxPolygon({ rawTx, usePrivate });
    return new Response(JSON.stringify({ hash }), { headers: { 'content-type': 'application/json' } });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e.message ?? 'broadcast failed' }), { status: 500 });
  }
}
