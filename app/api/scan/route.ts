// app/api/scan/route.ts (or pages/api/scan.ts)
import { NextResponse } from 'next/server';
import { runAdvancedScan, fromQuery } from '@/lib/scanner';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  const params = fromQuery(q);
  // force Alchemy universe unless explicitly disabled
  params.useAlchemyUniverse = q.useAlchemy === '0' ? false : true;
  if (!params.alchemyLimit) params.alchemyLimit = 120;

  const data = await runAdvancedScan(params);
  return NextResponse.json(data);
}
