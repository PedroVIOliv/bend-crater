# bend-crater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type-check every Bend hub package against every `bend` release and publish the results as a static page.

**Architecture:** A Bun/TypeScript runner lists hub packages and `bend` releases, plans the (package, file, release) cells it has no result for, checks them with each release's standalone binary, and appends results to `data/results.jsonl`. A static site in `site/` reads `data/` and renders the grid. A GitHub Actions cron runs the runner hourly, commits `data/` and deploys Pages.

**Tech Stack:** Bun 1.x (runtime, `bun test`, `Bun.spawn`), TypeScript, plain HTML/CSS/ES-module JS, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-09-25-bend-crater-design.md`

## Global Constraints

- Releases checked: every `bendlang/bend` release whose tag is `v2.0.8` or later.
- Check command: `<release>/bend/bin/bend wrapper.bend`, where `wrapper.bend` is `import <hash>/<file> as P` and nothing else. Never `--check-only` (2.0.8 lacks it).
- Each check: fresh temp `HOME`, shared `BEND_LIB=cache/lib`, 60 s timeout, 4 in parallel.
- Statuses: `pass`, `unsafe`, `fail`, `timeout`, `dep_missing`; worst-of order `pass < unsafe < timeout < dep_missing < fail`.
- Error excerpt: from `Error:` on, at most 15 lines, update notice removed, `BEND_LIB` path prefix removed.
- A connection error is never recorded as a result.
- `dep_missing` cells are re-checked after 24 h; cells with `runner` below the current `RUNNER` are re-checked.
- Time budget: no new cell starts after 45 min.
- Hub or GitHub unreachable while loading: exit non-zero, write nothing.
- Site wording is neutral: "does not check on X", never "broken by author".
- No AI attribution in commits, code or docs.

## Review Focus

- A `.bend` file in a subdirectory (`src/containers/hash_table.bend`) is imported as `0x<hash>/src/containers/hash_table.bend` and shown with its path. Test in Task 5 (plan) and Task 6 (wrapper text).
- A dependency fetch that fails mid-check with `Unable to connect` is dropped, not recorded as `fail`. Test in Task 1.
- A package with no `.bend` file (only `.c`/`.js`/`LICENSE`) produces no cells and the site shows "no .bend files" instead of crashing. Test in Task 5 and Task 8.
- The same cell recorded twice (runner bump, dep retry): the later line wins everywhere. Test in Task 8.
- First run with no `data/results.jsonl`: treated as empty. Test in Task 2.

---

## File map

```
package.json               scripts: test, crater, serve
tsconfig.json
runner/types.ts            Status, Pkg, Release, Cell, Todo, RUNNER
runner/versions.ts         parse/compare "2.0.28"
runner/classify.ts         output + exit + timeout -> {status, error} | null
runner/store.ts            read/append results.jsonl, write JSON
runner/hub.ts              page through /packages.json
runner/releases.ts         list GitHub releases, download + unpack a tarball
runner/plan.ts             missing cells, ordered
runner/check.ts            run one cell
runner/pool.ts             bounded-parallel runner with a deadline
runner/main.ts             CLI entry
runner/fixtures/*.txt      captured bend outputs
runner/*.test.ts
site/index.html site/style.css site/app.js
site/summary.js            pure logic shared by site and tests
site/summary.test.ts
data/fixtures/             hand-written small data set
serve.ts                   local dev server with the Pages layout
.github/workflows/crater.yml
README.md
```

---

### Task 1: Scaffold, types and the classifier

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `runner/types.ts`, `runner/classify.ts`, `runner/fixtures/*.txt`
- Test: `runner/classify.test.ts`

**Interfaces:**
- Produces: `Status`, `Pkg`, `Release`, `Cell`, `Todo`, `RUNNER` from `runner/types.ts`; `classify(out: string, code: number | null, timedOut: boolean): { status: Status; error: string } | null` from `runner/classify.ts`.

- [ ] **Step 1: Scaffold**

`package.json`:
```json
{
  "name": "bend-crater",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "crater": "bun runner/main.ts",
    "serve": "bun serve.ts"
  },
  "devDependencies": { "@types/bun": "latest" }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "allowJs": true, "types": ["bun"]
  }
}
```

`.gitignore`:
```
node_modules/
cache/
_site/
```

`runner/types.ts`:
```ts
export type Status = "pass" | "unsafe" | "fail" | "timeout" | "dep_missing";

export const RUNNER = 1;

export interface Pkg {
  hash: string;
  files: Record<string, number>;
  name: string | null;
  version: string | null;
  desc: string;
  ts: number;
  dependents: number;
}

export interface Release {
  version: string;
  published_at: string;
  asset_url: string | null;
}

export interface Todo {
  pkg: string;
  file: string;
  bend: string;
}

export interface Cell extends Todo {
  status: Status;
  error: string;
  ms: number;
  checked_at: string;
  runner: number;
}
```

Run: `bun install`

- [ ] **Step 2: Save captured outputs as fixtures**

These are real outputs recorded on 2026-09-25 with the release binaries.

`runner/fixtures/pass.txt`:
```
All terms check.
bend 2.0.28 is available: run bend update
```

`runner/fixtures/unsafe.txt`:
```
All terms check, with 1 unsafe annotation.
bend 2.0.28 is available: run bend update
```

`runner/fixtures/fail.txt`:
```
Error:
- expected : a fresh constructor name (duplicate declaration: Zero)
- observed : '{'
Location:
192 |   Minus{}
193>|   Zero{}
194 |   Integer{}
```

`runner/fixtures/dep_hash.txt`:
```
Error:
- message  : a file at https://hub.bend-lang.com/0x00000000000000000000000000000000/manifest hashing to 00000000000000000000000000000000
Location:
1>| import 0x00000000000000000000000000000000/x.bend as P
2 | 
bend 2.0.28 is available: run bend update
```

`runner/fixtures/dep_name.txt`:
```
Error:
- message  : a package named nonexistent-pkg-zzzz@1.0.0.0 on https://hub.bend-lang.com
Location:
1>| import nonexistent-pkg-zzzz@1.0.0.0/x.bend as P
2 | 
bend 2.0.28 is available: run bend update
```

`runner/fixtures/old_named.txt`:
```
Error:
- message  : no such file: nonexistent-pkg-zzzz@1.0.0.0/x.bend
Location:
1>| import nonexistent-pkg-zzzz@1.0.0.0/x.bend as P
2 | 
bend 2.0.28 is available: run bend update
```

`runner/fixtures/offline.txt`:
```
TypeError: Unable to connect. Is the computer able to access the url?
bend 2.0.28 is available: run bend update
```

- [ ] **Step 3: Write the failing test**

`runner/classify.test.ts`:
```ts
import { expect, test } from "bun:test";
import { classify } from "./classify";

const fx = (n: string) => Bun.file(`${import.meta.dir}/fixtures/${n}.txt`).text();

test("pass", async () => {
  expect(classify(await fx("pass"), 0, false)).toEqual({ status: "pass", error: "" });
});

test("unsafe exits 0 but is its own status", async () => {
  expect(classify(await fx("unsafe"), 0, false)).toEqual({ status: "unsafe", error: "" });
});

test("fail keeps the error block", async () => {
  const r = classify(await fx("fail"), 1, false)!;
  expect(r.status).toBe("fail");
  expect(r.error.split("\n")[0]).toBe("Error:");
  expect(r.error).toContain("duplicate declaration: Zero");
});

test("update notice is removed from the excerpt", async () => {
  const r = classify(await fx("dep_hash"), 1, false)!;
  expect(r.error).not.toContain("is available");
});

test("excerpt is at most 15 lines", () => {
  const long = "Error:\n" + Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  expect(classify(long, 1, false)!.error.split("\n").length).toBe(15);
});

test("excerpt falls back to the last lines when there is no Error:", () => {
  const r = classify("panic: boom\nstack\n", 1, false)!;
  expect(r).toEqual({ status: "fail", error: "panic: boom\nstack" });
});

test("hub has no manifest for a hash -> dep_missing", async () => {
  expect(classify(await fx("dep_hash"), 1, false)!.status).toBe("dep_missing");
});

test("hub has no such name -> dep_missing", async () => {
  expect(classify(await fx("dep_name"), 1, false)!.status).toBe("dep_missing");
});

test("a release that cannot read a named import is a real fail", async () => {
  expect(classify(await fx("old_named"), 1, false)!.status).toBe("fail");
});

test("a connection error is not a result", async () => {
  expect(classify(await fx("offline"), 1, false)).toBeNull();
});

test("timeout wins over whatever was printed", async () => {
  expect(classify(await fx("pass"), null, true)!.status).toBe("timeout");
});

test("exit 0 without the check line is a fail", () => {
  expect(classify("", 0, false)!.status).toBe("fail");
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `bun test runner/classify.test.ts`
Expected: FAIL, `Cannot find module './classify'`.

- [ ] **Step 5: Implement**

`runner/classify.ts`:
```ts
import type { Status } from "./types";

const NOTICE = /^bend \S+ is available: run bend update$/;
const OFFLINE = /Unable to connect|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/;
const DEP = /a file at \S+\/manifest hashing to |a package named \S+ on \S+/;
const MAX = 15;

function excerpt(lines: string[]): string {
  const at = lines.findIndex((l) => l === "Error:");
  const from = at >= 0 ? lines.slice(at) : lines.slice(-MAX);
  return from.slice(0, MAX).join("\n").trimEnd();
}

export function classify(
  out: string, code: number | null, timedOut: boolean,
): { status: Status; error: string } | null {
  const lines = out.split("\n").filter((l) => !NOTICE.test(l));
  const text = lines.join("\n");
  if (timedOut) return { status: "timeout", error: "" };
  if (code === 0 && /All terms check, with \d+ unsafe annotation/.test(text))
    return { status: "unsafe", error: "" };
  if (code === 0 && /All terms check\./.test(text)) return { status: "pass", error: "" };
  if (OFFLINE.test(text)) return null;
  const error = excerpt(lines);
  return { status: DEP.test(text) ? "dep_missing" : "fail", error };
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test runner/classify.test.ts`
Expected: 12 pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Classify bend output into cell statuses"
```

---

### Task 2: Result store

**Files:**
- Create: `runner/store.ts`
- Test: `runner/store.test.ts`

**Interfaces:**
- Consumes: `Cell` from `runner/types.ts`.
- Produces: `readResults(path: string): Promise<Cell[]>`, `appendResults(path: string, cells: Cell[]): Promise<void>`, `writeJSON(path: string, value: unknown): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`runner/store.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test runner/store.test.ts`
Expected: FAIL, `Cannot find module './store'`.

- [ ] **Step 3: Implement**

`runner/store.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `bun test runner/store.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Store results as append-only JSON lines"
```

---

### Task 3: Hub client

**Files:**
- Create: `runner/hub.ts`, `runner/fixtures/packages_page1.json`, `runner/fixtures/packages_page2.json`
- Test: `runner/hub.test.ts`

**Interfaces:**
- Consumes: `Pkg`.
- Produces: `fetchPackages(hub?: string, get?: typeof fetch): Promise<Pkg[]>` — every package, newest first; throws on any non-OK response or network error.

- [ ] **Step 1: Fixtures**

`runner/fixtures/packages_page1.json`:
```json
{"total":3,"packages":[
 {"hash":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","files":{"LICENSE":1101,"anthropic.bend":9671,"json.bend":16187},"bytes":26959,"ts":1790289598443,"desc":"An unofficial Anthropic SDK for Bend.","name":"bend-anthropic-sdk","version":"0.1.0.0","dependents":0,"mentions":0,"score":0,"hot":140.9,"license":{"file":"LICENSE","id":"MIT"}},
 {"hash":"0x39cbd6b8923682f1e4deba6ee6056b43","files":{"LICENSE":11381,"http.bend":574,"http.c":11221},"bytes":23176,"ts":1790276809012,"desc":"SPDX-License-Identifier: Apache-2.0","name":null,"version":null,"dependents":0,"mentions":0,"score":0,"hot":140.9,"license":{"file":"LICENSE","id":"Apache-2.0"}}
]}
```

`runner/fixtures/packages_page2.json`:
```json
{"total":3,"packages":[
 {"hash":"0x1f4d6c03caf955232d0b0dc6e6f36cf4","files":{"json.bend":20000},"bytes":20000,"ts":1790000000000,"desc":"JSON","name":null,"version":null,"dependents":2,"mentions":0,"score":0,"hot":1,"license":null}
]}
```

- [ ] **Step 2: Write the failing test**

`runner/hub.test.ts`:
```ts
import { expect, test } from "bun:test";
import { fetchPackages } from "./hub";

const page = (n: number) => Bun.file(`${import.meta.dir}/fixtures/packages_page${n}.json`).text();

function fakeFetch(pages: Record<string, () => Promise<Response>>) {
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(url);
    const after = new URL(url).searchParams.get("after")!;
    return pages[after] ? pages[after]() : new Response('{"total":3,"packages":[]}');
  }) as unknown as typeof fetch;
  return { f, seen };
}

test("pages until total is reached and keeps only the fields we use", async () => {
  const { f, seen } = fakeFetch({
    "0": async () => new Response(await page(1)),
    "2": async () => new Response(await page(2)),
  });
  const pkgs = await fetchPackages("https://hub.test", f, 2);
  expect(pkgs.map((p) => p.hash)).toEqual([
    "0x0bc665d2ca2b4a7f7df0c8b32cfaa356",
    "0x39cbd6b8923682f1e4deba6ee6056b43",
    "0x1f4d6c03caf955232d0b0dc6e6f36cf4",
  ]);
  expect(Object.keys(pkgs[0]).sort()).toEqual(
    ["dependents", "desc", "files", "hash", "name", "ts", "version"]);
  expect(seen[0]).toBe("https://hub.test/packages.json?sort=new&limit=2&after=0");
  expect(seen.length).toBe(2);
});

test("stops on an empty page even if total says more", async () => {
  const { f } = fakeFetch({ "0": async () => new Response(await page(1)) });
  expect((await fetchPackages("https://hub.test", f, 2)).length).toBe(2);
});

test("a non-OK response throws", async () => {
  const { f } = fakeFetch({ "0": async () => new Response("down", { status: 502 }) });
  await expect(fetchPackages("https://hub.test", f, 2)).rejects.toThrow(/502/);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `bun test runner/hub.test.ts`
Expected: FAIL, `Cannot find module './hub'`.

- [ ] **Step 4: Implement**

`runner/hub.ts`:
```ts
import type { Pkg } from "./types";

export const HUB = "https://hub.bend-lang.com";

export async function fetchPackages(hub = HUB, get: typeof fetch = fetch, limit = 100): Promise<Pkg[]> {
  const out: Pkg[] = [];
  for (;;) {
    const url = `${hub}/packages.json?sort=new&limit=${limit}&after=${out.length}`;
    const res = await get(url);
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = (await res.json()) as { total: number; packages: Pkg[] };
    for (const p of body.packages)
      out.push({ hash: p.hash, files: p.files, name: p.name, version: p.version,
                 desc: p.desc, ts: p.ts, dependents: p.dependents });
    if (body.packages.length === 0 || out.length >= body.total) return out;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test runner/hub.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "List every hub package through packages.json"
```

---

### Task 4: Versions and releases

**Files:**
- Create: `runner/versions.ts`, `runner/releases.ts`
- Test: `runner/versions.test.ts`, `runner/releases.test.ts`

**Interfaces:**
- Consumes: `Release`.
- Produces: `cmpVersion(a: string, b: string): number` (ascending); `assetName(version: string, platform?: string, arch?: string): string`; `listReleases(get?: typeof fetch, platform?: string, arch?: string): Promise<Release[]>` (newest first, `>= 2.0.8`, drafts and prereleases skipped); `ensureRelease(r: Release, cacheDir: string, get?: typeof fetch): Promise<string>` returning the path of `bend/bin/bend`.

- [ ] **Step 1: Write the failing tests**

`runner/versions.test.ts`:
```ts
import { expect, test } from "bun:test";
import { cmpVersion } from "./versions";

test("numeric, not lexical", () => {
  expect(["2.0.10", "2.0.8", "2.0.28", "2.1.0"].sort(cmpVersion))
    .toEqual(["2.0.8", "2.0.10", "2.0.28", "2.1.0"]);
});
```

`runner/releases.test.ts`:
```ts
import { expect, test } from "bun:test";
import { assetName, listReleases } from "./releases";

test("asset name per platform", () => {
  expect(assetName("2.0.28", "linux", "x64")).toBe("bend-2.0.28-linux-x64.tar.gz");
  expect(assetName("2.0.28", "darwin", "arm64")).toBe("bend-2.0.28-darwin-arm64.tar.gz");
});

const rel = (tag: string, extra: object = {}) => ({
  tag_name: tag, published_at: `2026-09-2${tag.length % 10}T00:00:00Z`,
  draft: false, prerelease: false,
  assets: [{ name: `bend-${tag.slice(1)}-linux-x64.tar.gz`, browser_download_url: `https://dl/${tag}` }],
  ...extra,
});

test("keeps >= 2.0.8, newest first, skips drafts and prereleases, pages", async () => {
  const pages: Record<string, unknown[]> = {
    "1": [rel("v2.0.28"), rel("v2.0.29", { draft: true }), rel("v2.0.9")],
    "2": [rel("v2.0.8"), rel("v2.0.7"), rel("v2.0.10", { prerelease: true })],
  };
  const get = (async (url: string) =>
    new Response(JSON.stringify(pages[new URL(url).searchParams.get("page")!] ?? []))) as unknown as typeof fetch;
  const rs = await listReleases(get, "linux", "x64");
  expect(rs.map((r) => r.version)).toEqual(["2.0.28", "2.0.9", "2.0.8"]);
  expect(rs[0].asset_url).toBe("https://dl/v2.0.28");
});

test("a release without our platform's asset has asset_url null", async () => {
  const get = (async (url: string) => new Response(JSON.stringify(
    new URL(url).searchParams.get("page") === "1" ? [rel("v2.0.28", { assets: [] })] : []))) as unknown as typeof fetch;
  expect((await listReleases(get, "linux", "x64"))[0].asset_url).toBeNull();
});

test("GitHub down throws", async () => {
  const get = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
  await expect(listReleases(get, "linux", "x64")).rejects.toThrow(/503/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test runner/versions.test.ts runner/releases.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`runner/versions.ts`:
```ts
export function cmpVersion(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
```

`runner/releases.ts`:
```ts
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Release } from "./types";
import { cmpVersion } from "./versions";

const API = "https://api.github.com/repos/bendlang/bend/releases";
const FIRST = "2.0.8";

export function assetName(version: string, platform = process.platform, arch = process.arch): string {
  const os = platform === "darwin" ? "darwin" : "linux";
  return `bend-${version}-${os}-${arch === "arm64" ? "arm64" : "x64"}.tar.gz`;
}

interface GhRelease {
  tag_name: string; published_at: string; draft: boolean; prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export async function listReleases(get: typeof fetch = fetch, platform = process.platform, arch = process.arch): Promise<Release[]> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const out: Release[] = [];
  for (let page = 1; ; page++) {
    const res = await get(`${API}?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`${API} answered ${res.status}`);
    const list = (await res.json()) as GhRelease[];
    if (list.length === 0) break;
    for (const r of list) {
      const version = r.tag_name.replace(/^v/, "");
      if (r.draft || r.prerelease || !/^\d+\.\d+\.\d+$/.test(version) || cmpVersion(version, FIRST) < 0) continue;
      const asset = r.assets.find((a) => a.name === assetName(version, platform, arch));
      out.push({ version, published_at: r.published_at, asset_url: asset?.browser_download_url ?? null });
    }
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version));
}

export async function ensureRelease(r: Release, cacheDir: string, get: typeof fetch = fetch): Promise<string> {
  const dir = join(cacheDir, "bend", r.version);
  const bin = join(dir, "bend", "bin", "bend");
  if (await Bun.file(bin).exists()) return bin;
  if (!r.asset_url) throw new Error(`bend ${r.version} has no ${assetName(r.version)}`);
  const res = await get(r.asset_url);
  if (!res.ok) throw new Error(`${r.asset_url} answered ${res.status}`);
  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const tgz = join(tmp, "bend.tar.gz");
  await Bun.write(tgz, res);
  const tar = Bun.spawnSync(["tar", "xzf", tgz, "-C", tmp]);
  if (tar.exitCode !== 0) throw new Error(`tar failed for ${r.version}: ${tar.stderr}`);
  await rm(tgz);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  return bin;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test runner/versions.test.ts runner/releases.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "List bend releases and fetch their binaries"
```

---

### Task 5: Planner

**Files:**
- Create: `runner/plan.ts`
- Test: `runner/plan.test.ts`

**Interfaces:**
- Consumes: `Pkg`, `Release`, `Cell`, `Todo`, `RUNNER`, `cmpVersion`.
- Produces: `bendFiles(p: Pkg): string[]` (sorted); `planCells(pkgs: Pkg[], releases: Release[], results: Cell[], now: Date, runner?: number): Todo[]`.

- [ ] **Step 1: Write the failing test**

`runner/plan.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test runner/plan.test.ts`
Expected: FAIL, `Cannot find module './plan'`.

- [ ] **Step 3: Implement**

`runner/plan.ts`:
```ts
import { type Cell, type Pkg, type Release, RUNNER, type Todo } from "./types";
import { cmpVersion } from "./versions";

const DAY = 24 * 3600 * 1000;

export function bendFiles(p: Pkg): string[] {
  return Object.keys(p.files).filter((f) => f.endsWith(".bend")).sort();
}

export function planCells(pkgs: Pkg[], releases: Release[], results: Cell[], now: Date, runner = RUNNER): Todo[] {
  const latest = new Map<string, Cell>();
  for (const c of results) latest.set(`${c.pkg}|${c.file}|${c.bend}`, c);
  const stale = (c: Cell | undefined) =>
    !c || c.runner < runner ||
    (c.status === "dep_missing" && now.getTime() - Date.parse(c.checked_at) >= DAY);

  const rels = releases.filter((r) => r.asset_url).sort((a, b) => cmpVersion(b.version, a.version));
  const ps = [...pkgs].sort((a, b) => b.ts - a.ts);
  const out: Todo[] = [];
  for (const r of rels)
    for (const p of ps)
      for (const file of bendFiles(p))
        if (stale(latest.get(`${p.hash}|${file}|${r.version}`)))
          out.push({ pkg: p.hash, file, bend: r.version });
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test runner/plan.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Plan the cells that have no current result"
```

---

### Task 6: Checking one cell

**Files:**
- Create: `runner/check.ts`
- Test: `runner/check.test.ts`, `runner/check.integration.test.ts`

**Interfaces:**
- Consumes: `Todo`, `Cell`, `RUNNER`, `classify`, `ensureRelease`, `listReleases`.
- Produces: `wrapperSource(t: Todo): string`; `checkCell(t: Todo, o: { bin: string; libDir: string; timeoutMs: number }): Promise<Cell | null>` (`null` = connection error, not recorded).

- [ ] **Step 1: Write the failing unit test**

The unit test uses a fake `bend`: a shell script that prints what the case needs, so it runs with no network.

`runner/check.test.ts`:
```ts
import { expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCell, wrapperSource } from "./check";

const T = { pkg: "0xab", file: "src/b.bend", bend: "2.0.8" };

async function fakeBend(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "crater-bin-"));
  const bin = join(dir, "bend");
  await Bun.write(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

test("the wrapper imports the file by hash path", () => {
  expect(wrapperSource(T)).toBe("import 0xab/src/b.bend as P\n");
});

test("runs in a fresh HOME with BEND_LIB set, on the wrapper", async () => {
  const bin = await fakeBend('cat "$1"; echo "HOME=$HOME"; echo "LIB=$BEND_LIB"; echo "All terms check."');
  const c = (await checkCell(T, { bin, libDir: "/tmp/lib", timeoutMs: 5000 }))!;
  expect(c.status).toBe("pass");
  expect(c).toMatchObject({ pkg: "0xab", file: "src/b.bend", bend: "2.0.8", runner: 1 });
});

test("the BEND_LIB prefix is removed from errors", async () => {
  const bin = await fakeBend('echo "Error:"; echo "- message  : no such file: $BEND_LIB/0xab/x.bend"; exit 1');
  const c = (await checkCell(T, { bin, libDir: "/tmp/lib", timeoutMs: 5000 }))!;
  expect(c.status).toBe("fail");
  expect(c.error).toContain("no such file: 0xab/x.bend");
});

test("a hang is killed and recorded as timeout", async () => {
  const bin = await fakeBend("exec sleep 30");
  const t0 = Date.now();
  const c = (await checkCell(T, { bin, libDir: "/tmp/lib", timeoutMs: 300 }))!;
  expect(c.status).toBe("timeout");
  expect(Date.now() - t0).toBeLessThan(5000);
});

test("a connection error gives null", async () => {
  const bin = await fakeBend('echo "TypeError: Unable to connect. Is the computer able to access the url?"; exit 1');
  expect(await checkCell(T, { bin, libDir: "/tmp/lib", timeoutMs: 5000 })).toBeNull();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test runner/check.test.ts`
Expected: FAIL, `Cannot find module './check'`.

- [ ] **Step 3: Implement**

`runner/check.ts`:
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify } from "./classify";
import { type Cell, RUNNER, type Todo } from "./types";

export function wrapperSource(t: Todo): string {
  return `import ${t.pkg}/${t.file} as P\n`;
}

export async function checkCell(
  t: Todo, o: { bin: string; libDir: string; timeoutMs: number },
): Promise<Cell | null> {
  const home = await mkdtemp(join(tmpdir(), "crater-home-"));
  try {
    const wrapper = join(home, "wrapper.bend");
    await Bun.write(wrapper, wrapperSource(t));
    const t0 = performance.now();
    const proc = Bun.spawn([o.bin, wrapper], {
      cwd: home,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, BEND_LIB: o.libDir },
      stdout: "pipe", stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, o.timeoutMs);
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    clearTimeout(timer);
    const ms = Math.round(performance.now() - t0);
    const r = classify((out + err).replaceAll(o.libDir + "/", ""), timedOut ? null : code, timedOut);
    if (!r) return null;
    return { ...t, ...r, ms, checked_at: new Date().toISOString(), runner: RUNNER };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `bun test runner/check.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Write the integration test (opt-in, network)**

`runner/check.integration.test.ts`:
```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkCell } from "./check";
import { ensureRelease, listReleases } from "./releases";

const on = process.env.CRATER_INTEGRATION === "1";
const CACHE = join(import.meta.dir, "..", "cache");

test.skipIf(!on)("real releases on two real hub packages", async () => {
  const rels = await listReleases();
  const run = async (pkg: string, file: string, v: string) => {
    const bin = await ensureRelease(rels.find((r) => r.version === v)!, CACHE);
    return (await checkCell({ pkg, file, bend: v }, { bin, libDir: join(CACHE, "lib"), timeoutMs: 60_000 }))!.status;
  };
  const json = "0x1f4d6c03caf955232d0b0dc6e6f36cf4", sdk = "0x0bc665d2ca2b4a7f7df0c8b32cfaa356";
  expect(await run(json, "json.bend", "2.0.8")).toBe("pass");
  expect(await run(json, "json.bend", "2.0.28")).toBe("pass");
  expect(await run(sdk, "json.bend", "2.0.8")).toBe("unsafe");
  expect(await run(sdk, "json.bend", "2.0.27")).toBe("pass");
  expect(await run(sdk, "json.bend", "2.0.28")).toBe("fail");
}, 300_000);
```

Run: `CRATER_INTEGRATION=1 bun test runner/check.integration.test.ts`
Expected: 1 pass (downloads three releases into `cache/`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Check one cell with a release binary in a fresh HOME"
```

---

### Task 7: Pool and the CLI

**Files:**
- Create: `runner/pool.ts`, `runner/main.ts`
- Test: `runner/pool.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `runPool<T, R>(items: T[], jobs: number, deadline: number, work: (t: T) => Promise<R>, onDone: (r: R) => void): Promise<number>` (returns items started); CLI `bun runner/main.ts [--budget-min 45] [--jobs 4] [--limit N] [--data data] [--cache cache]`.

- [ ] **Step 1: Write the failing test**

`runner/pool.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test runner/pool.test.ts`
Expected: FAIL, `Cannot find module './pool'`.

- [ ] **Step 3: Implement the pool**

`runner/pool.ts`:
```ts
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
```

- [ ] **Step 4: Run the test**

Run: `bun test runner/pool.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Write the CLI**

Results are appended in batches of 50 as they finish, so a run killed by the Actions timeout keeps what it did.

`runner/main.ts`:
```ts
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkCell } from "./check";
import { fetchPackages } from "./hub";
import { planCells } from "./plan";
import { runPool } from "./pool";
import { ensureRelease, listReleases } from "./releases";
import { appendResults, readResults, writeJSON } from "./store";
import type { Cell } from "./types";

const { values: a } = parseArgs({ options: {
  "budget-min": { type: "string", default: "45" },
  jobs: { type: "string", default: "4" },
  limit: { type: "string" },
  data: { type: "string", default: "data" },
  cache: { type: "string", default: "cache" },
} });
const data = resolve(a.data!), cache = resolve(a.cache!);
const deadline = Date.now() + Number(a["budget-min"]) * 60_000;
const resultsPath = join(data, "results.jsonl");

const [pkgs, releases] = await Promise.all([fetchPackages(), listReleases()]);
const results = await readResults(resultsPath);
let todos = planCells(pkgs, releases, results, new Date());
if (a.limit) todos = todos.slice(0, Number(a.limit));
console.log(`${pkgs.length} packages, ${releases.length} releases, ${todos.length} cells to check`);

const bins = new Map<string, string>();
for (const v of new Set(todos.map((t) => t.bend)))
  bins.set(v, await ensureRelease(releases.find((r) => r.version === v)!, cache));

await writeJSON(join(data, "packages.json"), Object.fromEntries(pkgs.map((p) => [p.hash, p])));
await writeJSON(join(data, "releases.json"),
  releases.map(({ version, published_at }) => ({ version, published_at })));

let batch: Cell[] = [], done = 0, dropped = 0;
const flush = async () => { await appendResults(resultsPath, batch); batch = []; };
const started = await runPool(todos, Number(a.jobs), deadline,
  (t) => checkCell(t, { bin: bins.get(t.bend)!, libDir: join(cache, "lib"), timeoutMs: 60_000 }),
  (c) => {
    if (!c) { dropped++; return; }
    batch.push(c); done++;
    if (done % 25 === 0) console.log(`${done}/${todos.length}`);
    if (batch.length >= 50) void flush();
  });
await flush();
console.log(`checked ${done}, dropped ${dropped} on connection errors, ${todos.length - started} left for next run`);
```

- [ ] **Step 6: Smoke-run it for real**

Run: `bun runner/main.ts --limit 8 --budget-min 5`
Expected: prints the counts, downloads the newest release, then `checked 8, dropped 0 ...`; `data/results.jsonl` has 8 lines; `data/packages.json` and `data/releases.json` exist.

- [ ] **Step 7: Run all tests and commit**

Run: `bun test`
Expected: all pass, integration skipped.

```bash
git add -A && git commit -m "Run the missing cells in parallel under a time budget"
```

---

### Task 8: Summary logic for the site

**Files:**
- Create: `site/summary.js`
- Test: `site/summary.test.ts`

**Interfaces:**
- Consumes: the `data/` formats (`Cell` lines, `packages.json` keyed by hash, `releases.json` newest first).
- Produces (ES module, plain JS):
  - `latestCells(cells) -> Map<"pkg|file|bend", cell>`
  - `pkgStatus(latest, pkg, bend) -> status | null` (worst of the package's `.bend` files, `null` if none checked)
  - `isOk(status) -> boolean` (`pass` or `unsafe`)
  - `rowSummary(statuses, versions) -> string` (both oldest first; `null` statuses skipped)
  - `releaseNews(latest, pkgs, releases) -> { version, prev, broke: string[], fixed: string[] } | null`

- [ ] **Step 1: Write the failing test**

`site/summary.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test site/summary.test.ts`
Expected: FAIL, `Cannot find module './summary.js'`.

- [ ] **Step 3: Implement**

`site/summary.js`:
```js
const ORDER = ["pass", "unsafe", "timeout", "dep_missing", "fail"];

export const isOk = (s) => s === "pass" || s === "unsafe";

export function latestCells(cells) {
  const m = new Map();
  for (const c of cells) m.set(`${c.pkg}|${c.file}|${c.bend}`, c);
  return m;
}

export function pkgStatus(latest, pkg, bend) {
  let worst = null;
  for (const f of Object.keys(pkg.files)) {
    if (!f.endsWith(".bend")) continue;
    const c = latest.get(`${pkg.hash}|${f}|${bend}`);
    if (c && (worst === null || ORDER.indexOf(c.status) > ORDER.indexOf(worst))) worst = c.status;
  }
  return worst;
}

export function rowSummary(statuses, versions) {
  const xs = statuses.map((s, i) => [s, versions[i]]).filter(([s]) => s !== null);
  if (xs.length === 0) return "not checked yet";
  if (xs.every(([s]) => isOk(s))) return "checks on every release";
  if (xs.every(([s]) => !isOk(s))) return "does not check on any release";
  let i = xs.length - 1;
  const lastOk = isOk(xs[i][0]);
  while (i > 0 && isOk(xs[i - 1][0]) === lastOk) i--;
  if (lastOk) return `checks since ${xs[i][1]}`;
  let j = i - 1;
  while (j > 0 && isOk(xs[j - 1][0])) j--;
  const range = j === i - 1 ? xs[j][1] : `${xs[j][1]}–${xs[i - 1][1]}`;
  return `checks on ${range}, not since ${xs[i][1]}`;
}

export function releaseNews(latest, pkgs, releases) {
  if (releases.length < 2) return null;
  const [now, prev] = releases;
  const broke = [], fixed = [];
  for (const p of Object.values(pkgs)) {
    const a = pkgStatus(latest, p, prev.version), b = pkgStatus(latest, p, now.version);
    if (a === null || b === null) continue;
    if (isOk(a) && !isOk(b)) broke.push(p.hash);
    if (!isOk(a) && isOk(b)) fixed.push(p.hash);
  }
  return { version: now.version, prev: prev.version, broke, fixed };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test site/summary.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Summarize packages and releases for the site"
```

---

### Task 9: The page, fixtures and local server

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/app.js`, `data/fixtures/results.jsonl`, `data/fixtures/packages.json`, `data/fixtures/releases.json`, `serve.ts`

**Interfaces:**
- Consumes: `site/summary.js`; data at `data/` (or `data/<name>/` with `?data=<name>`).
- Produces: the Pages layout `_site/{index.html, style.css, app.js, summary.js, data/...}`, which `serve.ts` mirrors from the repo.

- [ ] **Step 1: Fixtures**

`data/fixtures/releases.json`:
```json
[
  { "version": "2.0.28", "published_at": "2026-09-25T17:03:30Z" },
  { "version": "2.0.27", "published_at": "2026-09-23T21:50:37Z" },
  { "version": "2.0.8", "published_at": "2026-09-18T18:51:50Z" }
]
```

`data/fixtures/packages.json`:
```json
{
  "0x0bc665d2ca2b4a7f7df0c8b32cfaa356": { "hash": "0x0bc665d2ca2b4a7f7df0c8b32cfaa356", "files": { "anthropic.bend": 1, "json.bend": 1, "LICENSE": 1 }, "name": "bend-anthropic-sdk", "version": "0.1.0.0", "desc": "An unofficial Anthropic SDK for Bend.", "ts": 1790289598443, "dependents": 0 },
  "0x1f4d6c03caf955232d0b0dc6e6f36cf4": { "hash": "0x1f4d6c03caf955232d0b0dc6e6f36cf4", "files": { "json.bend": 1 }, "name": null, "version": null, "desc": "JSON parser and serializer with formal proofs", "ts": 1758000000000, "dependents": 3 },
  "0x39cbd6b8923682f1e4deba6ee6056b43": { "hash": "0x39cbd6b8923682f1e4deba6ee6056b43", "files": { "http.c": 1, "LICENSE": 1 }, "name": null, "version": null, "desc": "C-only package", "ts": 1790276809012, "dependents": 0 }
}
```

`data/fixtures/results.jsonl`:
```
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"anthropic.bend","bend":"2.0.8","status":"unsafe","error":"","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"json.bend","bend":"2.0.8","status":"unsafe","error":"","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"anthropic.bend","bend":"2.0.27","status":"pass","error":"","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"json.bend","bend":"2.0.27","status":"pass","error":"","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"anthropic.bend","bend":"2.0.28","status":"fail","error":"Error:\n- expected : a fresh constructor name (duplicate declaration: Zero)\n- observed : '{'\nLocation:\n192 |   Minus{}\n193>|   Zero{}\n194 |   Integer{}","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x0bc665d2ca2b4a7f7df0c8b32cfaa356","file":"json.bend","bend":"2.0.28","status":"fail","error":"Error:\n- expected : a fresh constructor name (duplicate declaration: Zero)\n- observed : '{'\nLocation:\n192 |   Minus{}\n193>|   Zero{}\n194 |   Integer{}","ms":1500,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x1f4d6c03caf955232d0b0dc6e6f36cf4","file":"json.bend","bend":"2.0.8","status":"pass","error":"","ms":900,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x1f4d6c03caf955232d0b0dc6e6f36cf4","file":"json.bend","bend":"2.0.27","status":"pass","error":"","ms":900,"checked_at":"2026-09-25T18:00:00Z","runner":1}
{"pkg":"0x1f4d6c03caf955232d0b0dc6e6f36cf4","file":"json.bend","bend":"2.0.28","status":"pass","error":"","ms":900,"checked_at":"2026-09-25T18:00:00Z","runner":1}
```

- [ ] **Step 2: Local server**

`serve.ts`:
```ts
const root = import.meta.dir;
Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p.includes("..")) return new Response("no", { status: 400 });
    if (p === "/") p = "/index.html";
    const f = Bun.file(p.startsWith("/data/") ? root + p : `${root}/site${p}`);
    return (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  },
});
console.log("http://localhost:" + (process.env.PORT ?? 8080) + "/?data=fixtures");
```

- [ ] **Step 3: The page**

`site/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bend Crater</title>
<meta name="description" content="Every Bend hub package, type-checked against every bend release.">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1>Bend Crater</h1>
  <p class="lede">Every package on the <a href="https://hub.bend-lang.com">Bend hub</a>, type-checked against every <code>bend</code> release. Checking only: no package code runs.</p>
  <p id="news" class="news"></p>
</header>
<nav class="filters">
  <input id="q" type="search" placeholder="Search name, hash or description" aria-label="Search">
  <select id="status" aria-label="Status on the newest release">
    <option value="">Any status on the newest release</option>
    <option value="ok">Checks</option>
    <option value="bad">Does not check</option>
  </select>
  <label><input id="named" type="checkbox"> Named packages only</label>
</nav>
<div class="legend" id="legend"></div>
<main id="grid" aria-live="polite">Loading…</main>
<footer>Updated hourly. Statuses come from <code>bend</code> type-checking only; see the README for the method.</footer>
<script type="module" src="app.js"></script>
</body>
</html>
```

`site/style.css`:
```css
:root {
  --bg: #f6f3ee; --fg: #2d2b28; --muted: #77726a; --line: #e2ddd3; --panel: #fffdf9;
  --pass: #6f9a4f; --unsafe: #c2a23a; --fail: #c4564a; --timeout: #8b6fb5; --dep: #6a86b0; --none: #d9d4ca;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1b1a18; --fg: #e8e4dc; --muted: #9a948a; --line: #34312c; --panel: #23211e;
    --none: #3a3631;
  }
}
:root[data-theme="dark"] {
  --bg: #1b1a18; --fg: #e8e4dc; --muted: #9a948a; --line: #34312c; --panel: #23211e; --none: #3a3631;
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1100px; padding: 0 16px 48px; background: var(--bg); color: var(--fg);
  font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
code, .hash, .err { font-family: ui-monospace, Menlo, monospace; }
a { color: inherit; }
h1 { margin: 24px 0 4px; font-size: 26px; }
.lede { color: var(--muted); margin: 0 0 12px; }
.news { padding: 10px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
.filters { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 16px 0 8px; }
.filters input[type=search] { flex: 1 1 240px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--panel); color: var(--fg); }
.filters select { padding: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--fg); }
.legend { display: flex; flex-wrap: wrap; gap: 12px; color: var(--muted); font-size: 13px; margin-bottom: 8px; }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px;
  margin-right: 4px; background: var(--c); }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th.v { font-weight: 500; font-size: 12px; color: var(--muted); writing-mode: vertical-rl; transform: rotate(180deg);
  white-space: nowrap; padding: 8px 2px; }
td.pkg { min-width: 240px; }
td.pkg .name { font-weight: 600; }
td.pkg .desc, td.pkg .sum { color: var(--muted); font-size: 13px; }
td.c { padding: 6px 2px; }
td.c i { display: block; width: 14px; height: 14px; border-radius: 3px; background: var(--none); }
td.c.before i { opacity: .35; }
tr.row { cursor: pointer; }
tr.row:hover td { background: color-mix(in srgb, var(--fg) 4%, transparent); }
tr.detail td { background: var(--bg); }
.err { white-space: pre; overflow-x: auto; font-size: 12px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 6px; padding: 8px; margin: 4px 0 12px; }
.s-pass { --c: var(--pass); } .s-unsafe { --c: var(--unsafe); } .s-fail { --c: var(--fail); }
.s-timeout { --c: var(--timeout); } .s-dep_missing { --c: var(--dep); }
td.c.s-pass i, td.c.s-unsafe i, td.c.s-fail i, td.c.s-timeout i, td.c.s-dep_missing i { background: var(--c); }
footer { color: var(--muted); font-size: 13px; margin-top: 24px; }
```

`site/app.js`:
```js
import { isOk, latestCells, pkgStatus, releaseNews, rowSummary } from "./summary.js";

const LABEL = { pass: "checks", unsafe: "checks, with unsafe annotations", fail: "does not check",
  timeout: "checker timed out (60 s)", dep_missing: "a dependency is not on the hub" };

const params = new URLSearchParams(location.search);
const base = params.get("data") ? `data/${params.get("data")}/` : "data/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const title = (p) => (p.name ? `${p.name}@${p.version}` : p.hash.slice(0, 12) + "…");

async function load() {
  const get = (f) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r; });
  const [pkgs, releases, text] = await Promise.all([
    get("packages.json").then((r) => r.json()),
    get("releases.json").then((r) => r.json()),
    get("results.jsonl").then((r) => r.text()),
  ]);
  const cells = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { pkgs, releases, latest: latestCells(cells) };
}

function renderNews({ pkgs, releases, latest }) {
  const n = releaseNews(latest, pkgs, releases);
  if (!n) { $("news").textContent = ""; return; }
  const names = (hs) => hs.map((h) => esc(title(pkgs[h]))).join(", ");
  $("news").innerHTML = `<b>${esc(n.version)}</b> against ${esc(n.prev)}: ` +
    `${n.broke.length} package${n.broke.length === 1 ? "" : "s"} no longer check` +
    (n.broke.length ? ` (${names(n.broke)})` : "") +
    `, ${n.fixed.length} newly check` + (n.fixed.length ? ` (${names(n.fixed)})` : "") + ".";
}

function renderLegend() {
  $("legend").innerHTML = Object.entries(LABEL).map(([s, l]) => `<span class="s-${s}">${esc(l)}</span>`).join("") +
    `<span style="--c:var(--none)">not checked yet</span><span>faded: release is older than the package</span>`;
}

function renderGrid(d) {
  const { pkgs, releases, latest } = d;
  const q = $("q").value.trim().toLowerCase(), want = $("status").value, named = $("named").checked;
  const newest = releases[0]?.version;
  const asc = [...releases].reverse();
  const rows = Object.values(pkgs).sort((a, b) => b.dependents - a.dependents || b.ts - a.ts).filter((p) => {
    if (named && !p.name) return false;
    if (q && !`${p.name ?? ""} ${p.hash} ${p.desc}`.toLowerCase().includes(q)) return false;
    if (want) {
      const s = pkgStatus(latest, p, newest);
      if (s === null || (want === "ok") !== isOk(s)) return false;
    }
    return true;
  });
  const head = `<tr><th>Package</th>${releases.map((r) => `<th class="v">${esc(r.version)}</th>`).join("")}</tr>`;
  const body = rows.map((p) => {
    const hasBend = Object.keys(p.files).some((f) => f.endsWith(".bend"));
    const sum = hasBend ? rowSummary(asc.map((r) => pkgStatus(latest, p, r.version)), asc.map((r) => r.version))
                        : "no .bend files";
    const cells = releases.map((r) => {
      const s = pkgStatus(latest, p, r.version);
      const before = Date.parse(r.published_at) < p.ts ? " before" : "";
      return `<td class="c${s ? " s-" + s : ""}${before}" title="${esc(r.version)}: ${esc(s ? LABEL[s] : "not checked yet")}"><i></i></td>`;
    }).join("");
    return `<tr class="row" data-hash="${esc(p.hash)}"><td class="pkg"><div class="name">${esc(title(p))}</div>` +
      `<div class="desc">${esc(p.desc)}</div><div class="sum">${esc(sum)}</div></td>${cells}</tr>`;
  }).join("");
  $("grid").innerHTML = rows.length
    ? `<div class="scroll"><table>${head}${body}</table></div>`
    : "No package matches.";
  for (const tr of $("grid").querySelectorAll("tr.row")) tr.onclick = () => toggle(tr, d);
}

function toggle(tr, { pkgs, releases, latest }) {
  if (tr.nextElementSibling?.classList.contains("detail")) { tr.nextElementSibling.remove(); return; }
  const p = pkgs[tr.dataset.hash];
  const files = Object.keys(p.files).filter((f) => f.endsWith(".bend")).sort();
  const parts = files.map((f) => {
    const bad = releases.map((r) => latest.get(`${p.hash}|${f}|${r.version}`)).find((c) => c && !isOk(c.status));
    const tail = bad ? `: ${esc(LABEL[bad.status])} on ${esc(bad.bend)}` + (bad.error ? `<div class="err">${esc(bad.error)}</div>` : "")
                     : ": checks wherever it was checked";
    return `<div><code>${esc(f)}</code>${tail}</div>`;
  }).join("") || "This package has no .bend files, so there is nothing to check.";
  const row = document.createElement("tr");
  row.className = "detail";
  row.innerHTML = `<td colspan="${releases.length + 1}"><div class="hash">import ${esc(p.hash)}/…</div>${parts}</td>`;
  tr.after(row);
}

try {
  const d = await load();
  renderLegend(); renderNews(d); renderGrid(d);
  for (const id of ["q", "status", "named"]) $(id).oninput = () => renderGrid(d);
} catch (e) {
  $("grid").textContent = `Could not load the results (${e.message}).`;
}
```

- [ ] **Step 4: Check it in a browser**

Run: `bun serve.ts`, open `http://localhost:8080/?data=fixtures`.
Expected: header news "2.0.28 against 2.0.27: 1 package no longer check (bend-anthropic-sdk@0.1.0.0), 0 newly check."; three rows; the SDK row reads "checks on 2.0.8–2.0.27, not since 2.0.28" and expands to the `duplicate declaration: Zero` excerpt; the C-only row reads "no .bend files"; search and the status filter narrow rows; no console errors. Also check a 375 px wide window: no page-level horizontal scroll (the table scrolls inside its box).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Static page: the grid, release news and per-file errors"
```

---

### Task 10: Workflow and README

**Files:**
- Create: `.github/workflows/crater.yml`, `README.md`

- [ ] **Step 1: Workflow**

`.github/workflows/crater.yml`:
```yaml
name: crater
on:
  schedule: [{ cron: "17 * * * *" }]
  workflow_dispatch:
  push:
    branches: [main]
    paths: ["site/**"]
concurrency: crater

jobs:
  check:
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 55
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun test
      - uses: actions/cache@v4
        with:
          path: cache
          key: crater-${{ github.run_id }}
          restore-keys: crater-
      - run: bun runner/main.ts --budget-min 45
      - uses: actions/upload-artifact@v4
        with: { name: data, path: data, include-hidden-files: false }

  commit:
    needs: check
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with: { name: data, path: data }
      - run: |
          git config user.name "bend-crater"
          git config user.email "bend-crater@users.noreply.github.com"
          git add data
          git diff --cached --quiet || git commit -m "Results $(date -u +%Y-%m-%dT%H:%MZ)"
          git push

  deploy:
    needs: [commit]
    if: always() && (needs.commit.result == 'success' || github.event_name == 'push')
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write, contents: read }
    environment: { name: github-pages, url: "${{ steps.pages.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
        with: { ref: main }
      - run: mkdir _site && cp site/*.html site/*.css site/*.js _site/ && cp -r data _site/data
      - uses: actions/upload-pages-artifact@v3
        with: { path: _site }
      - id: pages
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: README**

`README.md`:
```markdown
# bend-crater

Every package on the [Bend hub](https://hub.bend-lang.com), type-checked
against every `bend` release from 2.0.8 on, published as one page.

A hub package is frozen by its hash, but it is checked by whatever `bend` you
have installed, and `bend` ships several releases a day. This shows, for each
package, which releases it checks on and the first error where it does not.

## What a cell means

| status | meaning |
|---|---|
| pass | `All terms check.` |
| unsafe | checks, with `@unsafe` annotations |
| fail | a parse or type error; the page shows the first lines |
| timeout | the checker ran past 60 s |
| dep_missing | an import the hub does not serve |

Only checking runs: each cell is `bend wrapper.bend` where the wrapper is
`import 0x<hash>/<file> as P`. No `main`, no effects, no foreign code.
Passing here does not mean a package works at runtime.

## Run it

    bun install
    bun test
    bun runner/main.ts --limit 20        # check 20 missing cells
    bun serve.ts                         # http://localhost:8080
    CRATER_INTEGRATION=1 bun test        # also check real releases

`data/` is the contract between the runner and the page: `results.jsonl`
(one cell per line, later lines win), `packages.json`, `releases.json`.
`data/fixtures/` is a small hand-written set; open the page with
`?data=fixtures`.

GitHub Actions runs the runner hourly, commits `data/` and deploys Pages.
A run stops starting cells after 45 minutes and the next one resumes.
```

- [ ] **Step 3: Validate and commit**

Run: `bun test` → all pass. Run: `bunx --bun js-yaml .github/workflows/crater.yml > /dev/null` → no error.

```bash
git add -A && git commit -m "Hourly workflow: check, commit data, deploy Pages"
```

---

### Task 11: First real backfill slice

- [ ] **Step 1:** Run `bun runner/main.ts --budget-min 10` locally.
Expected: several hundred cells; summary line with `dropped 0`.
- [ ] **Step 2:** `bun serve.ts`, open `http://localhost:8080/`. Confirm `bend-anthropic-sdk` shows as no longer checking on 2.0.28 once that cell is done, and spot-check two `fail` excerpts by rerunning the same wrapper by hand with the release binary.
- [ ] **Step 3:** Commit `data/`:

```bash
git add data && git commit -m "First results"
```
