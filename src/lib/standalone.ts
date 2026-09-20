import { realpathSync } from "node:fs";
import { dirname } from "node:path";

/** Compiled Bun binaries expose their bundled module tree through the `$bunfs` marker. */
export function isStandaloneBinary(): boolean {
  return import.meta.url.includes("/$bunfs/");
}

/** Directory containing the compiled executable and its copied runtime assets. */
export function standaloneRoot(): string {
  return dirname(realpathSync(process.execPath));
}
