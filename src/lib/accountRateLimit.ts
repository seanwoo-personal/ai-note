const attempts = new Map<string, number[]>();

export function consumeAccountRateLimit(key: string, maxAttempts = 8, windowMs = 15 * 60 * 1_000): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= maxAttempts) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 2_000) {
    for (const [candidate, values] of attempts) {
      if (values.every((time) => now - time >= windowMs)) attempts.delete(candidate);
    }
  }
  return true;
}
