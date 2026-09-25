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
  const bin = await fakeBend(
    '[ "$1" = "$HOME/wrapper.bend" ] && [ "$BEND_LIB" = /tmp/lib ] && ' +
    'grep -qx "import 0xab/src/b.bend as P" "$1" && echo "All terms check."');
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
