# Next.js Web Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python Rich prototype with a working `Next.js + TypeScript` web application that streams multi-agent resume review progress and results.

**Architecture:** Use a single Next.js App Router codebase with Route Handlers for server-side orchestration. Keep the resume review workflow deterministic and structured, and stream NDJSON chunks to a client-side review dashboard.

**Tech Stack:** Next.js, React, TypeScript, Zod, LangChain JS, `@langchain/openai`, `pdf-parse`, `mammoth`, Vitest

---

### Task 1: Bootstrap the Next.js workspace

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `next-env.d.ts`
- Modify: `.gitignore`

- [ ] Add runtime and dev dependencies for Next.js, React, TypeScript, LangChain JS, parsing, and tests.
- [ ] Add project scripts for `dev`, `build`, `start`, `test`, and `typecheck`.
- [ ] Add Node/Next build artifacts to `.gitignore`.

### Task 2: Define shared review schemas

**Files:**
- Create: `src/lib/review/schemas.ts`

- [ ] Port the Python schema normalization logic to Zod-backed TypeScript helpers.
- [ ] Define `ResumeProfile`, `ReviewerFeedback`, `FinalResumeReview`, and stream event schemas.
- [ ] Export inferred TypeScript types for UI and API reuse.

### Task 3: Port deterministic resume utilities

**Files:**
- Create: `src/lib/resume/signals.ts`
- Create: `src/lib/resume/loader.ts`

- [ ] Implement signal extraction for name, age, phone, email, location, and links.
- [ ] Implement local file and upload parsing for `txt`, `md`, `pdf`, and `docx`.
- [ ] Return structured `ResumeDocument` values for the review pipeline.

### Task 4: Port LangChain agent wrappers

**Files:**
- Create: `src/lib/llm.ts`
- Create: `src/lib/agents/base.ts`
- Create: `src/lib/agents/prompts.ts`
- Create: `src/lib/agents/resume-parser.ts`
- Create: `src/lib/agents/hr.ts`
- Create: `src/lib/agents/interviewer.ts`
- Create: `src/lib/agents/career-master.ts`
- Create: `src/lib/agents/summary.ts`

- [ ] Build a shared structured-agent helper around LangChain JS `createAgent`.
- [ ] Keep prompts in Chinese and require structured outputs.
- [ ] Mirror the Python pipeline roles with typed agent modules.

### Task 5: Implement the streaming review pipeline

**Files:**
- Create: `src/lib/review/pipeline.ts`
- Create: `src/app/api/review/route.ts`

- [ ] Implement sequential pipeline execution with stage callbacks.
- [ ] Emit NDJSON chunks for stage events, final result, and errors.
- [ ] Keep route runtime on Node.js for filesystem and parsing support.

### Task 6: Build the Web UI

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/components/review-studio.tsx`

- [ ] Build a polished single-screen review workspace.
- [ ] Support upload and local path input modes.
- [ ] Render live stage status, timeline, agent result panels, and final score tables.

### Task 7: Add focused tests

**Files:**
- Create: `src/lib/review/schemas.test.ts`
- Create: `src/lib/resume/signals.test.ts`
- Create: `src/lib/review/pipeline.test.ts`

- [ ] Cover schema normalization for nested inputs and score breakdown coercion.
- [ ] Cover deterministic resume signal extraction.
- [ ] Cover pipeline stage order with stubbed agent functions.

### Task 8: Update project docs

**Files:**
- Modify: `README.md`
- Modify: `project_plan.md`

- [ ] Rewrite the root docs around the Next.js architecture.
- [ ] Document local dev, environment variables, and Vercel deployment shape.
