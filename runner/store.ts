import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Cell } from "./types";

export async function readResults(path: string): Promise<Cell[]> {
  const f = Bun.file(path);
  if (!(await f.exists())) return [];
  return (await f.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export async function appendResults(path: string, cells: Cell[]): Promise<void> {
  if (cells.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, cells.map((c) => JSON.stringify(c) + "\n").join(""));
}

export async function writeJSON(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}
