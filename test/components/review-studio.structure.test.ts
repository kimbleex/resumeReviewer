import { test } from "node:test";
import assert from "node:assert/strict";

import { cssRule as findCssRule, readAppStyles, readSource } from "../helpers";

// The review studio is split across the main container, the workflow canvas, the
// lazily-loaded stage-detail panels and a shared helpers module. Assertions about
// behavior should hold across the combined source regardless of which file owns a piece.
const source = [
  "src/components/review-studio.tsx",
  "src/components/workflow-timeline.tsx",
  "src/components/review-stage-detail.tsx",
  "src/components/review-report-panels.tsx",
  "src/components/workflow-node-insight.tsx",
  "src/components/review-studio-shared.ts",
  "src/components/pdf-agent-workbench.tsx",
]
  .map(readSource)
  .join("\n");
const styles = readAppStyles();

const cssRule = (selector: string) => findCssRule(styles, selector);
const exactCssRule = (selector: string) => findCssRule(styles, selector, { exact: true });

test("review studio shows node details through an on-demand drawer instead of a permanent result pane", () => {
  assert.match(source, /result-drawer-backdrop/);
  assert.match(source, /result-drawer-panel/);
  assert.match(source, /onOpenStageDetails/);
  assert.doesNotMatch(source, /className="result-pane"/);
});

test("workflow is title-free", () => {
  assert.doesNotMatch(source, /className="pane-header"/);
  assert.doesNotMatch(source, /PIPELINE WORKFLOW/);
  assert.doesNotMatch(source, /评审链路流程/);
});

test("workflow cards use a text-first layout without left icon slots", () => {
  assert.doesNotMatch(source, /className="workflow-node-icon/);
  assert.match(source, /workflow-node-content/);
  assert.match(source, /workflow-node-kicker/);
});

test("workflow cards open details directly without a separate detail button", () => {
  assert.doesNotMatch(source, /workflow-node-detail-action/);
  assert.doesNotMatch(source, /查看 \$\{meta\.label\} 执行结果/);
  assert.match(source, /workflow-node-status-indicator/);
  assert.match(source, /onClick=\{\(\) => onOpenStageDetails\(stage\)\}/);
});

test("stage detail drawer renders the clicked stage immediately without deferred stale content", () => {
  assert.doesNotMatch(source, /useDeferredValue/);
  assert.doesNotMatch(source, /STAGE_ORDER\.map\(\(stageName\)/);
  assert.match(source, /selectedStage=\{detailsStage\}/);
  assert.match(source, /key=\{selectedStage\}/);
});

test("stage detail drawer includes the live agent console for granular progress", () => {
  assert.match(source, /function LiveConsole/);
  assert.match(source, /<LiveConsole/);
});

test("stage detail drawer separates live logs and structured report into height-filling tabs", () => {
  assert.match(source, /node-detail-tabs/);
  assert.match(source, /node-detail-tab-panel/);
  assert.match(source, />实时日志</);
  assert.match(source, />诊断报告</);

  const viewerRule = exactCssRule(".result-viewer");
  assert.match(viewerRule, /overflow:\s*hidden/);

  const panelRule = cssRule(".node-detail-tab-panel");
  assert.match(panelRule, /flex:\s*1/);
  assert.match(panelRule, /overflow-y:\s*auto/);
});

test("stage detail drawer header height adapts to viewport height instead of using a fixed bar", () => {
  const headerRule = exactCssRule(".node-result-header");
  assert.match(headerRule, /min-height:\s*clamp\([^)]*dvh[^)]*\)/);
  assert.match(headerRule, /padding:\s*clamp\([^)]*dvh[^)]*\)/);
  assert.doesNotMatch(headerRule, /min-height:\s*52px/);
});

test("agent reports use a clean summary-first layout instead of dense legacy report blocks", () => {
  assert.match(source, /clean-report-shell/);
  assert.match(source, /clean-report-hero/);
  assert.match(source, /clean-insight-grid/);
  assert.match(source, /clean-detail-section/);
  assert.match(source, /clean-summary-lead/);
  assert.match(source, /summary-metrics-inline/);
  assert.match(source, /summary-section/);
  assert.match(source, /summary-agent-strip/);

  const cleanShellRule = cssRule(".clean-report-shell");
  assert.match(cleanShellRule, /gap:\s*clamp/);
  assert.match(cleanShellRule, /background:\s*transparent/);
});

