import { readFileSync } from "node:fs";

export function readAppStyles(importMetaUrl: string) {
  const globalsUrl = new URL("../app/globals.css", importMetaUrl);
  const globalsSource = readFileSync(globalsUrl, "utf8");
  const importedSources = Array.from(
    globalsSource.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?;/g),
  ).map((match) => readFileSync(new URL(match[1], globalsUrl), "utf8"));

  return [globalsSource, ...importedSources].join("\n");
}
