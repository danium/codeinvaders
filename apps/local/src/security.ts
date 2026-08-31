import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const RUNTIME_LIMITS = Object.freeze({
  maxBodyBytes: 256 * 1024,
  maxEventBytes: 64 * 1024,
  maxJsonDepth: 12,
  maxArrayItems: 512,
  maxObjectKeys: 128,
  maxClients: 32,
  maxClientQueue: 256,
  maxRequestsPerMinute: 240,
  sessionTtlMs: 15 * 60 * 1000,
  secretTtlMs: 60 * 1000,
});

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host))
    throw new Error(
      'CodeInvaders local browser service must bind to loopback (localhost, 127.0.0.0/8, or ::1)',
    );
}

export function createSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
export function digestSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasValidOrigin(origin: string | undefined, allowedOrigin: string): boolean {
  return typeof origin === 'string' && origin === allowedOrigin;
}

export type Session = Readonly<{ token: string; createdAt: number; expiresAt: number }>;

/** Single-use launch secret exchange. No token is persisted or accepted in a URL query. */
export class BrowserSessionStore {
  private launchSecret: string;
  private launchExpiresAt: number;
  private session: Session | undefined;
  constructor(
    private readonly ttlMs = RUNTIME_LIMITS.sessionTtlMs,
    now = Date.now(),
    initialSecret = createSecret(),
  ) {
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(initialSecret)) throw new Error('invalid-launch-secret');
    this.launchSecret = initialSecret;
    this.launchExpiresAt = now + RUNTIME_LIMITS.secretTtlMs;
  }
  get launchToken(): string {
    return this.launchSecret;
  }
  get launchExpiresAtMs(): number {
    return this.launchExpiresAt;
  }
  exchange(candidate: string, now = Date.now()): Session | undefined {
    if (!equalSecret(candidate, this.launchSecret) || now >= this.launchExpiresAt) return undefined;
    this.launchSecret = createSecret();
    this.launchExpiresAt = 0;
    const token = createSecret();
    this.session = Object.freeze({ token, createdAt: now, expiresAt: now + this.ttlMs });
    return this.session;
  }
  authenticate(candidate: string, now = Date.now()): boolean {
    if (!this.session || now >= this.session.expiresAt) {
      this.session = undefined;
      return false;
    }
    return equalSecret(candidate, this.session.token);
  }
  rotate(now = Date.now()): void {
    this.session = undefined;
    this.launchSecret = createSecret();
    this.launchExpiresAt = now + RUNTIME_LIMITS.secretTtlMs;
  }
  invalidate(): void {
    this.session = undefined;
    this.launchSecret = createSecret();
    this.launchExpiresAt = 0;
  }
}

export function secureJsonParse(input: string, limits = RUNTIME_LIMITS): unknown {
  if (Buffer.byteLength(input, 'utf8') > limits.maxBodyBytes) throw new Error('payload-too-large');
  const value: unknown = JSON.parse(input);
  const visit = (node: unknown, depth: number): void => {
    if (depth > limits.maxJsonDepth) throw new Error('json-too-deep');
    if (Array.isArray(node)) {
      if (node.length > limits.maxArrayItems) throw new Error('array-too-large');
      node.forEach((item) => visit(item, depth + 1));
    } else if (node && typeof node === 'object') {
      const keys = Object.keys(node);
      if (keys.length > limits.maxObjectKeys) throw new Error('object-too-large');
      keys.forEach((key) => visit((node as Record<string, unknown>)[key], depth + 1));
    }
  };
  visit(value, 0);
  return value;
}

export function bearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7) : undefined;
}
