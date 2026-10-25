import { DEFAULT_EXEC_MAX_QUEUED, ExecError } from "./exec.ts";

const requests = new Map<string, Promise<unknown>>();
let pending = 0;

// @ref LLP 0013#app-permissions — a recovery read must wait for earlier writes, even after HTTP disconnects
export function runPermissionRequest<T>(
  serial: string,
  pkg: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (pending >= DEFAULT_EXEC_MAX_QUEUED) {
    return Promise.reject(new ExecError("queue-full", "permission request queue is full"));
  }
  const key = JSON.stringify([serial, pkg]);
  const previous = requests.get(key) ?? Promise.resolve();
  pending++;
  const current = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      pending--;
      if (requests.get(key) === current) requests.delete(key);
    });
  requests.set(key, current);
  return current;
}
