/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'node:crypto' {
  export function randomBytes(size: number): { toString(encoding: string): string };
  export function createHash(name: string): {
    update(value: string): { digest(encoding: string): string };
  };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
declare module 'node:module' {
  export function createRequire(url: string): { resolve(specifier: string): string };
}
declare module 'node:os' {
  export function homedir(): string;
  export function platform(): string;
  export function tmpdir(): string;
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function lstat(
    path: string,
  ): Promise<{ isSymbolicLink?(): boolean; isDirectory?(): boolean }>;
  export function link(from: string, to: string): Promise<void>;
  export function mkdir(path: string, options?: unknown): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdtemp(prefix: string): Promise<string>;
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
  export function realpath(path: string): Promise<string>;
  export function rename(from: string, to: string): Promise<void>;
  export function rm(path: string, options?: unknown): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(path: string, data: string, options?: unknown): Promise<void>;
}
declare module 'node:http' {
  export function createServer(handler: (request: unknown, response: unknown) => void): unknown;
}
declare module 'node:net' {
  export interface Socket {
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    write(value: string | Uint8Array): boolean;
    end(value?: string | Uint8Array): void;
    destroy(): void;
  }
  export function createServer(handler: (socket: Socket) => void): unknown;
  export function createConnection(path: string): Socket;
  export function createConnection(port: number, host: string): Socket;
}
declare const process: {
  pid: number;
  platform: string;
  argv?: string[];
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
};
declare type Buffer = any;
declare const Buffer: {
  alloc(size: number): any;
  from(value: unknown, encoding?: string): any;
  byteLength(value: string, encoding?: string): number;
  concat(values: any[]): any;
};
