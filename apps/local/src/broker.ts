/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  EventJournal,
  orderedEvents,
  reduceEvents,
  initialSemanticState,
  type SemanticState,
} from '@codeinvaders/core';
import { canonicalizeIngress } from '@codeinvaders/core';
import type { AnyCoreEvent } from '@codeinvaders/protocol';
import {
  BrowserSessionStore,
  RUNTIME_LIMITS,
  assertLoopbackHost,
  bearerToken,
  createSecret,
  hasValidOrigin,
  secureJsonParse,
} from './security.js';
import { BoundedQueue, RateLimiter } from './queue.js';
import {
  appDataPaths,
  discoverJournalStreams,
  ensureAppData,
  recoverSdkIngress,
  safeDeleteAll,
  type AppDataPaths,
  writeRuntimeConfig,
} from './storage.js';
import { APP_CSS, APP_JS, ARENA_JS, CONTENT_SECURITY_POLICY, renderAppShell } from './ui.js';
import { mapEvents } from './mapper.js';

const runtimeRequire = createRequire(import.meta.url);
const threeBuildDirectory = dirname(runtimeRequire.resolve('three'));
const threeModulePath = join(threeBuildDirectory, 'three.module.js');
const threeCorePath = join(threeBuildDirectory, 'three.core.js');

interface Headers {
  readonly [key: string]: string | string[] | undefined;
}
interface Request {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Headers;
  on(event: string, listener: (...args: unknown[]) => void): void;
}
interface Response {
  statusCode: number;
  setHeader(name: string, value: string | number): void;
  end(body?: string): void;
}
interface HttpServer {
  listen(port: number, host: string, callback: () => void): void;
  close(callback: (error?: Error) => void): void;
  on(event: string, listener: (...args: any[]) => void): this;
  address?: () => { port: number } | string | null;
}
interface NetServer {
  listen(path: string, callback: () => void): void;
  close(callback: (error?: Error) => void): void;
  on?(event: string, listener: (...args: any[]) => void): this;
}

export interface LocalBrokerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly ipcPath?: string;
  readonly dataRoot?: string;
  readonly allowedOrigin?: string;
  readonly launchSecret?: string;
  readonly journal?: EventJournal;
}
export interface RuntimeStatus {
  readonly running: boolean;
  readonly host: string;
  readonly port: number;
  readonly origin: string;
  readonly ipcPath: string;
  readonly authenticatedClients: number;
  readonly queueDropped: number;
  readonly dataRoot: string;
}
interface Client {
  readonly socket: Socket;
  readonly queue: BoundedQueue<string>;
  readonly limiter: RateLimiter;
  authenticated: boolean;
  blocked: boolean;
}

const header = (response: Response, value: number, contentType = 'application/json'): void => {
  response.statusCode = value;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
};
const json = (response: Response, value: unknown, status = 200): void => {
  header(response, status);
  response.end(JSON.stringify(value));
};
const readBody = (request: Request): Promise<string> =>
  new Promise((resolve, reject) => {
    let bytes = 0;
    let body = '';
    request.on('data', (chunk: unknown) => {
      const text = typeof chunk === 'string' ? chunk : String(chunk);
      bytes += Buffer.byteLength(text);
      if (bytes > RUNTIME_LIMITS.maxBodyBytes) reject(new Error('payload-too-large'));
      else body += text;
    });
    request.on('end', () => resolve(body));
    request.on('error', (error: unknown) => reject(error));
  });
function getPath(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}
type ReplayQuery = Readonly<{
  through?: number;
  session?: string;
  workspace?: string;
}>;
function replayQuery(url: string): ReplayQuery {
  try {
    const parameters = new URL(url, 'http://localhost').searchParams;
    const throughText = parameters.get('through');
    const through = throughText === null ? undefined : Number(throughText);
    const boundedId = (name: string): string | undefined => {
      const value = parameters.get(name);
      return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
    };
    const session = boundedId('session');
    const workspace = boundedId('workspace');
    return {
      ...(through !== undefined && Number.isSafeInteger(through) && through >= 0
        ? { through }
        : {}),
      ...(session === undefined ? {} : { session }),
      ...(workspace === undefined ? {} : { workspace }),
    };
  } catch {
    return {};
  }
}
function requestOriginAllowed(request: Request, expectedOrigin: string): boolean {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (origin) return hasValidOrigin(origin, expectedOrigin);
  try {
    const expected = new URL(expectedOrigin);
    const host = typeof request.headers.host === 'string' ? request.headers.host : '';
    const fetchSite =
      typeof request.headers['sec-fetch-site'] === 'string'
        ? request.headers['sec-fetch-site']
        : undefined;
    return host === expected.host && (fetchSite === undefined || fetchSite === 'same-origin');
  } catch {
    return false;
  }
}

