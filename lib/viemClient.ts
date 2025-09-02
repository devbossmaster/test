// /lib/viemClient.ts
import { createPublicClient, http } from 'viem';
import { polygon, mainnet } from 'viem/chains';

export type SupportedChain = 'polygon' | 'mainnet';

/** Accepts either a full URL (https://...) or a raw key and returns a usable RPC URL. */
function coerceRpcUrl(raw: string | undefined, chain: SupportedChain): string {
  if (!raw || raw.trim() === '') {
    // try NEXT_PUBLIC_* fallbacks (useful if you only configured public vars)
    raw =
      (chain === 'polygon'
        ? process.env.NEXT_PUBLIC_ALCHEMY_POLYGON_URL
        : process.env.NEXT_PUBLIC_ALCHEMY_ETHEREUM_URL) || '';
  }
  const v = raw.trim();

  // If it's already a URL, keep it.
  if (v.startsWith('http://') || v.startsWith('https://')) return v;

  // If it looks like an Alchemy key (no protocol), build the standard URL.
  // You can change these templates if you use another provider.
  if (/^[A-Za-z0-9_-]{10,}$/i.test(v)) {
    if (chain === 'polygon') return `https://polygon-mainnet.g.alchemy.com/v2/${v}`;
    return `https://eth-mainnet.g.alchemy.com/v2/${v}`;
  }

  throw new Error(
    `Invalid RPC env for ${chain}. Provide a full URL or an Alchemy key. Got: ${v.slice(0, 6)}…`
  );
}

export function getPublicClient(chain: SupportedChain = 'polygon') {
  const url =
    chain === 'polygon'
      ? coerceRpcUrl(process.env.ALCHEMY_POLYGON_URL, 'polygon')
      : coerceRpcUrl(process.env.ALCHEMY_ETHEREUM_URL, 'mainnet');

  return createPublicClient({
    chain: chain === 'polygon' ? polygon : mainnet,
    transport: http(url), // you can add { batch: true } if you want
  });
}
