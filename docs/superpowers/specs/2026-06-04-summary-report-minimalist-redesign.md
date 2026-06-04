# Summary 诊断报告极简化重设计

**日期**: 2026-06-04  
**状态**: 已批准  
**范围**: `FinalReviewPanel` 组件（智能协同终审诊断书）

## 目标

将 summary 页面的诊断报告从当前"卡片边框驱动"的视觉风格，转为**简洁专业、留白驱动**的极简风格。

## 设计原则

- **去边框化**: 去掉不必要的卡片边框和背景色，用间距和字号区分层级
- **减少装饰**: 去掉多余的视觉噪音（pill 背景、包围盒）
- **信息优先**: 强化核心数据（评分、等级）的排版层次

## 改动详情

### 1. 顶部标题区

**改前**: 标题 + 摘要分点列表 + 右侧独立评分盒子（`clean-summary-score`，有边框/背景）

**改后**:
- 评分数字与标题同排右对齐，字号放大，去掉包围盒
- 就绪等级紧跟分数后，用 `·` 分隔，颜色语义化
- 摘要保持整段自然渲染，去掉 `splitSummaryText` 分点逻辑
- 文件删除: `splitSummaryText` 函数调用及辅助 points 渲染

### 2. 指标行

**改前**: `clean-summary-metrics` — 带背景色的 pill 行，包含就绪等级（重复出现）

**改后**:
- 纯文本 + `·` 分隔符，无背景无边框
- 不再重复显示就绪等级（已在评分旁）
- 显示: 优先事项数 · 专家数 · 文件名

### 3. 分区标题

**改前**: `CleanDetailSection` 组件包裹，有背景色和边框

**改后**:
- 小号 uppercase 标题 + 底部细线分隔
- 去掉 `CleanDetailSection` 的外层卡片包裹
- section 之间用 `gap: 24px` 分隔

### 4. 各专家结论

**改前**: `clean-agent-row` — 卡片式布局，有边框和背景

**改后**:
- 每行: Agent 图标/名 + 分数 + 微型进度条
- 无边框无背景，纯排版分隔
- 保留 Agent 的核心结论摘要文字

### 5. 优先行动列表

保持 `<ol>` 结构，微调:
- marker 颜色从 cyan 改为更低调的灰色
- 减小行间距

### 6. 评分拆解 & 修改建议

这两块基础样式已不错，仅微调:
- 去掉 `CleanDetailSection` 外层包裹
- 统一间距

## 文件改动范围

| 文件 | 改动类型 |
|------|----------|
| `src/components/review-stage-detail.tsx` | `FinalReviewPanel` 组件重构（~50 行变更） |
| `src/app/globals.css` | 新增 3-5 个轻量 class，简化部分旧样式（~20 行变更） |

## 不变的部分

- `ReviewerResultPanel`（专家诊断面板）— 本次不改
- `ResumeProfilePanel`（简历画像面板）— 本次不改
- `RewriteResultPanel`（重写结果面板）— 本次不改
- `ScoreTable`、`SuggestionTable` 等共享子组件 — 本次不改
- 响应式断点逻辑 — 保持不变

## 风险

- **低风险**: 仅改 CSS 和 FinalReviewPanel 的 JSX 结构，不涉及数据流或业务逻辑
- 现有的 `clean-summary-score`、`clean-summary-metrics` 等 CSS class 仅被 FinalReviewPanel 使用，修改不影响其他组件
