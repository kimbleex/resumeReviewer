import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT_URL = new URL("../", import.meta.url);

/** 读取仓库内的源码文件，路径相对仓库根目录，例如 "src/lib/agents/base.ts"。 */
export function readSource(path: string): string {
  return readFileSync(new URL(path, ROOT_URL), "utf8");
}

/** 读取 globals.css 及其 @import 的全部样式，拼接为一个字符串。 */
export function readAppStyles(): string {
  const globalsUrl = new URL("src/app/globals.css", ROOT_URL);
  const globalsSource = readFileSync(globalsUrl, "utf8");
  const importedSources = Array.from(
    globalsSource.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?;/g),
  ).map((match) => readFileSync(new URL(match[1], globalsUrl), "utf8"));

  return [globalsSource, ...importedSources].join("\n");
}

/** 返回第一个匹配 selector 的 CSS 规则体；exact 为 true 时要求 selector 位于行首。 */
export function cssRule(styles: string, selector: string, options: { exact?: boolean } = {}): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = options.exact ? "(?:^|\\n)" : "";
  const match = styles.match(new RegExp(`${prefix}${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}
