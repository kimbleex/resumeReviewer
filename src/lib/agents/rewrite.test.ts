import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./rewrite.ts", import.meta.url), "utf8");

test("rewrite agent streams plain text instead of generating a large structured JSON object", () => {
  assert.match(source, /invokeTextAgent/);
  assert.doesNotMatch(source, /invokeStructuredAgent/);
  assert.doesNotMatch(source, /resumeRewriteResponseFormatSchema/);
});

test("rewrite agent asks the model for parseable text sections", () => {
  assert.match(source, /\[REWRITTEN_CONTENT\]/);
  assert.match(source, /\[EXPLANATION\]/);
});
