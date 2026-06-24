/** Normalise an unknown thrown value to a display string. The view layer's host
 *  capabilities already return normalised `{ ok: false, error }` results, so this
 *  only backs the defensive `catch` around an unexpected throw. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
