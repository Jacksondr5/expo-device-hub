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
  const deadline = performance.now() + 10_000;
  const timeoutError = new ExecError(
    "deadline-exceeded",
    "permission request timed out waiting after 10000ms",
  );
  let timer: ReturnType<typeof setTimeout>;
  const waiting = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), 10_000);
  });
  const current = previous
    .catch(() => {})
    .then(() => {
      clearTimeout(timer);
      if (performance.now() >= deadline) throw timeoutError;
      return operation();
    })
    .finally(() => {
      pending--;
      if (requests.get(key) === current) requests.delete(key);
    });
  requests.set(key, current);
  // Keep the tail until earlier work finishes; timing out a caller must not let later work overtake it.
  return Promise.race([current, waiting]);
}
