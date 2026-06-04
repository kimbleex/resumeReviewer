# Summary 诊断报告极简化重设计 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FinalReviewPanel 从卡片边框驱动风格转为简洁专业的极简风格

**Architecture:** 仅修改 FinalReviewPanel 组件的 JSX 结构 + 新增少量 CSS class。不改数据流、不碰其他 Panel 组件、不调整响应式断点逻辑。

**Tech Stack:** Next.js + TypeScript + Lucide React icons + custom CSS (dark theme)

---

### Task 1: 更新 FinalReviewPanel 组件 JSX

**Files:**
- Modify: `src/components/review-stage-detail.tsx:714-796`

- [ ] **Step 1: 替换 FinalReviewPanel 函数体**

将 `FinalReviewPanel` 函数体（lines 715-796）替换为以下代码：

```tsx
function FinalReviewPanel({ result }: { result: ReviewRunResult }) {
  const finalReview = result.finalReview;
  const fileName = result.document.path?.split(/[\\/]/).pop() || "未命名简历";
  const summaryText =
    finalReview.executiveSummary ||
    `当前简历综合评分 ${finalReview.overallScore} 分，状态为${formatReadyLevel(finalReview.readyLevel)}。`;
  const readyLevel = formatReadyLevel(finalReview.readyLevel);
  const readyColor =
    finalReview.readyLevel === "strong"
      ? "var(--green)"
      : finalReview.readyLevel === "promising"
        ? "var(--cyan)"
        : "var(--gold)";

  return (
    <section className="clean-report-shell" style={{ gap: "clamp(16px, 2.2dvh, 24px)" }}>
      {/* Header: title left, score right */}
      <header className="summary-header">
        <div className="summary-header-left">
          <span className="clean-kicker">终审结论</span>
          <h3>智能协同终审诊断书</h3>
        </div>
        <div className="summary-header-score">
          <strong>
            {finalReview.overallScore}
            <small> 分</small>
          </strong>
          <span style={{ color: readyColor }}>· {readyLevel}</span>
        </div>
      </header>

      {/* Executive summary — single paragraph, no split */}
      <p className="clean-summary-lead">{summaryText}</p>

      {/* Inline metrics — plain text with separators */}
      <p className="summary-metrics-inline">
        {finalReview.topPriorities.length} 项优先事项
        <span className="summary-metrics-sep">·</span>
        {result.reviewerFeedback.length} 位专家诊断
        <span className="summary-metrics-sep">·</span>
        {fileName}
      </p>

      {/* Priority actions */}
      <div className="summary-section">
        <h4 className="summary-section-title">优先行动</h4>
        <p className="summary-section-desc">建议先完成这些修改，再进入逐段润色。</p>
        <ol className="priority-list">
          {finalReview.topPriorities.length > 0 ? (
            finalReview.topPriorities.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))
          ) : (
            <li>暂无优先级建议</li>
          )}
        </ol>
      </div>

      {/* Score breakdown */}
      <div className="summary-section">
        <h4 className="summary-section-title">评分拆解</h4>
        <ScoreTable items={finalReview.scoreBreakdown} />
      </div>

      {/* Expert conclusions — inline strip with mini progress bars */}
      <div className="summary-section">
        <h4 className="summary-section-title">各专家结论</h4>
        <div className="summary-agent-strip">
          {result.reviewerFeedback.map((item) => (
            <div key={item.agentName} className="summary-agent-item">
              <span className="summary-agent-name">
                {formatStageLabel(item.agentName)}
              </span>
              <span className="summary-agent-score">{item.overallScore} 分</span>
              <div className="summary-agent-bar-bg">
                <div
                  className="summary-agent-bar-fill"
                  style={{ width: `${item.overallScore}%` }}
                />
              </div>
              <span className="summary-agent-note">
                {item.concerns[0] ||
                  item.reasoningSummary[0] ||
                  item.perspective}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Section revisions */}
      <div className="summary-section">
        <h4 className="summary-section-title">逐板块修改建议</h4>
        <SuggestionTable suggestions={finalReview.sectionRevisions} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 删除不再使用的 splitSummaryText 函数**

删除 lines 244-250 的 `splitSummaryText` 函数定义：
```tsx
function splitSummaryText(text: string, maxItems = 4) {
  return text
    .split(/(?<=[。！？；;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
```

- [ ] **Step 3: 删除不再需要的 FolderGit2 图标判断**

`FolderGit2` 在 metrics 行中使用但已移除 — 检查 `FolderGit2` 是否还被其他地方使用。如果在其他组件中仍使用，保留 import；否则从 import 中移除。

运行: `grep -n "FolderGit2" src/components/review-stage-detail.tsx`

如果仅有 FinalReviewPanel 中使用（旧代码 line 759），则从 lucide-react import 中删除 `FolderGit2`（line 16）。

Expected: `FolderGit2` 仍在 `ResumeProfilePanel` 的 import 中 — 保留。

- [ ] **Step 4: Commit**

```bash
git add src/components/review-stage-detail.tsx
git commit -m "refactor: minimalist restyle of FinalReviewPanel"
```

---

### Task 2: 新增极简风格 CSS class

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 在 globals.css 末尾追加新的 summary 样式**

在文件末尾（line 4553 之后）追加：

```css
/* ═══════════════════════════════════════════════════════════════
   Summary Report — Minimalist Restyle
   ═══════════════════════════════════════════════════════════════ */

.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: clamp(14px, 2dvh, 24px);
}

.summary-header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.summary-header-left h3 {
  margin: 6px 0 0;
  color: #f8fafc;
  font-size: clamp(1.14rem, 2.55dvh, 1.48rem);
  font-weight: 800;
  line-height: 1.16;
}

.summary-header-score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.summary-header-score strong {
  color: #f8fafc;
  font-size: clamp(1.7rem, 4.2dvh, 2.5rem);
  font-weight: 860;
  line-height: 1;
  letter-spacing: -0.02em;
}

.summary-header-score small {
  color: var(--text-dim);
  font-size: 0.82rem;
  font-weight: 600;
  margin-left: 2px;
}

.summary-header-score > span {
  color: var(--text-dim);
  font-size: 0.74rem;
  font-weight: 600;
}

/* Inline metrics — plain text, no pills */
.summary-metrics-inline {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.76rem;
  line-height: 1.5;
}

.summary-metrics-sep {
  margin: 0 8px;
  opacity: 0.35;
}

/* Section divider — replaces CleanDetailSection wraps */
.summary-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-section-title {
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  color: var(--text-dim);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-section-desc {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.76rem;
  line-height: 1.5;
}

/* Agent strip — inline with mini progress bars */
.summary-agent-strip {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.summary-agent-item {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) 44px 100px minmax(0, 2fr);
  align-items: center;
  gap: 12px;
}

.summary-agent-name {
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 600;
}

.summary-agent-score {
  color: var(--cyan);
  font-size: 0.8rem;
  font-weight: 800;
  text-align: right;
}

.summary-agent-bar-bg {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 99px;
  overflow: hidden;
}

.summary-agent-bar-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, rgba(0, 242, 254, 0.6), rgba(0, 242, 254, 1));
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.summary-agent-note {
  color: var(--text-dim);
  font-size: 0.74rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Priority list — subtler marker */
.clean-report-shell .priority-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.clean-report-shell .priority-list li {
  padding-left: 2px;
  color: rgba(226, 232, 240, 0.82);
  font-size: 0.82rem;
  line-height: 1.5;
}

.clean-report-shell .priority-list li::marker {
  color: var(--text-dim);
  font-weight: 600;
  opacity: 0.6;
}

/* Responsive: agent strip collapses on narrow screens */
@media (max-width: 760px) {
  .summary-agent-item {
    grid-template-columns: 1fr 44px 72px;
  }
  .summary-agent-note {
    grid-column: 1 / -1;
    white-space: normal;
  }
}

@media (max-width: 640px) {
  .summary-header {
    flex-direction: column;
  }
  .summary-header-score {
    flex-direction: row;
    align-items: baseline;
    gap: 6px;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add minimalist summary report CSS classes"
```

---

### Task 3: 更新结构测试

**Files:**
- Modify: `src/components/review-studio.structure.test.ts:92-104`

- [ ] **Step 1: 更新测试断言**

将 lines 92-104 的测试替换为：

```typescript
test("agent reports use a clean summary-first layout instead of dense legacy report blocks", () => {
  assert.match(source, /clean-report-shell/);
  assert.match(source, /clean-report-hero/);
  assert.match(source, /clean-insight-grid/);
  assert.match(source, /clean-detail-section/);
  assert.match(source, /clean-summary-lead/);
  assert.match(source, /summary-metrics-inline/);
  assert.match(source, /summary-section-title/);
  assert.match(source, /summary-agent-strip/);

  const cleanShellRule = cssRule(".clean-report-shell");
  assert.match(cleanShellRule, /gap:\s*clamp/);
  assert.match(cleanShellRule, /background:\s*transparent/);
});
```

变更说明：
- 删除 `clean-summary-points` 断言（不再使用分点渲染）
- `clean-summary-metrics` → `summary-metrics-inline`（新 class 名）
- 新增 `summary-section-title` 和 `summary-agent-strip` 断言

- [ ] **Step 2: 运行测试确认通过**

```bash
npx vitest run src/components/review-studio.structure.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/review-studio.structure.test.ts
git commit -m "test: update structure test for minimalist summary report"
```

---

### Task 4: 删除不再使用的旧 CSS（可选清理）

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 确认旧 class 无其他引用**

```bash
grep -rn "clean-summary-overview\|clean-summary-main\|clean-summary-score\|clean-summary-points\|clean-summary-metrics\|clean-agent-list\|clean-agent-row" src/ --include="*.tsx" --include="*.ts"
```

如果结果仅包含 `globals.css` 自身（即无 TSX 引用），则可以安全删除这些 CSS 规则块。

- [ ] **Step 2: 删除旧 CSS 规则块**

删除以下 CSS 规则块（在 globals.css 中）：
- `.clean-summary-overview` + 内部 rules（lines 2768-2774）
- `.clean-summary-main` + 内部 rules（lines 2776-2778）
- `.clean-summary-lead`（lines 2788-2795）— 保留！仍在使用
- `.clean-summary-points`（lines 2797-2822）— 删除
- `.clean-summary-score` + 内部 rules（lines 2824-2858）— 删除
- `.clean-summary-metrics` + 内部 rules（lines 2860-2886）— 删除
- `.clean-agent-list`（lines 2670-2674）— 删除
- `.clean-agent-row` + 内部 rules（lines 2676-2703）— 删除

注意：`clean-summary-lead` **保留**，因为新代码仍使用它。

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: remove unused legacy summary CSS rules"
```

---

### 验证清单

- [ ] `npx tsc --noEmit` — TypeScript 编译通过
- [ ] `npx vitest run` — 所有测试通过
- [ ] `npm run dev` — 应用正常启动，summary 诊断报告以新样式渲染
