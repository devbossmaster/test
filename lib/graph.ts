// Path-finding utilities (≤3 hops) + slippage-aware simulation.

import type { Address } from 'viem';

export type Edge = {
  from: Address;
  to: Address;
  // quote(amountIn) -> amountOut
  quote: (amountIn: bigint) => Promise<bigint> | bigint;
  dexKey: string;
  cap?: bigint; // optional capacity hint
  meta?: any;
};

export type Path = {
  nodes: Address[]; // includes start & end
  edges: Edge[];
};

export async function simulatePath(path: Path, amountIn: bigint): Promise<bigint> {
  let amt = amountIn;
  for (const e of path.edges) {
    const out = await e.quote(amt);
    amt = typeof out === 'bigint' ? out : BigInt(out as any);
    if (amt === 0n) break;
  }
  return amt;
}

export async function simulatePathWithSlippage(path: Path, amountIn: bigint, slippageBps: number): Promise<bigint> {
  let amt = amountIn;
  const den = 10_000n;
  const slip = BigInt(slippageBps);
  for (const e of path.edges) {
    const out = await e.quote(amt);
    let next = typeof out === 'bigint' ? out : BigInt(out as any);
    // Apply conservative per-leg minOut
    next = next - (next * slip / den);
    if (next <= 0n) return 0n;
    amt = next;
  }
  return amt;
}

// Build ≤3-hop roundtrip paths start -> ... -> end using a small bridge whitelist.
// We avoid cycles and keep unique nodes.
export function buildKHopPaths(
  edges: Edge[],
  start: Address,
  end: Address,
  maxHops: 2 | 3,
  allowedMid?: Set<string>, // lowercase address strings; if omitted, allow all
): Path[] {
  const lc = (a: Address) => a.toLowerCase();
  const E = edges;

  function* nextEdges(from: Address) {
    for (const e of E) if (lc(e.from) === lc(from)) yield e;
  }

  const paths: Path[] = [];

  // 1-hop
  for (const e1 of nextEdges(start)) {
    if (lc(e1.to) === lc(end)) paths.push({ nodes: [start, end], edges: [e1] });
  }
  // 2-hop
  for (const e1 of nextEdges(start)) {
    if (allowedMid && !allowedMid.has(lc(e1.to))) continue;
    for (const e2 of nextEdges(e1.to)) {
      if (lc(e2.to) !== lc(end)) continue;
      // no cycle (start != mid)
      if (lc(e1.to) === lc(start)) continue;
      paths.push({ nodes: [start, e1.to, end], edges: [e1, e2] });
    }
  }
  if (maxHops === 3) {
    // 3-hop
    for (const e1 of nextEdges(start)) {
      if (allowedMid && !allowedMid.has(lc(e1.to))) continue;
      for (const e2 of nextEdges(e1.to)) {
        if (allowedMid && !allowedMid.has(lc(e2.to))) continue;
        if (lc(e2.to) === lc(start)) continue;
        for (const e3 of nextEdges(e2.to)) {
          if (lc(e3.to) !== lc(end)) continue;
          // avoid repeats
          const mids = [lc(e1.to), lc(e2.to)];
          if (new Set(mids).size !== mids.length) continue;
          paths.push({ nodes: [start, e1.to, e2.to, end], edges: [e1, e2, e3] });
        }
      }
    }
  }
  return paths;
}
