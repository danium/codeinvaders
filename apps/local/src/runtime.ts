import { appDataPaths } from './storage.js';
import { startLocalBroker } from './broker.js';

type RuntimeHooks = { on(signal: string, listener: () => void): void };

/** Production child-process entry used by the lifecycle CLI. It is deliberately
 * separate from index.ts so importing the local library never starts a server. */
export async function runLocalRuntime(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const bind = env.CODEINVADERS_BIND ?? '127.0.0.1';
  const portText = env.CODEINVADERS_PORT ?? '43177';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('CODEINVADERS_PORT must be 1-65535');
  const dataRoot = env.CODEINVADERS_DATA_DIR;
  const secret = env.CODEINVADERS_BROWSER_SECRET;
  const broker = await startLocalBroker({
    host: bind,
    port,
    ...(dataRoot === undefined ? {} : { dataRoot }),
    ...(secret === undefined ? {} : { launchSecret: secret }),
  });
  const paths = appDataPaths(dataRoot);
  const stop = async () => {
    await broker.stop();
    try {
      const fs = await import('node:fs/promises');
      await fs.rm(paths.config, { force: true });
    } catch {
      /* best effort cleanup */
    }
  };
  const hooks = process as unknown as RuntimeHooks;
  hooks.on('SIGINT', () => void stop().finally(() => process.exit(0)));
  hooks.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
  await new Promise<void>(() => undefined);
}

if (process.argv?.[1]?.endsWith('runtime.js')) {
  runLocalRuntime().catch((error: unknown) => {
    console.error(
      `CodeInvaders local runtime failed: ${error instanceof Error ? error.message : 'startup error'}`,
    );
    process.exit(1);
  });
}
