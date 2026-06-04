# PDF Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PC-first PDF Agent editing workbench with native browser PDF preview, staged Agent execution UI, shared top navigation, and conditional admin identity actions.

**Architecture:** Keep the existing review workflow intact and add the PDF editor as a focused sibling component. `ReviewStudio` owns authenticated workspace switching and identity actions; `PdfAgentWorkbench` owns PDF object URLs, preview refresh, download, chat messages, stage state, and concise tool-call disclosure rows.

**Tech Stack:** Next.js App Router, React 19 client components, TypeScript, lucide-react, native browser PDF preview via iframe, node:test structure tests.

---

### Task 1: Structure Tests

**Files:**
- Create: `src/components/pdf-agent-workbench.structure.test.ts`
- Modify: `src/components/review-studio.structure.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new test file that reads `pdf-agent-workbench.tsx`, `review-studio.tsx`, and `globals.css`, then asserts the new workbench contract:

```ts
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
```

Update the existing structure test source list so `pdf-agent-workbench.tsx` is included in combined UI assertions:

```ts
const source = [
  "./review-studio.tsx",
  "./review-stage-detail.tsx",
  "./review-studio-shared.ts",
  "./pdf-agent-workbench.tsx",
]
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test src/components/pdf-agent-workbench.structure.test.ts`

Expected: FAIL because `src/components/pdf-agent-workbench.tsx` does not exist yet.

### Task 2: PDF Agent Component

**Files:**
- Create: `src/components/pdf-agent-workbench.tsx`

- [ ] **Step 1: Implement minimal component**

Create a client component with:

```tsx
"use client";

export function PdfAgentWorkbench() {
  return (
    <section className="pdf-agent-workbench">
      <section className="pdf-preview-panel">native PDF preview</section>
      <aside className="pdf-agent-panel">agent stages</aside>
    </section>
  );
}
```

Then expand it to include object URL upload, iframe preview, refresh, download, staged chat state, running spinner, and `<details className="agent-tool-call">` rows.

- [ ] **Step 2: Run focused tests**

Run: `npm test src/components/pdf-agent-workbench.structure.test.ts`

Expected: Still FAIL until `ReviewStudio` imports and renders `<PdfAgentWorkbench />`.

### Task 3: Shared Workspace Navigation

**Files:**
- Modify: `src/components/review-studio.tsx`

- [ ] **Step 1: Wire navigation**

Import `FilePenLine`, `GitBranch`, `PanelRight`, and `PdfAgentWorkbench`. Add:

```ts
const [activeWorkspace, setActiveWorkspace] = useState<"workflow" | "agent">("workflow");
```

Render `.workspace-nav` buttons for `工作流诊断` and `Agent 改简历`, conditionally render workflow actions only for the workflow tab, and render `<PdfAgentWorkbench />` for the agent tab.

- [ ] **Step 2: Move identity menu to topbar**

Replace the bottom-right floating identity hub with a `.topbar-identity-menu` inside the header. Keep admin link conditional:

```tsx
{identity?.kind === "user" && identity.user.role === "ADMIN" ? (
  <a className="topbar-identity-action admin-link" href="/admin">管理面板</a>
) : null}
```

- [ ] **Step 3: Run focused tests**

Run: `npm test src/components/pdf-agent-workbench.structure.test.ts src/components/review-studio.structure.test.ts`

Expected: PASS after styles are added in Task 4.

### Task 4: PC Workbench Styling

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add navigation styles**

Add `.workspace-nav`, `.workspace-nav-button`, `.topbar-identity-menu`, `.topbar-identity-trigger`, `.topbar-identity-panel`, and `.topbar-identity-action` rules using the existing dark command-center theme.

- [ ] **Step 2: Add PDF workbench styles**

Add `.pdf-agent-workbench` with:

```css
.pdf-agent-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(360px, 0.9fr);
}
```

Add preview panel, iframe, toolbar, agent panel, message list, stage rows, spinner, and tool-call disclosure styles.

- [ ] **Step 3: Run focused tests**

Run: `npm test src/components/pdf-agent-workbench.structure.test.ts src/components/review-studio.structure.test.ts`

Expected: PASS.

### Task 5: Full Verification

**Files:**
- No production edits unless verification finds a bug.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/components/pdf-agent-workbench.structure.test.ts src/components/review-studio.structure.test.ts src/components/pdf-agent-workbench.tsx src/components/review-studio.tsx src/app/globals.css docs/superpowers/plans/2026-06-04-pdf-agent-workbench-implementation.md
git commit -m "feat: add pdf agent workbench"
```

