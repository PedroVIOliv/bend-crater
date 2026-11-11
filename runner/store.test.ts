import { expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendResults, readResults, shardPath, writeJSON } from "./store";
import type { Cell } from "./types";

const cell = (bend: string, file = "a.bend"): Cell => ({
  pkg: "0xab", file, bend, status: "pass", error: "",
  ms: 1, checked_at: "2026-09-25T00:00:00Z", runner: 1,
});

test("a missing results directory reads as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  expect(await readResults(join(dir, "results"))).toEqual([]);
});

test("cells go to one gzipped shard per release", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "crater-")), "results");
  await appendResults(dir, [cell("2.0.8"), cell("2.0.9")]);
  expect((await readdir(dir)).sort()).toEqual(["2.0.8.jsonl.gz", "2.0.9.jsonl.gz"]);
  const raw = new Uint8Array(await Bun.file(shardPath(dir, "2.0.8")).arrayBuffer());
  expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(raw)))).toEqual(cell("2.0.8"));
});

test("append then read keeps order within a release across appends", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "crater-")), "results");
  await appendResults(dir, [cell("2.0.8", "a.bend")]);
  await appendResults(dir, [cell("2.0.8", "b.bend"), cell("2.0.9"), cell("2.0.8", "c.bend")]);
  const got = await readResults(dir);
  expect(got.filter((c) => c.bend === "2.0.8").map((c) => c.file)).toEqual(["a.bend", "b.bend", "c.bend"]);
  expect(got).toHaveLength(4);
});

test("appending nothing creates nothing", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "crater-")), "results");
  await appendResults(dir, []);
  expect(await readResults(dir)).toEqual([]);
  expect(await Bun.file(dir).exists()).toBe(false);
});

test("writeJSON is pretty and ends with a newline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crater-"));
  const p = join(dir, "x.json");
  await writeJSON(p, { a: 1 });
  expect(await Bun.file(p).text()).toBe('{\n  "a": 1\n}\n');
});
