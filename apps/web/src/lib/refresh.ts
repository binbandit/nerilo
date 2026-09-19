/** Collapse concurrent refreshes into one request and one trailing refresh. */
export function coalesceRefresh(work: () => Promise<void>) {
  let pending: Promise<void> | null = null;
  let requested = false;
  return () => {
    requested = true;
    pending ??= Promise.resolve().then(async () => {
      try {
        while (requested) {
          requested = false;
          await work();
        }
      } finally {
        pending = null;
      }
    });
    return pending;
  };
}
