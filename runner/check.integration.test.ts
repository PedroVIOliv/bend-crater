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
  expect(await run(json, "json.bend", "2.0.27")).toBe("pass");
  expect(await run(json, "json.bend", "2.0.28")).toBe("fail");
  expect(await run(sdk, "json.bend", "2.0.8")).toBe("unsafe");
  expect(await run(sdk, "json.bend", "2.0.27")).toBe("pass");
  expect(await run(sdk, "json.bend", "2.0.28")).toBe("fail");
}, 300_000);