test("rewrite PDF export applies visual resume templates instead of one fixed PDF style", () => {
  assert.match(source, /detectPdfTemplate/);
  assert.match(source, /getPdfTemplateStyles/);
  assert.match(source, /pdf-template-engineering/);
  assert.match(source, /pdf-template-business/);
  assert.match(source, /pdf-template-transition/);
  assert.match(source, /pdf-template-early/);
});

test("live agent console never stores or renders raw model output text", () => {
  assert.doesNotMatch(source, /reasoning\?:\s*string/);
  assert.doesNotMatch(source, /output\?:\s*string/);
  assert.doesNotMatch(source, /stream-content/);
  assert.doesNotMatch(source, /console-stream-section/);
  assert.doesNotMatch(source, /event\.snippet/);
});

test("review form captures required target role and optional job description", () => {
  assert.match(source, /targetRole/);
  assert.match(source, /targetDescription/);
  assert.match(source, /formData\.append\("targetRole"/);
  assert.match(source, /formData\.append\("targetDescription"/);
  assert.match(source, /目标岗位/);
  assert.match(source, /岗位描述/);
});

test("review form supports local checkpoint resume and user interruption", () => {
  assert.match(source, /loadLocalReviewRun/);
  assert.match(source, /saveLocalReviewRun/);
  assert.match(source, /AbortController/);
  assert.match(source, /handleInterruptReview/);
  assert.match(source, /formData\.append\("resumeState"/);
});

test("review stream reports premature connection close instead of staying running", () => {
  assert.match(source, /receivedTerminalChunk/);
  assert.match(source, /诊断连接已提前关闭/);
});

test("agent terminal logs surface stream errors for running stages", () => {
  assert.match(source, /appendTerminalError/);
  assert.match(source, /type:\s*"error"/);
  assert.match(source, /appendTerminalError\(chunk\.message\)/);
  assert.match(source, /appendTerminalError\(errorMessage\)/);
});

test("review requests carry the user's model config instead of relying on login identity", () => {
  assert.match(source, /readRequiredLlmConfig\(\)/);
  assert.match(source, /appendLlmConfigToFormData\(formData/);
  assert.doesNotMatch(source, /\/api\/auth\//);
  assert.doesNotMatch(source, /href="\/login"/);
});

test("target job is configured through one dropdown trigger instead of inline inputs", () => {
  assert.match(source, /target-job-config/);
  assert.match(source, /target-job-trigger/);
  assert.match(source, /target-job-popover/);
  assert.match(source, /handleSaveTargetJob/);
  assert.match(source, /已配置/);
  assert.doesNotMatch(source, /target-job-fields/);
});

test("branch and merge connectors extend into grid gaps to meet adjacent cards", () => {
  // Connectors now dynamically compute fromX/toX from actual card bounding rects
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /\.right\s*-\s*rect\.left/);
  assert.match(source, /\.left\s*-\s*rect\.left/);
  // SVGs use overflow:visible to render beyond container bounds
  assert.match(source, /overflow.*visible/);
});

test("target job popover layers above the workflow canvas", () => {
  assert.match(cssRule(".compact-topbar"), /z-index:\s*40/);
  assert.match(cssRule(".compact-topbar"), /overflow:\s*visible/);
  assert.match(cssRule(".target-job-popover"), /z-index:\s*80/);
});

test("all flow arrow markers use the same compact chevron size", () => {
  assert.doesNotMatch(source, /markerWidth="7"/);
  assert.doesNotMatch(source, /markerHeight="7"/);
  assert.match(source, /markerWidth="6" markerHeight="6"/);
});

test("flow runner animation loops on matching dash cycles without visual backtracking", () => {
  assert.match(styles, /stroke-dashoffset:\s*var\(--flow-runner-cycle/);
  assert.match(styles, /\.flow-line-runner\s*\{[^}]*--flow-runner-cycle:\s*-100/s);
  assert.match(styles, /\.flow-line-idle\.flow-line-runner\s*\{[^}]*--flow-runner-cycle:\s*-106/s);
  assert.match(styles, /\.flow-line-runner-ready\s*\{[^}]*--flow-runner-cycle:\s*-98/s);
  assert.match(styles, /\.flow-line-runner-active\s*\{[^}]*--flow-runner-cycle:\s*-90/s);
  assert.match(styles, /\.flow-line-runner-done\s*\{[^}]*--flow-runner-cycle:\s*-94/s);
});

test("workflow status indicator renders as a bare dot without an outer circle", () => {
  const indicatorRule = cssRule(".workflow-node-status-indicator");
  assert.match(indicatorRule, /border:\s*none/);
  assert.match(indicatorRule, /background:\s*transparent/);
  assert.doesNotMatch(indicatorRule, /border-radius:\s*999px/);
  assert.doesNotMatch(indicatorRule, /width:\s*30px/);
  assert.doesNotMatch(indicatorRule, /height:\s*30px/);

  for (const selector of [
    ".workflow-node-status-indicator-running",
    ".workflow-node-status-indicator-done",
  ]) {
    const rule = cssRule(selector);
    assert.doesNotMatch(rule, /border-color:/);
    assert.doesNotMatch(rule, /background:/);
  }
});

test("workflow card status text fills the card width before wrapping", () => {
  const cardRule = cssRule(".workflow-node-card");
  assert.doesNotMatch(cardRule, /clamp\(52px,\s*3vw,\s*62px\)/);

  const titleRule = exactCssRule(".workflow-node-content strong");
  assert.match(titleRule, /padding-right:\s*32px/);

  const statusRule = exactCssRule(".workflow-node-status-text");
  assert.match(statusRule, /display:\s*block/);
  assert.match(statusRule, /width:\s*100%/);
  assert.match(statusRule, /padding-right:\s*0/);
  assert.match(statusRule, /white-space:\s*normal/);
  assert.doesNotMatch(statusRule, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(statusRule, /-webkit-line-clamp/);

  const reviewerStatusRule = cssRule(".workflow-reviewer-row .workflow-node-status-text");
  assert.match(reviewerStatusRule, /display:\s*block/);
  assert.match(reviewerStatusRule, /width:\s*100%/);
  assert.match(reviewerStatusRule, /white-space:\s*normal/);
  assert.doesNotMatch(reviewerStatusRule, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(reviewerStatusRule, /-webkit-line-clamp/);
});

test("workflow cards surface quantified results and the scoring rubric", () => {
  assert.match(source, /<WorkflowNodeInsight stage=\{stage\} payload=\{payload\} \/>/);
  assert.match(source, /workflow-node-rubric-bar/);
  assert.match(source, /workflow-node-dims/);
  assert.match(source, /workflow-node-score/);
  assert.match(source, /workflow-node-stats/);
  // 卡片按权重分段：段宽取自 rubric 权重
  assert.match(source, /flexGrow: dimension\.weight/);
  // 专家卡片在足够宽时切换为双栏维度明细
  assert.match(styles, /@container \(min-width: \d+px\)/);
});

test("workflow timeline re-renders cards when a stage payload changes", () => {
  assert.match(source, /previous\.stagePayloads\[stage\] === next\.stagePayloads\[stage\]/);
});

test("stage reports show weighted rubric scores and quantified suggestions", () => {
  assert.match(source, /function RubricScoreTable/);
  assert.match(source, /applyRubricWeights/);
  assert.match(source, />加权贡献</);
  assert.match(source, /加权合计/);
  assert.match(source, /revision-gain-pill/);
  assert.match(source, /expectedGain/);
  assert.match(source, /SUMMARY_REVIEWER_WEIGHTS/);
  assert.match(source, /<RubricReference rubric=\{rubric\} \/>/);
});

test("input flows resume -> target job -> loader inside a dashed input frame", () => {
  assert.match(source, /workflow-input-frame/);
  assert.match(source, /WorkflowInputConnector/);
  assert.match(source, /'\.workflow-resume-card', '\.workflow-target-card', '\.workflow-node-resume_loader'/);
  assert.match(source, /fromSelector="\.workflow-node-summary_agent"/);
});

test("start validates the target job inline before checking the model config", () => {
  assert.match(source, /setInputError\("target"\)/);
  assert.match(source, /target-job-field-error/);
  assert.match(source, /必须填写目标岗位/);
  const submit = source.slice(source.indexOf("async function handleSubmit"));
  assert.ok(submit.indexOf('setInputError("target")') < submit.indexOf("readRequiredLlmConfig()"));
});

test("input is split into resume and target job cards aligned to the canvas columns", () => {
  assert.match(source, /setup-tile-value/);
  assert.match(source, /setup-tile-hint/);
  assert.doesNotMatch(source, /workflow-setup-footer/);
});

test("workflow cards rely on the status indicator instead of status text chips", () => {
  assert.doesNotMatch(source, /workflow-node-status-chip/);
  assert.match(source, /<span className="workflow-node-kicker">STEP 0\{index \+ 1\}<\/span>/);
});

test("loader, parser and rewrite cards preview their scope before running", () => {
  assert.match(source, /SUPPORTED_FORMATS/);
  assert.match(source, /PARSER_FIELDS/);
  assert.match(source, /REWRITE_TEMPLATES/);
  assert.match(source, /workflow-node-chips/);
});
