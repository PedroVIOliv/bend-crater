export async function runPool<T, R>(
  items: T[], jobs: number, deadline: number,
  work: (t: T) => Promise<R>, onDone: (r: R) => void,
): Promise<number> {
  let next = 0;
  const lane = async () => {
    while (next < items.length && Date.now() < deadline) onDone(await work(items[next++]));
  };
  await Promise.all(Array.from({ length: jobs }, lane));
  return next;
}
