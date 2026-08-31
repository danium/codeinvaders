export const appName = 'codeinvaders-local' as const;
export { LocalBroker, startLocalBroker, webSocketFrame } from './broker.js';
export { deriveLocalIpcPath } from './broker.js';
export type { LocalBrokerOptions, RuntimeStatus } from './broker.js';
export {
  BrowserSessionStore,
  RUNTIME_LIMITS,
  assertLoopbackHost,
  isLoopbackHost,
  secureJsonParse,
} from './security.js';
export { BoundedQueue, RateLimiter } from './queue.js';
export {
  applicationDataRoot,
  appDataPaths,
  ensureAppData,
  atomicWriteJson,
  discoverJournalStreams,
  readJson,
  readOrCreateSalt,
  readRuntimeConfig,
  recoverSdkIngress,
  safeDeleteAll,
  writeRuntimeConfig,
} from './storage.js';
export type { AppDataPaths } from './storage.js';
export { mapTransition, mapEvents, presentationMapper, MAPPER_VERSION } from './mapper.js';
export type { AnimationIntent, IntentKind, MapperInput } from './mapper.js';
export { ArenaModel, coalesceEffects, reduceDensity, semanticTimeAt } from './arena.js';
export type { ArenaEntity, ArenaEntityKind, ArenaSnapshot } from './arena.js';
export { runArenaLoadProfile } from './performance.js';
export type { PerformanceSample } from './performance.js';
export { WebGLArenaRenderer, ThreeArenaRenderer } from './webgl.js';
export type { ArenaCanvas, ThreeArenaOptions } from './webgl.js';
export { encodeIpcFrame, IpcFrameDecoder } from './ipc.js';
export { APP_CSS, APP_JS, ARENA_JS, CONTENT_SECURITY_POLICY, renderAppShell } from './ui.js';
