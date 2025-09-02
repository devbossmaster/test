export function candidateSizes(max: bigint) {
  const ONE = 10n ** 18n;
  const arr = [1n, 2n, 5n, 10n, 15n, 25n, 50n, 75n, 100n].map(v => v * ONE).filter(v => v <= max);
  return arr.length ? arr : [max];
}
