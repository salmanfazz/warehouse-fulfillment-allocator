import { createHash, timingSafeEqual } from 'node:crypto';

// Compares two strings without leaking where they differ or how long either is: both are turned
// into fixed-length SHA-256 digests first, and the digests are compared in constant time.
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// "Authorization: Bearer <secret>", which is what Vercel sends to cron routes. An unset or empty
// secret never authorises anyone: the check fails closed.
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  // The token is everything after "Bearer " with no whitespace in it, so a secret that contained
  // whitespace could never match (it fails closed; generated secrets are hex).
  const match = /^Bearer (\S+)$/i.exec(header ?? '');
  return match !== null && safeEqual(match[1] as string, secret);
}
