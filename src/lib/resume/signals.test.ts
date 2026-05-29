import assert from "node:assert/strict";
import test from "node:test";

import { extractResumeSignals } from "./signals";

test("extractResumeSignals extracts contact information and links", () => {
  const resumeText = `
Ada Lovelace
年龄: 28
手机: +86 13800000000
Email: ada@example.com
Location: Shanghai
GitHub: https://github.com/ada
LinkedIn: https://www.linkedin.com/in/ada
`;

  const hints = extractResumeSignals(resumeText);

  assert.equal(hints.personalInfo.name, "Ada Lovelace");
  assert.equal(hints.personalInfo.age, "28");
  assert.equal(hints.personalInfo.phone, "+86 13800000000");
  assert.equal(hints.personalInfo.email, "ada@example.com");
  assert.equal(hints.personalInfo.location, "Shanghai");
  assert.ok(hints.personalInfo.links.includes("https://github.com/ada"));
  assert.ok(hints.personalInfo.links.includes("https://www.linkedin.com/in/ada"));
});
