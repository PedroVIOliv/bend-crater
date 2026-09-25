import { expect, test } from "bun:test";
import { bendFiles, planCells } from "./plan";
import type { Cell, Pkg, Release } from "./types";

const pkg = (hash: string, ts: number, files: string[]): Pkg => ({
  hash, ts, files: Object.fromEntries(files.map((f) => [f, 1])),
  name: null, version: null, desc: "", dependents: 0,
});
const rel = (version: string): Release => ({ version, published_at: "", asset_url: "u" });
const cell = (pkg: string, file: string, bend: string, extra: Partial<Cell> = {}): Cell => ({
  pkg, file, bend, status: "pass", error: "", ms: 1,
  checked_at: "2026-09-25T00:00:00Z", runner: 1, ...extra,
});
const NOW = new Date("2026-09-25T12:00:00Z");
const key = (t: { pkg: string; file: string; bend: string }) => `${t.pkg} ${t.file} ${t.bend}`;

test("only .bend files, subdirectories kept", () => {
  expect(bendFiles(pkg("a", 1, ["LICENSE", "x.c", "src/b.bend", "a.bend"])))
    .toEqual(["a.bend", "src/b.bend"]);
});

test("a package with no .bend files plans nothing", () => {
  expect(planCells([pkg("a", 1, ["x.c", "LICENSE"])], [rel("2.0.8")], [], NOW)).toEqual([]);
});

test("every missing cell, newest release first, then newest package", () => {
  const todos = planCells(
    [pkg("old", 1, ["a.bend"]), pkg("new", 2, ["a.bend", "src/b.bend"])],
    [rel("2.0.9"), rel("2.0.10")],
    [cell("new", "a.bend", "2.0.10")], NOW);
  expect(todos.map(key)).toEqual([
    "new src/b.bend 2.0.10", "old a.bend 2.0.10",
    "new a.bend 2.0.9", "new src/b.bend 2.0.9", "old a.bend 2.0.9",
  ]);
});

test("an older runner version is re-planned", () => {
  const todos = planCells([pkg("p", 1, ["a.bend"])], [rel("2.0.8")],
    [cell("p", "a.bend", "2.0.8", { runner: 0 })], NOW, 1);
  expect(todos.length).toBe(1);
});

test("dep_missing is retried after 24 h, not before", () => {
  const at = (iso: string) => planCells([pkg("p", 1, ["a.bend"])], [rel("2.0.8")],
    [cell("p", "a.bend", "2.0.8", { status: "dep_missing", checked_at: iso })], NOW).length;
  expect(at("2026-09-25T00:00:00Z")).toBe(0);
  expect(at("2026-09-24T11:00:00Z")).toBe(1);
});

test("the latest line for a cell wins", () => {
  const todos = planCells([pkg("p", 1, ["a.bend"])], [rel("2.0.8")], [
    cell("p", "a.bend", "2.0.8", { status: "dep_missing", checked_at: "2026-09-01T00:00:00Z" }),
    cell("p", "a.bend", "2.0.8", { status: "pass" }),
  ], NOW);
  expect(todos).toEqual([]);
});

test("releases without a binary for this platform are skipped", () => {
  expect(planCells([pkg("p", 1, ["a.bend"])], [{ version: "2.0.8", published_at: "", asset_url: null }], [], NOW))
    .toEqual([]);
});
