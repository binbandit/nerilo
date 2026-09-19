const locks = new Set<string>();
export const isTaskLocked = (id: string) => locks.has(id);
export async function withTaskLock<T>(
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  if (locks.has(id))
    throw new Error("The task workspace is being updated. Try again shortly.");
  locks.add(id);
  try {
    return await work();
  } finally {
    locks.delete(id);
  }
}
