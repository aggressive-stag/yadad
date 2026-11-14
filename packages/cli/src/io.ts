/** Where a command writes. The binary passes the process streams; tests pass collectors. */
export interface Io {
  /** Writes to standard output. */
  readonly out: (text: string) => void;
  /** Writes to standard error. */
  readonly err: (text: string) => void;
  /** The directory relative paths are read from. */
  readonly cwd: string;
}
