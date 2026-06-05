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
  assert.match(studioSource, />Workflow</);
  assert.match(studioSource, />Agent Chat</);
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

test("workflow upload target and start controls live inside the canvas as a compact setup node", () => {
  assert.doesNotMatch(studioSource, /isWorkflowControlsCollapsed/);
  assert.match(studioSource, /workflow-canvas-controls/);
  assert.match(studioSource, /workflow-setup-panel/);
  assert.match(studioSource, /STEP 01/);
  assert.match(studioSource, />Input</);
  assert.match(studioSource, /workflow-entry-column/);
  assert.match(studioSource, /workflow-output-column/);
  assert.match(studioSource, /WorkflowVerticalArrow/);
  assert.match(studioSource, /workflow-start-panel/);
  assert.match(studioSource, /workflow-setup-form/);
  assert.match(studioSource, /workflow-start-action/);
  assert.doesNotMatch(studioSource, /workflow-command-dock/);
  assert.match(cssRule(".workflow-canvas-controls"), /position:\s*relative/);
  assert.match(cssRule(".workflow-canvas-controls"), /width:\s*100%/);
  assert.match(cssRule(".workflow-flowchart"), /grid-template-columns:\s*minmax\(230px,\s*0\.92fr\)/);
  assert.match(cssRule(".workflow-setup-container"), /grid-column:\s*1\s*\/\s*span\s*3/);
  assert.match(cssRule(".workflow-setup-form"), /grid-template-columns:\s*1fr\s+1fr/);
  assert.doesNotMatch(cssRule(".workflow-setup-form"), /max-content/);
  assert.match(cssRule(".workflow-setup-form .target-job-popover"), /width:\s*min\(360px,\s*calc\(100vw\s*-\s*48px\)\)/);
  assert.match(cssRule(".workflow-setup-form .target-job-popover"), /right:\s*auto/);
  assert.match(cssRule(".workflow-setup-form .target-job-popover"), /z-index:\s*320/);
  assert.doesNotMatch(cssRule(".workflow-pane"), /contain:\s*layout\s+paint\s+style/);
  assert.match(cssRule(".workflow-canvas-controls"), /z-index:\s*6/);
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

test("PDF agent drives dynamic trace steps from the real streaming endpoint", () => {
  // 不再使用写死的步骤，改为消费后端真实流式事件。
  assert.doesNotMatch(workbenchSource, /PDF_AGENT_STAGES/);
  assert.doesNotMatch(workbenchSource, /agent-tool-call|精简结果/);
  assert.match(workbenchSource, /\/api\/pdf-agent/);
  assert.match(workbenchSource, /getReader\(\)/);
  assert.match(workbenchSource, /answer-delta/);
  assert.match(workbenchSource, /agent-trace-step/);
  assert.match(workbenchSource, /agent-stage-spinner/);
  assert.doesNotMatch(workbenchSource, /rawModelOutput|streamContent|reasoningText/);
  assert.match(cssRule(".agent-trace-tag.tag-model"), /color:\s*#c4b5fd/);
});

test("PDF agent workbench has a fixed PC split layout", () => {
  assert.match(cssRule(".pdf-agent-workbench"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.match(cssRule(".pdf-agent-workbench"), /align-items:\s*stretch/);
  assert.match(cssRule(".pdf-preview-frame"), /width:\s*100%/);
  assert.match(cssRule(".pdf-agent-panel"), /overflow:\s*hidden/);
});

test("PDF agent page presents a chat-style agent workspace", () => {
  assert.match(workbenchSource, /agent-conversation-scroll/);
  assert.match(workbenchSource, /agent-chat-message-user/);
  assert.match(workbenchSource, /agent-prompt-shell/);
  assert.match(workbenchSource, /promptTextareaRef/);
  assert.match(workbenchSource, /resizePromptTextarea/);
  assert.match(workbenchSource, /style\.height\s*=\s*"auto"/);
  assert.match(workbenchSource, /AgentTurnView/);
  assert.match(workbenchSource, /清空/);
  assert.doesNotMatch(workbenchSource, /Maximize2|agent-expand-button|展开输入框/);
  assert.match(cssRule(".pdf-agent-panel"), /var\(--bg-elevated\)/);
  assert.doesNotMatch(cssRule(".pdf-agent-panel"), /#f8fafc|#ffffff|#fff\b/);
  assert.match(cssRule(".agent-conversation-scroll"), /overflow-y:\s*auto/);
  assert.match(cssRule(".agent-conversation-scroll"), /background:\s*#050609/);
  assert.match(cssRule(".agent-chat-message-user"), /align-self:\s*flex-end/);
  assert.doesNotMatch(cssRule(".agent-prompt-form"), /(?:^|\n)\s*height:\s*52px/);
  assert.match(cssRule(".agent-prompt-form"), /min-height:\s*52px/);
  assert.match(cssRule(".pdf-preview-header"), /height:\s*58px/);
  assert.match(cssRule(".pdf-preview-header"), /min-height:\s*58px/);
  assert.match(styles, /\.pdf-preview-toolbar\s*\{[^}]*height:\s*52px[^}]*min-height:\s*52px/s);
  assert.match(cssRule(".pdf-agent-header"), /height:\s*58px/);
  assert.match(cssRule(".pdf-agent-header"), /min-height:\s*58px/);
  assert.match(cssRule(".agent-prompt-shell"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+78px/);
  assert.match(cssRule(".agent-prompt-shell"), /align-items:\s*end/);
  assert.match(cssRule(".agent-prompt-form textarea"), /max-height:\s*82px/);
  assert.match(cssRule(".agent-prompt-form textarea"), /overflow:\s*hidden/);
  assert.match(cssRule(".agent-send-button"), /min-height:\s*30px/);
  assert.doesNotMatch(workbenchSource, /上传 PDF 后，可以直接告诉/);
  assert.doesNotMatch(workbenchSource, /例如：/);
  assert.doesNotMatch(workbenchSource, /\{agentStages\.map/);
});
