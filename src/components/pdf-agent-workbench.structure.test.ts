import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workbenchSource = readFileSync(new URL("./pdf-agent-workbench.tsx", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("./review-studio.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

test("review studio exposes PC workspace navigation for workflow and PDF agent editing", () => {
  assert.match(studioSource, /activeWorkspace/);
  assert.match(studioSource, />工作流诊断</);
  assert.match(studioSource, />Agent 改简历</);
  assert.match(studioSource, /<PdfAgentWorkbench/);
  assert.match(styles, /\.workspace-nav/);
});

test("identity menu lives in the top navigation and keeps admin panel conditional", () => {
  assert.match(studioSource, /topbar-identity-menu/);
  assert.match(studioSource, /identity\.user\.role === "ADMIN"/);
  assert.match(studioSource, /href="\/admin"/);
  assert.doesNotMatch(studioSource, /floating-identity-container/);
});

test("top navigation keeps the brand compact instead of wrapping into a tall column", () => {
  const brandRule = cssRule(".topbar-brand");
  assert.match(brandRule, /flex:\s*0\s+0\s+auto/);

  const titleRule = cssRule(".topbar-brand h1");
  assert.match(titleRule, /white-space:\s*nowrap/);
  assert.doesNotMatch(titleRule, /text-overflow:\s*ellipsis/);

  const actionsRule = cssRule(".topbar-actions");
  assert.match(actionsRule, /min-width:\s*0/);
  assert.doesNotMatch(studioSource, /identity-badge identity-badge/);
});

test("workflow upload target and start controls live inside the canvas as a collapsible panel", () => {
  assert.match(studioSource, /isWorkflowControlsCollapsed/);
  assert.match(studioSource, /workflow-canvas-controls/);
  assert.match(studioSource, /workflow-setup-panel/);
  assert.match(studioSource, /workflow-start-panel/);
  assert.match(studioSource, /workflow-setup-form/);
  assert.match(studioSource, /workflow-start-action/);
  assert.doesNotMatch(studioSource, /workflow-command-dock/);
  assert.match(cssRule(".workflow-canvas-controls"), /position:\s*absolute/);
  assert.match(cssRule(".workflow-canvas-controls"), /width:\s*min\(clamp\(300px,\s*32vw,\s*440px\),\s*calc\(100%\s*-\s*32px\)\)/);
  assert.match(cssRule(".workflow-setup-form"), /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(cssRule(".workflow-setup-form"), /max-content/);
});

test("PDF agent workbench uses native object URL PDF preview with refresh and download controls", () => {
  assert.match(workbenchSource, /URL\.createObjectURL/);
  assert.match(workbenchSource, /URL\.revokeObjectURL/);
  assert.match(workbenchSource, /<iframe/);
  assert.match(workbenchSource, /pdfFrameKey/);
  assert.match(workbenchSource, />刷新预览</);
  assert.match(workbenchSource, />下载 PDF</);
  assert.doesNotMatch(workbenchSource, /pdfjs|pdf\.js/i);
});

test("PDF agent stages show running animation and collapsible concise tool results", () => {
  assert.match(workbenchSource, /PDF_AGENT_STAGES/);
  assert.match(workbenchSource, /agent-stage-spinner/);
  assert.match(workbenchSource, /<details className="agent-tool-call"/);
  assert.match(workbenchSource, /summary/);
  assert.match(workbenchSource, /精简结果/);
  assert.doesNotMatch(workbenchSource, /rawModelOutput|streamContent|reasoningText/);
});

test("PDF agent workbench has a fixed PC split layout", () => {
  assert.match(cssRule(".pdf-agent-workbench"), /grid-template-columns:\s*minmax\(0,\s*1\.9fr\)\s+minmax\(360px,\s*0\.9fr\)/);
  assert.match(cssRule(".pdf-preview-frame"), /width:\s*100%/);
  assert.match(cssRule(".pdf-agent-panel"), /overflow:\s*hidden/);
});
