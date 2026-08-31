declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: unknown): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function appendFile(path: string, data: string, encoding: string): Promise<void>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function rename(a: string, b: string): Promise<void>;
  export function stat(path: string): Promise<{ size: number }>;
  export function lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink?(): boolean }>;
  export function realpath(path: string): Promise<string>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function open(
    path: string,
    flags: string,
    mode?: number,
  ): Promise<{
    writeFile(data: string, encoding: string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;
  export function rm(path: string, options?: unknown): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function symlink(target: string, path: string): Promise<void>;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare const Buffer: { byteLength(value: string): number };
declare const process: { platform: string };
