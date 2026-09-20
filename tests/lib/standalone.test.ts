import { expect, test } from "bun:test";
import { dirname } from "node:path";
import { realpathSync } from "node:fs";
import { isStandaloneBinary, standaloneRoot } from "../../src/lib/standalone";

test("source Bun processes are not identified as compiled binaries", () => {
  expect(isStandaloneBinary()).toBe(false);
});

test("standaloneRoot follows the running executable", () => {
  expect(standaloneRoot()).toBe(dirname(realpathSync(process.execPath)));
});