export class LocalBroker {
  readonly host: string;
  readonly requestedPort: number;
  readonly paths: AppDataPaths;
  readonly sessions: BrowserSessionStore;
  private server: HttpServer | undefined;
  private ipc: NetServer | undefined;
  private actualPort = 0;
  private running = false;
  private configuredOrigin: string | undefined;
  private configuredIpcPath: string | undefined;
  private state: SemanticState = initialSemanticState();
  private events: AnyCoreEvent[] = [];
  private readonly clients = new Set<Client>();
  private readonly suppliedJournal: EventJournal | undefined;
  private readonly journals = new Map<string, EventJournal>();
  private readonly httpLimiter = new RateLimiter(RUNTIME_LIMITS.maxRequestsPerMinute, 60_000);
  constructor(options: LocalBrokerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    assertLoopbackHost(this.host);
    this.requestedPort = options.port ?? 0;
    this.paths = appDataPaths(options.dataRoot);
    this.sessions = new BrowserSessionStore(undefined, undefined, options.launchSecret);
    if (options.ipcPath !== undefined && !isValidIpcPath(options.ipcPath, this.paths.root))
      throw new Error('ipcPath must be the installation-local CodeInvaders endpoint');
    this.configuredIpcPath = options.ipcPath;
    if (options.allowedOrigin) {
      const parsed = new URL(options.allowedOrigin);
      if (parsed.protocol !== 'http:' || !assertAllowedOriginHost(parsed.hostname))
        throw new Error('allowedOrigin must be loopback HTTP');
      this.configuredOrigin = options.allowedOrigin;
    }
    this.suppliedJournal = options.journal;
    if (this.suppliedJournal)
      this.journals.set(this.suppliedJournal.streamId, this.suppliedJournal);
  }
  async start(): Promise<{
    readonly url: string;
    readonly ipcPath: string;
    readonly secret: string;
  }> {
    if (this.running)
      return { url: this.url, ipcPath: this.ipcPath, secret: this.sessions.launchToken };
    await ensureAppData(this.paths);
    const ipcPath = this.ipcPath;
    this.server = createHttpServer((request, response) => {
      void this.handle(request as unknown as Request, response as unknown as Response);
    }) as unknown as HttpServer;
    try {
      await new Promise<void>((resolve, reject) => {
        const server = this.server!;
        server.on('error', reject);
        try {
          server.listen(this.requestedPort, this.host, resolve);
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      await this.closeHttp();
      throw error;
    }
    const address = (
      this.server as unknown as { address?: () => { port: number } | string | null }
    ).address?.();
    this.actualPort = address && typeof address === 'object' ? address.port : this.requestedPort;
    this.server.on('upgrade', (request: Request, socket: Socket) =>
      this.handleUpgrade(request, socket),
    );
    this.ipc = createNetServer((socket) => this.handleIpc(socket)) as unknown as NetServer;
    try {
      await new Promise<void>((resolve, reject) => {
        this.ipc!.on?.('error', reject);
        try {
          this.ipc!.listen(ipcPath, resolve);
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      await this.closeIpc();
      await this.closeHttp();
      throw error;
    }
    try {
      const recovered: AnyCoreEvent[] = [];
      if (this.suppliedJournal) {
        const existing = await this.suppliedJournal.events();
        if (existing.ok) recovered.push(...existing.value);
      }
      for (const streamId of await discoverJournalStreams(this.paths.journal)) {
        const logicalStreamId = decodeStreamDirectory(streamId);
        if (this.journals.has(logicalStreamId)) continue;
        const journal = new EventJournal({
          root: join(this.paths.journal, streamId),
          streamId: logicalStreamId,
        });
        this.journals.set(logicalStreamId, journal);
        const existing = await journal.events();
        if (existing.ok) recovered.push(...existing.value);
      }
      this.events = orderedEvents(recovered);
      this.state = reduceEvents(this.events);
      await recoverSdkIngress(
        this.paths.spool,
        async (canonicalJson) => (await this.ingest(JSON.parse(canonicalJson))).ok,
      );
      await writeRuntimeConfig(this.paths, {
        pid: process.pid,
        bind: this.host,
        port: this.actualPort,
        ipcPath,
        epochId: createSecret(16),
        startedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.closeIpc();
      await this.closeHttp();
      throw error;
    }
    this.running = true;
    return { url: this.url, ipcPath, secret: this.sessions.launchToken };
  }
  get url(): string {
    return `http://${this.host}:${this.actualPort || this.requestedPort}/#${encodeURIComponent(this.sessions.launchToken)}`;
  }
  get origin(): string {
    return this.configuredOrigin ?? `http://${this.host}:${this.actualPort || this.requestedPort}`;
  }
  get ipcPath(): string {
    return this.configuredIpcPath ?? deriveIpcPath(this.paths.root);
  }
  async stop(): Promise<void> {
    this.sessions.invalidate();
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    await this.closeIpc();
    await this.closeHttp();
    try {
      const { rm } = await import('node:fs/promises');
      await rm(this.paths.config, { force: true });
    } catch {
      /* stale metadata is handled by the lifecycle CLI */
    }
    this.running = false;
  }
  private async closeIpc(): Promise<void> {
    if (this.ipc) {
      await new Promise<void>((resolve) => this.ipc!.close(() => resolve()));
      this.ipc = undefined;
    }
  }
  private async closeHttp(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = undefined;
    }
  }
  status(): RuntimeStatus {
    return {
      running: this.running,
      host: this.host,
      port: this.actualPort || this.requestedPort,
      origin: this.origin,
      ipcPath: this.ipcPath,
      authenticatedClients: this.clients.size,
      queueDropped: [...this.clients].reduce((total, client) => total + client.queue.dropped, 0),
      dataRoot: this.paths.root,
    };
  }
  async retain(maxBytes: number): Promise<unknown> {
    const results = await Promise.all(
      [...this.journals.values()].map((journal) => journal.retain(maxBytes)),
    );
    return results.every((result) => result.ok)
      ? { ok: true, streams: results.length }
      : { ok: false, results };
  }
  async deleteAll(confirm = false): Promise<unknown> {
    if (!confirm) return { ok: false, code: 'confirmation-required' };
    const result = await safeDeleteAll(this.paths);
    if (result.skipped.length === 0) {
      this.journals.clear();
      this.events = [];
      this.state = initialSemanticState();
    }
    return result;
  }
  async ingest(
    input: unknown,
  ): Promise<
    | { readonly ok: true; readonly event: AnyCoreEvent }
    | { readonly ok: false; readonly code: string }
  > {
    const parsed = canonicalizeIngress(input);
    if (!parsed.ok) return parsed;
    const journal =
      this.journals.get(parsed.event.source.streamId) ??
      (() => {
        const stream = encodeStreamDirectory(parsed.event.source.streamId);
        const created = new EventJournal({
          root: join(this.paths.journal, stream),
          streamId: parsed.event.source.streamId,
        });
        this.journals.set(parsed.event.source.streamId, created);
        return created;
      })();
    const ack = await journal.append(parsed.event);
    if (!ack.ok) return { ok: false, code: ack.code };
    const event = { ...parsed.event, sequence: ack.value.sequence } as AnyCoreEvent;
    if (!ack.value.duplicate) {
      this.events.push(event);
      this.state = reduceEvents([event], this.state);
      this.broadcast({ type: 'event', event });
    }
    return { ok: true, event };
  }
  private async handle(request: Request, response: Response): Promise<void> {
    const method = request.method ?? 'GET';
    const path = getPath(request.url ?? '/');
    if (path.startsWith('/api/') && !this.httpLimiter.allow())
      return json(response, { error: 'rate-limit-exceeded' }, 429);
    if (
      path.startsWith('/api/') &&
      path !== '/api/health' &&
      !requestOriginAllowed(request, this.origin)
    )
      return json(response, { error: 'origin-rejected' }, 403);
    if (path === '/api/health' && method === 'GET')
      return json(response, { ok: true, service: 'codeinvaders-local', version: 1 });
    if (path === '/' || path === '/index.html') {
      header(response, 200, 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.end(renderAppShell(this.sessions.launchToken));
    }
    if (path === '/assets/app.v0.1.0.css' && method === 'GET') {
      header(response, 200, 'text/css; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return response.end(APP_CSS);
    }
    if (path === '/assets/app.v0.1.0.js' && method === 'GET') {
      header(response, 200, 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return response.end(APP_JS);
    }
    if (path === '/assets/arena.v0.1.0.js' && method === 'GET') {
      header(response, 200, 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return response.end(ARENA_JS);
    }
    if (path === '/assets/three.v0.180.0.module.js' && method === 'GET') {
      header(response, 200, 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return response.end(await readFile(threeModulePath, 'utf8'));
    }
    if (path === '/assets/three.core.js' && method === 'GET') {
      header(response, 200, 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return response.end(await readFile(threeCorePath, 'utf8'));
    }
    if (path === '/api/session' && method === 'POST') {
      try {
        const body = secureJsonParse(await readBody(request));
        const secret =
          body &&
          typeof body === 'object' &&
          typeof (body as Record<string, unknown>).secret === 'string'
            ? ((body as Record<string, unknown>).secret as string)
            : undefined;
        const session = secret ? this.sessions.exchange(secret) : undefined;
        return session
          ? json(response, { token: session.token, expiresAt: session.expiresAt })
          : json(response, { error: 'invalid-session' }, 401);
      } catch {
        return json(response, { error: 'invalid-request' }, 400);
      }
    }
    if (!this.authenticated(request))
      return json(response, { error: 'authentication-required' }, 401);
    if (path === '/api/status' && method === 'GET') return json(response, this.status());
    if (path === '/api/state' && method === 'GET')
      return json(response, { state: this.state, degraded: this.state.gaps.length > 0 });
    if (path === '/api/sessions' && method === 'GET')
      return json(response, {
        sessions: Object.entries(this.state.sessions).map(([id, value]) => ({ id, ...value })),
      });
    if (path === '/api/replay' && method === 'GET') {
      const query = replayQuery(request.url ?? '/api/replay');
      const availableSessions = [
        ...new Set(this.events.map((event) => event.scope.sessionId)),
      ].sort();
      const availableWorkspaces = [
        ...new Set(this.events.map((event) => event.scope.workspaceId)),
      ].sort();
      const scopedEvents = this.events.filter(
        (event) =>
          (query.session === undefined || event.scope.sessionId === query.session) &&
          (query.workspace === undefined || event.scope.workspaceId === query.workspace),
      );
      const events =
        query.through === undefined ? scopedEvents : scopedEvents.slice(0, query.through);
      const state = reduceEvents(events, initialSemanticState());
      const intents = mapEvents(events, initialSemanticState(), (previous, event) =>
        reduceEvents([event], previous),
      );
      return json(response, {
        events,
        intents,
        state,
        throughSequence: events.length,
        liveSequence: scopedEvents.length,
        availableSessions,
        availableWorkspaces,
      });
    }
    if (path === '/api/recordings' && method === 'DELETE') {
      if (request.headers['x-confirm-delete-all'] !== 'true')
        return json(response, { error: 'confirmation-required' }, 400);
      return json(response, await this.deleteAll(true));
    }
    return json(response, { error: 'not-found' }, 404);
  }
  private authenticated(request: Request): boolean {
    const token =
      bearerToken(request.headers as Record<string, string | string[] | undefined>) ??
      (typeof request.headers['x-codeinvaders-session'] === 'string'
        ? request.headers['x-codeinvaders-session']
        : undefined);
    return !!token && this.sessions.authenticate(token);
  }
  private handleIpc(socket: Socket): void {
    // The adapter deadline is intentionally shorter than durable ingestion. A
    // caller may close before the acknowledgement is ready; absorb the late
    // write error so it cannot become an uncaught EPIPE/unhandled socket error.
    socket.on('error', () => socket.destroy());
    let data: any = Buffer.alloc(0);
    const limiter = new RateLimiter(RUNTIME_LIMITS.maxRequestsPerMinute, 60_000);
    socket.on('data', (chunk: Uint8Array | string) => {
      if (!limiter.allow()) {
        socket.destroy();
        return;
      }
      data = Buffer.concat([data, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
      if (data.length > RUNTIME_LIMITS.maxBodyBytes) {
        socket.destroy();
        return;
      }
      while (data.length) {
        const headerEnd = data.indexOf(0x3a);
        if (headerEnd < 0) {
          if (data.indexOf(0x0a) >= 0) {
            socket.write('ERR\n');
            socket.destroy();
          }
          return;
        }
        const headerText = data.subarray(0, headerEnd).toString('ascii');
        const match = /^CIIP\/1 ([0-9]{1,7})$/.exec(headerText);
        if (!match) {
          socket.write('ERR\n');
          socket.destroy();
          return;
        }
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length < 2 || length > RUNTIME_LIMITS.maxEventBytes) {
          socket.write('ERR\n');
          socket.destroy();
          return;
        }
        const frameEnd = headerEnd + 1 + length + 1;
        if (data.length < frameEnd) return;
        if (data[frameEnd - 1] !== 0x0a) {
          socket.write('ERR\n');
          socket.destroy();
          return;
        }
        const body = data.subarray(headerEnd + 1, headerEnd + 1 + length).toString('utf8');
        data = data.subarray(frameEnd);
        try {
          const input = secureJsonParse(body, {
            ...RUNTIME_LIMITS,
            maxBodyBytes: RUNTIME_LIMITS.maxEventBytes,
          });
          void this.ingest(input).then((result) => {
            if (result.ok) socket.write('ACK\n');
            else {
              socket.write('ERR\n');
              socket.destroy();
            }
          });
        } catch {
          socket.write('ERR\n');
          socket.destroy();
          return;
        }
      }
    });
  }
  private broadcast(message: unknown): void {
    const encoded = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.queue.size >= RUNTIME_LIMITS.maxClientQueue) {
        client.socket.destroy();
        this.clients.delete(client);
        continue;
      }
      client.queue.push(encoded);
      if (!client.blocked) this.flush(client);
    }
  }
  private flush(client: Client): void {
    while (client.queue.size) {
      const item = client.queue.shift();
      if (!item) break;
      try {
        if (!client.socket.write(webSocketFrame(item))) {
          client.blocked = true;
          return;
        }
      } catch {
        client.socket.destroy();
        this.clients.delete(client);
        break;
      }
    }
  }
  /** Authenticate a WebSocket upgrade using an origin check and a subprotocol token, never a query token. */
  handleUpgrade(request: Request, socket: Socket): boolean {
    const protocol =
      typeof request.headers['sec-websocket-protocol'] === 'string'
        ? request.headers['sec-websocket-protocol']
        : '';
    const token = protocol
      .split(',')
      .map((x) => x.trim())
      .find((x) => x.startsWith('codeinvaders-session.'))
      ?.slice('codeinvaders-session.'.length);
    if (request.url && getPath(request.url) !== '/api/live') {
      socket.destroy();
      return false;
    }
    if (
      !requestOriginAllowed(request, this.origin) ||
      !token ||
      !this.sessions.authenticate(token) ||
      this.clients.size >= RUNTIME_LIMITS.maxClients
    ) {
      socket.destroy();
      return false;
    }
    const key =
      typeof request.headers['sec-websocket-key'] === 'string'
        ? request.headers['sec-websocket-key']
        : '';
    if (!key) {
      socket.destroy();
      return false;
    }
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: codeinvaders-session.${token}\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client: Client = {
      socket,
      queue: new BoundedQueue(RUNTIME_LIMITS.maxClientQueue),
      limiter: new RateLimiter(RUNTIME_LIMITS.maxRequestsPerMinute, 60_000),
      authenticated: true,
      blocked: false,
    };
    this.clients.add(client);
    socket.on('close', () => this.clients.delete(client));
    socket.on('drain', () => {
      client.blocked = false;
      this.flush(client);
    });
    this.flush(client);
    return true;
  }
}

function deriveIpcPath(root: string): string {
  if (process.platform === 'win32') {
    let hash = 2166136261;
    for (let index = 0; index < root.length; index += 1)
      hash = Math.imul(hash ^ root.charCodeAt(index), 16777619);
    return `\\\\.\\pipe\\CodeInvaders-${(hash >>> 0).toString(16)}`;
  }
  return `${root}/CodeInvaders.sock`;
}
function encodeStreamDirectory(streamId: string): string {
  return `s64-${Buffer.from(streamId, 'utf8').toString('base64url')}`;
}
function decodeStreamDirectory(directory: string): string {
  if (!directory.startsWith('s64-')) return directory;
  try {
    const value = Buffer.from(directory.slice(4), 'base64url').toString('utf8');
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : directory;
  } catch {
    return directory;
  }
}
function isValidIpcPath(value: string, root: string): boolean {
  if (process.platform === 'win32')
    return (
      value.startsWith('\\\\.\\pipe\\CodeInvaders-') &&
      /^[A-Za-z0-9._-]{1,96}$/.test(value.slice('\\\\.\\pipe\\CodeInvaders-'.length))
    );
  return value === resolve(value) && resolve(value) === resolve(join(root, 'CodeInvaders.sock'));
}
function assertAllowedOriginHost(host: string): boolean {
  try {
    assertLoopbackHost(host);
    return true;
  } catch {
    return false;
  }
}
export const deriveLocalIpcPath = deriveIpcPath;

export function webSocketFrame(value: string): any {
  const body = Buffer.from(value) as any;
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body] as any);
  if (body.length < 65536)
    return Buffer.concat([
      Buffer.from([0x81, 126, body.length >> 8, body.length & 255]),
      body,
    ] as any);
  const extended = Buffer.alloc(8);
  extended.writeBigUInt64BE(BigInt(body.length), 0);
  return Buffer.concat([Buffer.from([0x81, 127]), extended, body] as any);
}
export const startLocalBroker = async (options: LocalBrokerOptions = {}): Promise<LocalBroker> => {
  const broker = new LocalBroker(options);
  await broker.start();
  return broker;
};
