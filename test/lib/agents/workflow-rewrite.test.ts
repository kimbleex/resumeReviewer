import { test } from "node:test";
import assert from "node:assert/strict";

import { readSource } from "../../helpers";

const source = readSource("src/lib/agents/workflow/rewrite.ts");
const promptSource = readSource("src/lib/agents/workflow/prompts.ts");

test("rewrite agent streams plain text instead of generating a large structured JSON object", () => {
  assert.match(source, /invokeTextAgent/);
  assert.doesNotMatch(source, /invokeStructuredAgent/);
  assert.doesNotMatch(source, /resumeRewriteResponseFormatSchema/);
});

test("rewrite agent asks the model for parseable text sections", () => {
  assert.match(source, /\[REWRITTEN_CONTENT\]/);
  assert.match(source, /\[EXPLANATION\]/);
});

test("rewrite prompt selects from ATS-friendly resume templates before writing", () => {
  assert.match(promptSource, /简历模板库/);
  assert.match(promptSource, /自动选择最适合的一套模板/);
  assert.match(promptSource, /工程技术深度模板/);
  assert.match(promptSource, /业务增长结果模板/);
  assert.match(promptSource, /职业转型桥接模板/);
  assert.match(promptSource, /不要使用双栏/);
});
