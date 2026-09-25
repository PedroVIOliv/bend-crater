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
  return { status: DEP.test(text) ? "dep_missing" : "fail", error: excerpt(lines) };
}
