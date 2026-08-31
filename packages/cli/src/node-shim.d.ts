declare const process: {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly pid: number;
  readonly platform: string;
  readonly stdin: {
    readonly isTTY?: boolean;
    setEncoding(value: string): void;
    on(event: string, listener: (chunk: string) => void): void;
    once(event: string, listener: (chunk: string | Uint8Array) => void): void;
  };
  readonly stdout: { write(value: string): boolean };
  readonly execPath: string;
  cwd(): string;
  kill(pid: number, signal: number | string): void;
  exitCode?: number;
};
declare const Buffer: {
  from(
    value: string | Uint8Array,
    encoding?: string,
  ): Uint8Array & {
    toString(encoding?: string): string;
    byteLength: number;
  };
  concat(values: readonly unknown[]): Uint8Array & { byteLength: number };
};
declare function fetch(
  input: string,
  init?: unknown,
): Promise<{ readonly status: number; text(): Promise<string> }>;
declare namespace NodeJS {
  interface ErrnoException extends Error {
    readonly code?: string;
  }
}
declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function copyFile(from: string, to: string): Promise<void>;
  export function mkdir(path: string, options?: unknown): Promise<void>;
  export function open(
    path: string,
    flags: string,
    mode?: number,
  ): Promise<{
    writeFile(data: string, encoding?: string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function rename(from: string, to: string): Promise<void>;
  export function rm(path: string, options?: unknown): Promise<void>;
  export function stat(path: string): Promise<{ isDirectory(): boolean }>;
  export function lstat(path: string): Promise<{
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
    readonly size: number;
  }>;
  export function writeFile(path: string, data: string, options?: unknown): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
}
declare module 'node:os' {
  export function homedir(): string;
  export function platform(): string;
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:child_process' {
  export interface ChildProcess {
    readonly pid?: number;
    unref(): void;
  }
  export function spawn(command: string, args?: readonly string[], options?: unknown): ChildProcess;
}
declare module 'node:net' {
  export function createConnection(path: string): unknown;
}
declare module 'node:url' {
  export function fileURLToPath(value: string | URL): string;
}
