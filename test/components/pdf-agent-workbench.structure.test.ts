import { test } from "node:test";
import assert from "node:assert/strict";

import { cssRule as findCssRule, readAppStyles, readSource } from "../helpers";

const workbenchSource = readSource("src/components/pdf-agent-workbench.tsx");
const studioSource = readSource("src/components/review-studio.tsx") + readSource("src/components/workflow-timeline.tsx");
const pdfAgentSource = readSource("src/lib/agents/resume-chat.ts");
const styles = readAppStyles();

const cssRule = (selector: string) => findCssRule(styles, selector);

test("review studio exposes PC workspace navigation for workflow and PDF agent editing", () => {
  assert.match(studioSource, /activeWorkspace/);
  assert.match(studioSource, />Workflow</);
  assert.match(studioSource, />Agent Chat</);
  assert.match(studioSource, /<PdfAgentWorkbench/);
  assert.match(styles, /\.workspace-nav/);
});

test("model config menu lives in the top navigation without login or admin entry points", () => {
  assert.match(studioSource, /<LlmConfigMenu \/>/);
  assert.doesNotMatch(studioSource, /topbar-identity-menu/);
  assert.doesNotMatch(studioSource, /href="\/admin"/);
  assert.doesNotMatch(studioSource, /floating-identity-container/);
});

test("top navigation keeps the brand compact instead of wrapping into a tall column", () => {
  const brandRule = cssRule(".topbar-brand");
  assert.match(brandRule, /flex:\s*0\s+0\s+auto/);

  const titleRule = cssRule(".topbar-brand h1");
  assert.match(titleRule, /white-space:\s*nowrap/);
  assert.doesNotMatch(titleRule, /text-overflow:\s*ellipsis/);

  assert.doesNotMatch(studioSource, /identity-badge identity-badge/);
});

test("workflow upload target and start controls live inside the canvas as a compact setup node", () => {
  assert.doesNotMatch(studioSource, /isWorkflowControlsCollapsed/);
  assert.match(studioSource, /workflow-canvas-controls/);
  assert.match(studioSource, /workflow-setup-panel/);
  assert.match(studioSource, /workflow-resume-card/);
  assert.match(studioSource, /workflow-target-card/);
  assert.match(studioSource, />Resume</);
  assert.match(studioSource, />Target Job</);
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
  assert.match(cssRule(".workflow-setup-container"), /grid-template-columns:\s*subgrid/);
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

test("PDF agent progress only shows question extraction, tool calls, and final summary", () => {
  assert.match(workbenchSource, /模型提取用户问题/);
  assert.match(workbenchSource, /正在解析 PDF/);
  assert.match(workbenchSource, /已运行/);
  assert.match(pdfAgentSource, /模型提取用户问题/);
  assert.match(pdfAgentSource, /readResumePdf/);
  assert.match(pdfAgentSource, /调用 .* 工具/);
  assert.match(pdfAgentSource, /模型汇总最终输出/);
  assert.doesNotMatch(pdfAgentSource, /tools:\s*\{/);
  assert.doesNotMatch(pdfAgentSource, /stepCountIs|createReadResumePdfTool/);
  assert.doesNotMatch(workbenchSource + pdfAgentSource, /模型思考是否需要调用工具|模型分析工具结果|model request/);
});

test("PDF agent keeps parsed resume memory until another PDF is uploaded", () => {
  const routeSource = readSource("src/app/api/pdf-agent/route.ts");
  assert.match(workbenchSource, /parsedResumeCache/);
  assert.match(workbenchSource, /setParsedResumeCache\(null\)/);
  assert.match(workbenchSource, /resume-cache/);
  assert.match(workbenchSource, /formData\.append\("parsedResumeContent"/);
  assert.match(routeSource, /parsedResumeContent/);
  assert.match(routeSource, /parsedResume:\s*parsedResume/);
  assert.match(pdfAgentSource, /parsedResume\?:/);
  assert.match(pdfAgentSource, /复用 read_resume_pdf 解析结果/);
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
