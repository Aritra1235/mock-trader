import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readDocsFile(docsDir: string, fileName: string) {
  return readFile(join(docsDir, fileName), "utf-8");
}
