export function resolveHelperSocketPath(
  root: string,
  platform?: NodeJS.Platform,
  uid?: number,
): string;
export function ensureHelperSocketDirectory(socketPath: string): Promise<void>;
