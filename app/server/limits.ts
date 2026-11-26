const buckets = new Map<string, number[]>();

/** Janela deslizante em memória. Retorna true se a ação é permitida. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const arr = (buckets.get(key) ?? []).filter((x) => x > t - windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(t);
  buckets.set(key, arr);
  return true;
}

setInterval(() => {
  const t = Date.now();
  for (const [k, v] of buckets) if (!v.some((x) => x > t - 120_000)) buckets.delete(k);
}, 60_000).unref();
