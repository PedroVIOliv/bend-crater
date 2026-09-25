import { expect, test } from "bun:test";
import { cmpVersion } from "./versions";

test("numeric, not lexical", () => {
  expect(["2.0.10", "2.0.8", "2.0.28", "2.1.0"].sort(cmpVersion))
    .toEqual(["2.0.8", "2.0.10", "2.0.28", "2.1.0"]);
});
