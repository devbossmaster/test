export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(
    JSON.stringify({
      MOCK_MODE: process.env.MOCK_MODE ?? '(unset)',
      NEXT_PUBLIC_MOCK_MODE: process.env.NEXT_PUBLIC_MOCK_MODE ?? '(unset)',
      hasAlchemy: !!process.env.ALCHEMY_POLYGON_URL,
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}
