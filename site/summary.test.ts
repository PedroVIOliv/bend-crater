import { expect, test } from "bun:test";
import { isOk, latestCells, pkgStatus, releaseNews, rowSummary } from "./summary.js";

const c = (pkg: string, file: string, bend: string, status: string) =>
  ({ pkg, file, bend, status, error: "", ms: 1, checked_at: "", runner: 1 });
const P = (hash: string, files: string[]) =>
  ({ hash, files: Object.fromEntries(files.map((f) => [f, 1])), name: null, version: null, desc: "", ts: 0, dependents: 0 });

test("the later line for the same cell wins", () => {
  const m = latestCells([c("p", "a.bend", "2.0.8", "dep_missing"), c("p", "a.bend", "2.0.8", "pass")]);
  expect(m.get("p|a.bend|2.0.8").status).toBe("pass");
});

test("package status is the worst of its files", () => {
  const m = latestCells([c("p", "a.bend", "v", "unsafe"), c("p", "b.bend", "v", "timeout"), c("p", "c.bend", "v", "pass")]);
  expect(pkgStatus(m, P("p", ["a.bend", "b.bend", "c.bend", "x.c"]), "v")).toBe("timeout");
});

test("no .bend files, or nothing checked, is null", () => {
  expect(pkgStatus(new Map(), P("p", ["x.c"]), "v")).toBeNull();
  expect(pkgStatus(new Map(), P("p", ["a.bend"]), "v")).toBeNull();
});

test("isOk", () => {
  expect(["pass", "unsafe", "fail", "timeout", "dep_missing"].map(isOk)).toEqual([true, true, false, false, false]);
});

const V = ["2.0.8", "2.0.9", "2.0.10", "2.0.11"];
test("row summaries", () => {
  expect(rowSummary(["pass", "pass", "unsafe", "pass"], V)).toBe("checks on every release");
  expect(rowSummary(["pass", "pass", "fail", "fail"], V)).toBe("checks on 2.0.8–2.0.9, not since 2.0.10");
  expect(rowSummary(["fail", "pass", "fail", "fail"], V)).toBe("checks on 2.0.9, not since 2.0.10");
  expect(rowSummary(["fail", "fail", "pass", "pass"], V)).toBe("checks since 2.0.10");
  expect(rowSummary(["fail", "fail", "fail", "fail"], V)).toBe("does not check on any release");
  expect(rowSummary([null, null, "pass", "pass"], V)).toBe("checks on every release");
  expect(rowSummary([null, null, null, null], V)).toBe("not checked yet");
});

test("release news compares the newest release to the one before", () => {
  const rels = [{ version: "2.0.28", published_at: "" }, { version: "2.0.27", published_at: "" }];
  const pkgs = { a: P("a", ["x.bend"]), b: P("b", ["x.bend"]), c: P("c", ["x.bend"]) };
  const m = latestCells([
    c("a", "x.bend", "2.0.27", "pass"), c("a", "x.bend", "2.0.28", "fail"),
    c("b", "x.bend", "2.0.27", "fail"), c("b", "x.bend", "2.0.28", "unsafe"),
    c("c", "x.bend", "2.0.27", "pass"),
  ]);
  expect(releaseNews(m, pkgs, rels)).toEqual({ version: "2.0.28", prev: "2.0.27", broke: ["a"], fixed: ["b"] });
  expect(releaseNews(m, pkgs, rels.slice(0, 1))).toBeNull();
});
