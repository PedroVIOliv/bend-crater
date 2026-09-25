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
