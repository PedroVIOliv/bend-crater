import { expect, test } from "bun:test";
import { runPool } from "./pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("never more than `jobs` at once, all done", async () => {
  let live = 0, peak = 0;
  const done: number[] = [];
  await runPool([1, 2, 3, 4, 5, 6], 2, Infinity, async (x) => {
    live++; peak = Math.max(peak, live); await sleep(10); live--; return x;
  }, (r) => done.push(r));
  expect(peak).toBe(2);
  expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
});

test("no item starts after the deadline", async () => {
  const started = await runPool([1, 2, 3, 4], 1, Date.now() + 25, async () => sleep(20), () => {});
  expect(started).toBe(2);
});
