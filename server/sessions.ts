type SendFn = (data: unknown) => void;

const sessions = new Map<string, SendFn>();

export function registerSession(id: string, send: SendFn): void {
  sessions.set(id, send);
}

export function removeSession(id: string): void {
  sessions.delete(id);
}

export function pushToSession(id: string, data: unknown): boolean {
  const send = sessions.get(id);
  if (!send) return false;
  send(data);
  return true;
}
