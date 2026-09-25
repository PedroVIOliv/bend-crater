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
