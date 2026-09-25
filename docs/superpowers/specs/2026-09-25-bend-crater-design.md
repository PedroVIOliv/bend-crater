# bend-crater: design

## Purpose

Bend ships several releases a day, and releases often change language rules.
A hub package is frozen by its hash but checked by whatever `bend` the user
has installed, so packages break silently. bend-crater type-checks every hub
package against every `bend` release and publishes the results, so a package
user can see at a glance whether a package works on their version, since when
it is broken, and with what error.

Primary audience for v1: package users. Authors and the core team read the
same page; notifications and pre-release testing are later work.

Success: after each `bend` release, within about an hour, the site shows every
package's status on it, and a regression reads as "works on 2.0.8–2.0.25,
fails since 2.0.26" with the first error lines.

## Scope

In v1:

- Every hub package, every `.bend` file in it, every release from 2.0.8 on.
- Type-check only (`bend wrapper.bend` on a file with no `main`). No package
  code runs: no `main`, no effects, no foreign `.c`/`.js`.
- A static site on GitHub Pages; runner on a GitHub Actions cron.

Not in v1: running a package's `#|` tests, notifying authors, testing
unreleased `bend` commits, an API beyond the committed JSON.

## Facts the design rests on (verified 2026-09-25)

- `GET https://hub.bend-lang.com/packages.json?sort=new&limit=N&after=K`
  returns `{total, packages:[{hash, files:{path: bytes}, name, version, desc,
  ts, dependents, license, ...}]}`. 178 packages today.
- Every release since v2.0.8 on `bendlang/bend` has
  `bend-<ver>-{linux,darwin}-{x64,arm64}.tar.gz`, unpacking to
  `bend/bin/bend`, a standalone executable.
- 2.0.8 lacks `--check-only` and `version`; `bend file.bend` on a file with no
  `main` only checks, in every release.
- Every release honours `BEND_LIB` (the hub download cache) and `BEND_HUB`.
- Releases print `bend X is available: run bend update` and write
  `$HOME/.bend/check.json`.
- Unsafe annotations exit 0 with `All terms check, with N unsafe
  annotation(s).`
- Real regression: `bend-anthropic-sdk` (`0x0bc665d2…/json.bend`) checks on
  2.0.8 (1 unsafe) and fails on 2.0.27 with `duplicate declaration: Zero`.

## Layout

```
runner/        TypeScript on Bun; produces data/
  hub.ts       page through /packages.json
  releases.ts  list GitHub releases >= 2.0.8; download and unpack the
               tarball for the current platform into cache/bend/<ver>/
  check.ts     one cell -> result (spawn, timeout, classify)
  classify.ts  bend output + exit code -> status and error excerpt
  plan.ts      missing cells, ordered
  main.ts      load -> plan -> run with a pool and a time budget -> write
data/          committed; the only interface between runner and site
  results.jsonl
  packages.json
  releases.json
site/          static; reads data/, never writes it
  index.html  app.js  style.css
.github/workflows/crater.yml
```

## Data

`results.jsonl`, one line per cell, append-only:

```json
{"pkg":"0x0bc6...","file":"json.bend","bend":"2.0.27","status":"fail",
 "error":"- expected : a fresh constructor name ...","ms":1540,
 "checked_at":"2026-09-25T10:00:00Z","runner":1}
```

- `status`: `pass`, `unsafe`, `fail`, `timeout`, `dep_missing`.
- `error`: the `Error:` block through `Location:` and its lines, at most 15
  lines, the update notice removed. Empty for `pass`/`unsafe`.
- `runner`: classifier version. Bumping it marks older cells for re-check.
- The latest line for a (pkg, file, bend) key wins.
- Package status on a release = the worst of its files, in the order
  `pass < unsafe < timeout < dep_missing < fail`.

`packages.json`: the hub metadata snapshot, keyed by hash. `releases.json`:
`[{version, published_at}]`, newest first.

## Runner

1. Load packages (all pages) and releases. Download missing tarballs into
   `cache/bend/<ver>/` (kept between runs by `actions/cache`).
2. Plan: every (pkg, `.bend` file, release) with no result at the current
   `runner` version, plus `dep_missing` cells older than 24 h. Order: newest
   release first, then newest package first.
3. Check a cell: write `import <hash>/<file> as P` to a temp `wrapper.bend`;
   run `cache/bend/<ver>/bend/bin/bend wrapper.bend` with a fresh temp `HOME`,
   shared `BEND_LIB=cache/lib`, a 60 s timeout, 4 cells in parallel.
4. Classify:
   - killed at the timeout -> `timeout`
   - exit 0 and `with N unsafe annotation` -> `unsafe`
   - exit 0 and `All terms check.` -> `pass`
   - output shows a failed hub fetch or an unknown package name ->
     `dep_missing`
   - anything else -> `fail`
5. Append results; rewrite `packages.json` and `releases.json`.

Errors:

- Time budget: stop starting cells after 45 min; the next run resumes. This
  is how the one-time backfill (178 packages x 21 releases x their files) fits in Actions.
- Hub or GitHub unreachable at load time: exit non-zero, write nothing. A
  network failure of ours is never recorded as a package `fail`.
- Workflow `concurrency: crater` so runs never overlap.

Security: in check-only mode the checker evaluates types but runs no package
code; a hostile package can at most burn the 60 s. The check job has no
secrets and read-only permissions; a separate job commits `data/` and
deploys Pages.

## Site

One page, plain HTML/JS, no build step, no framework.

- Header: the newest release and its news: "2.0.28: N packages newly fail,
  M newly pass" against the previous release.
- Table: one row per package (name@version or short hash, description,
  dependents), one column per release, newest left. Cell colour by status;
  releases published before the package are greyed.
- Row summary: "works on 2.0.8–2.0.25, fails since 2.0.26".
- Click a row: per-file results and the error excerpt for each failing cell.
- Filters: status on the newest release, text search, named-only.
- Wording stays neutral ("does not check on 2.0.27"): a break may be the
  compiler's fault, not the author's.

## Testing

- `classify.ts`: unit tests on captured real outputs (pass, unsafe, fail with
  the update notice, dep_missing, timeout).
- `plan.ts`: pure; tests for missing cells, the `runner` bump, the
  `dep_missing` retry, ordering.
- `hub.ts`: tests against a recorded `/packages.json` page, including paging.
- Integration (opt-in, network): real 2.0.8 and 2.0.27 on
  `0x1f4d6c03…/json.bend` (pass on both) and `0x0bc665d2…/json.bend`
  (unsafe on 2.0.8, fail on 2.0.27).
- Site: `data/fixtures/` with a hand-written small data set; the site loads
  it via `?data=fixtures`.

## Two-person split

The `data/` format is the contract. One person owns `runner/` and the
workflow; the other owns `site/` against `data/fixtures/`.
