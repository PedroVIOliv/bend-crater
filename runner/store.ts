import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Cell } from "./types";

const SUFFIX = ".jsonl.gz";

export const shardPath = (dir: string, bend: string) => join(dir, bend + SUFFIX);

const parseLines = (text: string): Cell[] =>
  text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

async function readShard(path: string): Promise<string> {
  const f = Bun.file(path);
  if (!(await f.exists())) return "";
  return new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await f.arrayBuffer())));
}

export async function readResults(dir: string): Promise<Cell[]> {
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const shards = names.filter((n) => n.endsWith(SUFFIX)).sort();
  return (await Promise.all(shards.map((n) => readShard(join(dir, n))))).flatMap(parseLines);
}

// Read-modify-write of whole shards: callers must not run two appends concurrently.
export async function appendResults(dir: string, cells: Cell[]): Promise<void> {
  const byBend = Map.groupBy(cells, (c) => c.bend);
  for (const [bend, group] of byBend) {
    const path = shardPath(dir, bend);
    const text = (await readShard(path)) + group.map((c) => JSON.stringify(c) + "\n").join("");
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, Bun.gzipSync(new TextEncoder().encode(text)));
  }
}

export async function writeJSON(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}
