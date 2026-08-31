declare const process: {
  exit(code?: number): never;
  readonly stdin: {
    setEncoding(encoding: string): void;
    on(event: string, listener: (chunk: string) => void): void;
  };
  readonly stdout: { write(value: string, callback?: () => void): boolean };
};
