declare class Buffer extends Uint8Array {
  static from(value: string, encoding?: string): Buffer;
  static byteLength(value: string, encoding?: string): number;
  static concat(values: readonly Uint8Array[]): Buffer;
  readonly byteLength: number;
  toString(encoding?: string): string;
}
declare module 'node:fs' {
  interface FileHandle {
    writeFile(data: Uint8Array): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }
  export const promises: {
    mkdir(path: string, options?: unknown): Promise<void>;
    readdir(path: string, options?: unknown): Promise<string[]>;
    stat(path: string): Promise<{ readonly size: number; readonly mtimeMs: number }>;
    writeFile(path: string, data: Uint8Array, options?: unknown): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    readFile(path: string, encoding: string): Promise<string>;
    open(path: string, flags: string, mode?: number): Promise<FileHandle>;
    unlink(path: string): Promise<void>;
    link(existingPath: string, newPath: string): Promise<void>;
    lstat(path: string): Promise<{ readonly isSymbolicLink: () => boolean }>;
    rmdir(path: string): Promise<void>;
  };
}
declare module 'node:path' {
  export function resolve(path: string): string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
  export const sep: string;
}
declare module 'node:crypto' {
  export function randomBytes(size: number): Buffer;
  export function createHash(name: string): {
    update(value: string): { digest(encoding: string): string };
  };
}
declare module 'node:net' {
  export interface Socket {
    setEncoding(encoding: string): void;
    on(event: string, listener: (chunk: string | Buffer) => void): this;
    once(event: string, listener: () => void): this;
    write(data: Uint8Array): boolean;
    end(data?: Uint8Array): void;
    destroy(): void;
  }
  export function createConnection(path: string): Socket;
}
