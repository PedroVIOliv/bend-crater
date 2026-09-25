import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendResults, readResults, writeJSON } from "./store";
import type { Cell } from "./types";

const cell = (bend: string): Cell => ({
  pkg: "0xab", file: "a.bend", bend, status: "pass", error: "",
  ms: 1, checked_at: "2026-09-25T00:00:00Z", runner: 1,
});

test("a missing results file reads as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  expect(await readResults(join(dir, "results.jsonl"))).toEqual([]);
});

test("append then read keeps order across appends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  const p = join(dir, "sub", "results.jsonl");
  await appendResults(p, [cell("2.0.8")]);
  await appendResults(p, [cell("2.0.9"), cell("2.0.10")]);
  expect((await readResults(p)).map((c) => c.bend)).toEqual(["2.0.8", "2.0.9", "2.0.10"]);
});

test("appending nothing creates nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  const p = join(dir, "results.jsonl");
  await appendResults(p, []);
  expect(await Bun.file(p).exists()).toBe(false);
});

test("writeJSON is pretty and ends with a newline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  const p = join(dir, "x.json");
  await writeJSON(p, { a: 1 });
  expect(await Bun.file(p).text()).toBe('{\n  "a": 1\n}\n');
});
