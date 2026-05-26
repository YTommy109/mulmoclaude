export function resolveClientDir(envValue: string | undefined, defaultDir: string): string {
  return envValue || defaultDir;
}
