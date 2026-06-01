import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./review-studio.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  assert.ok(match, `Expected CSS rule for ${selector}`);
  return match[1];
}

test("review studio shows node details through an on-demand drawer instead of a permanent result pane", () => {
  assert.match(source, /result-drawer-backdrop/);
  assert.match(source, /result-drawer-panel/);
  assert.match(source, /onOpenStageDetails/);
  assert.doesNotMatch(source, /className="result-pane"/);
});

test("workflow is title-free and reserves a future agent slot after summary", () => {
  assert.doesNotMatch(source, /className="pane-header"/);
  assert.doesNotMatch(source, /PIPELINE WORKFLOW/);
  assert.doesNotMatch(source, /评审链路流程/);
  assert.match(source, /FutureAgentSkeleton/);
  assert.match(source, /future-agent-card/);
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

test("review form captures required target role and optional job description", () => {
  assert.match(source, /targetRole/);
  assert.match(source, /targetDescription/);
  assert.match(source, /formData\.append\("targetRole"/);
  assert.match(source, /formData\.append\("targetDescription"/);
  assert.match(source, /目标岗位/);
  assert.match(source, /岗位描述/);
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
  assert.match(source, /const leftPath = "M -14 160/);
  assert.match(source, /const midPath = "M -14 160 H 134"/);
  assert.match(source, /H 134"/);
  assert.doesNotMatch(source, /const midPath = "M 10 160 H 110"/);
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
    ".workflow-node-status-indicator-future",
  ]) {
    const rule = cssRule(selector);
    assert.doesNotMatch(rule, /border-color:/);
    assert.doesNotMatch(rule, /background:/);
  }
});
