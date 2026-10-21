// Keeps the result of `load` for `ttlMs`. Callers that arrive while a load is running share it,
// a failed load is not kept, and `clear` also stops a load that started earlier from being stored.
export function cached<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let stored: { data: T; loadedAt: number } | null = null;
  let running: Promise<T> | null = null;
  let generation = 0;

  return {
    get(): Promise<T> {
      if (stored && now() - stored.loadedAt < ttlMs) return Promise.resolve(stored.data);
      if (running) return running;
      const startedIn = generation;
      const started = load()
        .then((data) => {
          if (startedIn === generation) stored = { data, loadedAt: now() };
          return data;
        })
        .finally(() => {
          if (running === started) running = null;
        });
      running = started;
      return started;
    },
    clear(): void {
      generation++;
      stored = null;
      running = null;
    },
  };
}
