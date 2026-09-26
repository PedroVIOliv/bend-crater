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

test("connection words inside quoted package source are still a fail", () => {
  const out = "Error:\n- expected : Bool\n- detected : U32\nLocation:\n12>|   case ECONNREFUSED: \"fetch failed\"\n";
  expect(classify(out, 1, false)!.status).toBe("fail");
});

test("from 2.0.28 unsafe reads as defs relying on unsafe or foreign code", async () => {
  expect(classify(await fx("unsafe_foreign"), 0, false)).toEqual({ status: "unsafe", error: "" });
});
