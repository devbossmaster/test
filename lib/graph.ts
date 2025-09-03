// lib/graph.ts
// Multi-hop path utilities (supports up to 4 hops) + slippage-aware simulation.

import type { Address } from "viem";

export type Edge = {
  from: Address;
  to: Address;
  // Deterministic quote for a given input (must include pool math/fees internally).
  // Can be sync or async. Return 0n when not routable.
  quote: (amountIn: bigint) => Promise<bigint> | bigint;
  dexKey: string;
  cap?: bigint; // optional capacity hint
  meta?: any;
};

export type Path = {
  nodes: Address[]; // includes start & end
  edges: Edge[];    // edges.length === nodes.length - 1
};

const lc = (a: Address) => a.toLowerCase();

export async function simulatePath(
  p: Path,
  amountIn: bigint
): Promise<bigint> {
  let x = amountIn;
  for (const e of p.edges) {
    if (x <= 0n) return 0n;
    const out = await e.quote(x);
    if (!out || out <= 0n) return 0n;
    x = out;
  }
  return x;
}

/**
 * Conservative haircut per hop via slippageBps (e.g. 30 = 0.30%).
 * If your quote() already fully models slippage for the chosen size,
 * you can pass slippageBps=0 to skip the haircut.
 */
export async function simulatePathWithSlippage(
  p: Path,
  amountIn: bigint,
  slippageBps: number
): Promise<bigint> {
  const den = 10_000n;
  const slip = BigInt(Math.max(0, slippageBps));
  let x = amountIn;
  for (const e of p.edges) {
    if (x <= 0n) return 0n;
    const out = await e.quote(x);
    if (!out || out <= 0n) return 0n;
    const hair = (out * slip) / den;
    x = out - hair;
  }
  return x;
}

/**
 * Enumerate simple paths start -> ... -> end with hop counts in {2,3,4}.
 * - No repeated intermediate nodes.
 * - Optional allowedMid filter (lowercased addresses) to constrain search space.
 */
export function buildKHopPaths(
  edges: Edge[],
  start: Address,
  end: Address,
  maxHops: 2 | 3 | 4,
  allowedMid?: Set<string>,
): Path[] {
  const E = edges;
  const allow = (a: Address) => !allowedMid || allowedMid.has(lc(a));

  function* next(from: Address) {
    for (const e of E) if (lc(e.from) === lc(from)) yield e;
  }

  const out: Path[] = [];

  // 2 hops: s -> A -> e
  if (maxHops >= 2) {
    for (const e1 of next(start)) {
      if (lc(e1.to) === lc(start)) continue;
      if (!allow(e1.to)) continue;
      for (const e2 of next(e1.to)) {
        if (lc(e2.to) !== lc(end)) continue;
        out.push({ nodes: [start, e1.to, end], edges: [e1, e2] });
      }
    }
  }

  // 3 hops: s -> A -> B -> e
  if (maxHops >= 3) {
    for (const e1 of next(start)) {
      const A = e1.to;
      if (lc(A) === lc(start)) continue;
      if (!allow(A)) continue;

      for (const e2 of next(A)) {
        const B = e2.to;
        if (lc(B) === lc(start) || lc(B) === lc(A)) continue;
        if (!allow(B)) continue;

        for (const e3 of next(B)) {
          if (lc(e3.to) !== lc(end)) continue;
          out.push({ nodes: [start, A, B, end], edges: [e1, e2, e3] });
        }
      }
    }
  }

  // 4 hops: s -> A -> B -> C -> e
  if (maxHops >= 4) {
    for (const e1 of next(start)) {
      const A = e1.to;
      if (lc(A) === lc(start)) continue;
      if (!allow(A)) continue;

      for (const e2 of next(A)) {
        const B = e2.to;
        if (lc(B) === lc(start) || lc(B) === lc(A)) continue;
        if (!allow(B)) continue;

        for (const e3 of next(B)) {
          const C = e3.to;
          if (lc(C) === lc(start) || lc(C) === lc(A) || lc(C) === lc(B)) continue;
          if (!allow(C)) continue;

          for (const e4 of next(C)) {
            if (lc(e4.to) !== lc(end)) continue;
            out.push({
              nodes: [start, A, B, C, end],
              edges: [e1, e2, e3, e4],
            });
          }
        }
      }
    }
  }

  return out;
}
