# Agent Chat 流式优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 PDF Agent 对话区，使"上传即解析、读取消息、生成结果"全程有运行指示与读秒，消除模型思考期的"卡住"，并提供心跳/断连看门狗与停止控制。

**Architecture:** 拆成两个职责单一的 NDJSON 流式端点（`/api/pdf-agent/parse` 上传解析、`/api/pdf-agent` 对话生成），共用一个流式外壳 `createAgentEventStream`。对话回合在第一个 token 之前就把 `generating` 步骤置为 running 并启动 4s 心跳；前端对任意 running 步骤读秒，并用 15s 看门狗判定断连。保持确定性步骤，不引入真实 LLM tool-calling。

**Tech Stack:** Next.js App Router (nodejs runtime)、React 19 client component、TypeScript、`ai` v6 `streamText`、lucide-react、`node:test` + `tsx`。

**Spec:** `docs/superpowers/specs/2026-06-05-agent-chat-streaming-design.md`

---

## File Structure

`src/lib/agents/resume_agent_chat/`：
- `events.ts` — 事件类型（**改**：+ `heartbeat`）
- `heartbeat.ts` — `startHeartbeat`（**新**）
- `stream-answer.ts` — `streamAnswerEvents`（**新**，纯函数，可单测）
- `parse.ts` — `parseResumePdf` 上传解析流程（**新**）
- `stream-response.ts` — `createAgentEventStream` NDJSON 外壳（**新**）
- `agent.ts` — `runResumeEditAgent` 对话回合（**改**）
- `prompts.ts`、`tools/read-resume-pdf.ts` — 不变

`src/app/api/pdf-agent/`：
- `route.ts` — 对话端点（**改**，简化）
- `parse/route.ts` — 解析端点（**新**）

`src/components/`：
- `pdf-agent-workbench.tsx` — 工作台组件（**改**，重写流式消费）
- `pdf-agent-workbench.structure.test.ts` — 结构测试（**改**）

测试：`heartbeat.test.ts`、`stream-answer.test.ts`、`parse.test.ts`、`stream-response.test.ts`（均**新**，与被测文件同目录）。

---

## Task 1: 事件协议 + 心跳工具

**Files:**
- Modify: `src/lib/agents/resume_agent_chat/events.ts`
- Create: `src/lib/agents/resume_agent_chat/heartbeat.ts`
- Test: `src/lib/agents/resume_agent_chat/heartbeat.test.ts`

- [ ] **Step 1: 写失败测试** — `heartbeat.test.ts`

```ts
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { startHeartbeat } from "./heartbeat";
import type { ResumeAgentEvent } from "./events";

test("startHeartbeat emits a heartbeat for the step on each interval until stopped", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const events: ResumeAgentEvent[] = [];
    const stop = startHeartbeat("generating", (event) => events.push(event), 4000);

    mock.timers.tick(4000);
    mock.timers.tick(4000);
    stop();
    mock.timers.tick(4000); // 停止后不再产生

    assert.equal(events.length, 2);
    const [first, second] = events;
    assert.ok(first.type === "heartbeat" && second.type === "heartbeat");
    if (first.type === "heartbeat" && second.type === "heartbeat") {
      assert.equal(first.stepId, "generating");
      assert.equal(first.elapsedMs, 4000);
      assert.equal(second.elapsedMs, 8000);
    }
  } finally {
    mock.timers.reset();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/heartbeat.test.ts`
Expected: FAIL — `Cannot find module './heartbeat'`。

- [ ] **Step 3: 改 `events.ts`，加 `heartbeat` 事件**

把 `ResumeAgentEvent` 联合类型改为（仅新增一行 `heartbeat`，其余不变）：

```ts
export type ParsedResumeMemory = {
  fileName: string;
  charCount: number;
  content: string;
};

export type ResumeAgentEvent =
  | {
      type: "step";
      id: string;
      tag: "agent" | "model";
      title: string;
      detail?: string;
      status: "running" | "done" | "failed";
    }
  | { type: "heartbeat"; stepId: string; elapsedMs: number }
  | { type: "answer-delta"; text: string }
  | { type: "resume-cache"; parsedResume: ParsedResumeMemory }
  | { type: "done"; citation: string }
  | { type: "error"; message: string };
```

- [ ] **Step 4: 实现 `heartbeat.ts`**

```ts
import type { ResumeAgentEvent } from "./events";

/**
 * 在长等待阶段（解析 PDF、模型思考/生成）周期性发送 heartbeat 事件，
 * 用于穿透代理缓冲、并让前端确认链路仍存活。返回 stop()，调用后停止。
 */
export function startHeartbeat(
  stepId: string,
  push: (event: ResumeAgentEvent) => void,
  intervalMs = 4000,
  now: () => number = Date.now,
): () => void {
  const startedAt = now();
  const timer = setInterval(() => {
    push({ type: "heartbeat", stepId, elapsedMs: now() - startedAt });
  }, intervalMs);

  return () => clearInterval(timer);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/heartbeat.test.ts`
Expected: PASS（1 test）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/agents/resume_agent_chat/events.ts src/lib/agents/resume_agent_chat/heartbeat.ts src/lib/agents/resume_agent_chat/heartbeat.test.ts
git commit -m "feat(agent-chat): add heartbeat event and timer util"
```

---

## Task 2: streamAnswerEvents（消除卡顿的核心）

**Files:**
- Create: `src/lib/agents/resume_agent_chat/stream-answer.ts`
- Test: `src/lib/agents/resume_agent_chat/stream-answer.test.ts`

- [ ] **Step 1: 写失败测试** — `stream-answer.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { streamAnswerEvents, type AnswerStreamPart } from "./stream-answer";
import type { ResumeAgentEvent } from "./events";

async function* fakeStream(parts: AnswerStreamPart[]): AsyncIterable<AnswerStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

test("emits a running generating step before any answer delta, then streams text", async () => {
  const events: ResumeAgentEvent[] = [];
  const result = await streamAnswerEvents({
    stream: fakeStream([
      { type: "reasoning-delta", text: "想一想" },
      { type: "reasoning-delta", text: "继续想" },
      { type: "text-delta", text: "你好" },
      { type: "text-delta", text: "，世界" },
      { type: "finish", finishReason: "stop" },
    ]),
    push: (event) => events.push(event),
  });

  assert.equal(result.answerText, "你好，世界");
  assert.equal(result.failure, undefined);

  const firstStep = events.find((e) => e.type === "step");
  const firstDelta = events.find((e) => e.type === "answer-delta");
  assert.ok(firstStep && firstDelta, "should emit a step and a delta");
  assert.ok(firstStep.type === "step" && firstStep.id === "generating" && firstStep.status === "running");
  // 关键：generating 步骤出现在第一个 answer-delta 之前
  assert.ok(events.indexOf(firstStep) < events.indexOf(firstDelta));
  assert.equal(events.filter((e) => e.type === "answer-delta").length, 2);
});

test("returns empty answerText when the model only reasons and never emits text", async () => {
  const events: ResumeAgentEvent[] = [];
  const result = await streamAnswerEvents({
    stream: fakeStream([
      { type: "reasoning-delta", text: "只思考不回答" },
      { type: "finish", finishReason: "stop" },
    ]),
    push: (event) => events.push(event),
  });

  assert.equal(result.answerText, "");
  assert.equal(events.filter((e) => e.type === "answer-delta").length, 0);
});

test("captures stream error without throwing", async () => {
  const events: ResumeAgentEvent[] = [];
  const result = await streamAnswerEvents({
    stream: fakeStream([{ type: "error", error: new Error("boom") }]),
    push: (event) => events.push(event),
  });

  assert.ok(result.failure instanceof Error);
  assert.equal((result.failure as Error).message, "boom");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/stream-answer.test.ts`
Expected: FAIL — `Cannot find module './stream-answer'`。

- [ ] **Step 3: 实现 `stream-answer.ts`**

```ts
import type { ResumeAgentEvent } from "./events";

const GENERATING_STEP_ID = "generating";

export type AnswerStreamPart = {
  type: string;
  text?: string;
  error?: unknown;
  finishReason?: string;
};

/**
 * 消费模型 fullStream，把"思考 → 生成"过程转成离散事件：
 * - 首个文本增量到达时，把 generating 步骤标为"正在生成回答…"，随后逐段下发 answer-delta。
 * - reasoning 阶段不下发文本（由 heartbeat 维持读秒），调用方在进入本函数前应已把 generating 标为 running。
 * - 流内 error 不抛出，记录到返回值由调用方统一处理。
 * 返回累计文本与失败信息；累计文本为空时调用方据此判定"空回答"。
 */
export async function streamAnswerEvents(options: {
  stream: AsyncIterable<AnswerStreamPart>;
  push: (event: ResumeAgentEvent) => void;
}): Promise<{ answerText: string; failure?: unknown }> {
  let answerText = "";
  let answerStarted = false;
  let failure: unknown;

  for await (const part of options.stream) {
    switch (part.type) {
      case "text-delta": {
        const text = part.text ?? "";
        if (!text) {
          break;
        }
        if (!answerStarted) {
          answerStarted = true;
          options.push({
            type: "step",
            id: GENERATING_STEP_ID,
            tag: "model",
            title: "模型汇总最终输出",
            detail: "正在生成回答…",
            status: "running",
          });
        }
        answerText += text;
        options.push({ type: "answer-delta", text });
        break;
      }
      case "error": {
        failure = part.error;
        break;
      }
      default:
        break;
    }
  }

  return { answerText, failure };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/stream-answer.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/agents/resume_agent_chat/stream-answer.ts src/lib/agents/resume_agent_chat/stream-answer.test.ts
git commit -m "feat(agent-chat): add streamAnswerEvents with empty-answer detection"
```

---

## Task 3: parseResumePdf（上传解析流程）

**Files:**
- Create: `src/lib/agents/resume_agent_chat/parse.ts`
- Test: `src/lib/agents/resume_agent_chat/parse.test.ts`

- [ ] **Step 1: 写失败测试** — `parse.test.ts`（用 `.txt` buffer，不触发 pdf.js）

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseResumePdf } from "./parse";
import type { ResumeAgentEvent } from "./events";

test("parseResumePdf streams tool running → done → resume-cache → done for a text resume", async () => {
  const events: ResumeAgentEvent[] = [];
  await parseResumePdf({
    fileName: "resume.txt",
    fileBuffer: Buffer.from("张三 前端工程师 5年经验"),
    onEvent: (event) => events.push(event),
  });

  const running = events.find((e) => e.type === "step" && e.status === "running");
  const stepDone = events.find((e) => e.type === "step" && e.status === "done");
  const cache = events.find((e) => e.type === "resume-cache");
  const done = events.find((e) => e.type === "done");

  assert.ok(running && stepDone && cache && done);
  assert.ok(events.indexOf(running) < events.indexOf(stepDone));
  assert.ok(events.indexOf(stepDone) < events.indexOf(cache));
  assert.ok(cache.type === "resume-cache" && cache.parsedResume.content.includes("张三"));
  assert.ok(done.type === "done" && /提取 \d+ 字/.test(done.citation));
  assert.ok(!events.some((e) => e.type === "error"));
});

test("parseResumePdf emits a failed step and error for empty content", async () => {
  const events: ResumeAgentEvent[] = [];
  await parseResumePdf({
    fileName: "resume.txt",
    fileBuffer: Buffer.from("   "),
    onEvent: (event) => events.push(event),
  });

  assert.ok(events.some((e) => e.type === "step" && e.status === "failed"));
  assert.ok(events.some((e) => e.type === "error"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/parse.test.ts`
Expected: FAIL — `Cannot find module './parse'`。

- [ ] **Step 3: 实现 `parse.ts`**

```ts
import { structuredAgentErrorMessage } from "@/lib/agents/base";
import type { ResumeAgentEvent } from "./events";
import { startHeartbeat } from "./heartbeat";
import { readResumePdf } from "./tools/read-resume-pdf";

const TOOL_STEP_ID = "tool-read-resume-pdf";

/**
 * 上传即解析：把 read_resume_pdf 工具调用作为离散步骤流式上报，
 * 解析期间发送 heartbeat 读秒，完成后回传解析结果并缓存。
 */
export async function parseResumePdf(options: {
  fileName: string;
  fileBuffer: Buffer;
  onEvent: (event: ResumeAgentEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { fileName, fileBuffer, onEvent } = options;

  onEvent({
    type: "step",
    id: TOOL_STEP_ID,
    tag: "model",
    title: "调用 read_resume_pdf 工具",
    status: "running",
  });

  const stopHeartbeat = startHeartbeat(TOOL_STEP_ID, onEvent);

  try {
    const parsed = await readResumePdf({ fileName, fileBuffer });
    stopHeartbeat();

    onEvent({
      type: "step",
      id: TOOL_STEP_ID,
      tag: "model",
      title: "调用 read_resume_pdf 工具",
      detail: `已解析简历，提取 ${parsed.charCount} 字`,
      status: "done",
    });
    onEvent({ type: "resume-cache", parsedResume: parsed });
    onEvent({ type: "done", citation: `简历已就绪 · 提取 ${parsed.charCount} 字` });
  } catch (error) {
    stopHeartbeat();
    onEvent({
      type: "step",
      id: TOOL_STEP_ID,
      tag: "model",
      title: "调用 read_resume_pdf 工具失败",
      detail: structuredAgentErrorMessage(error),
      status: "failed",
    });
    onEvent({ type: "error", message: structuredAgentErrorMessage(error) });
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/parse.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/agents/resume_agent_chat/parse.ts src/lib/agents/resume_agent_chat/parse.test.ts
git commit -m "feat(agent-chat): add parseResumePdf upload-time parse flow"
```

---

## Task 4: createAgentEventStream（NDJSON 流式外壳）

**Files:**
- Create: `src/lib/agents/resume_agent_chat/stream-response.ts`
- Test: `src/lib/agents/resume_agent_chat/stream-response.test.ts`

- [ ] **Step 1: 写失败测试** — `stream-response.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAgentEventStream } from "./stream-response";

test("streams pushed events as NDJSON lines with ndjson headers", async () => {
  const ac = new AbortController();
  const response = createAgentEventStream({
    abortSignal: ac.signal,
    run: async (push) => {
      push({ type: "step", id: "reading", tag: "agent", title: "读取", status: "running" });
      push({ type: "done", citation: "ok" });
    },
  });

  const body = await response.text();
  const lines = body.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, "reading");
  assert.equal(JSON.parse(lines[1]).type, "done");
  assert.match(response.headers.get("content-type") ?? "", /x-ndjson/);
});

test("pushes an error event when the producer throws", async () => {
  const ac = new AbortController();
  const response = createAgentEventStream({
    abortSignal: ac.signal,
    run: async () => {
      throw new Error("producer failed");
    },
  });

  const body = await response.text();
  assert.match(body, /"type":"error"/);
  assert.match(body, /producer failed/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/stream-response.test.ts`
Expected: FAIL — `Cannot find module './stream-response'`。

- [ ] **Step 3: 实现 `stream-response.ts`**

```ts
import { structuredAgentErrorMessage } from "@/lib/agents/base";
import type { ResumeAgentEvent } from "./events";

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform, no-store, must-revalidate",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "Content-Encoding": "none",
} as const;

/**
 * 把一个异步生产者包装成 NDJSON 流式 Response：
 * - push 经写队列串行化，背压安全；流关闭或客户端中断后丢弃后续写入。
 * - run 抛错时（非客户端主动中断）下发一条 error 事件。
 */
export function createAgentEventStream(options: {
  abortSignal: AbortSignal;
  run: (push: (event: ResumeAgentEvent) => void, signal: AbortSignal) => Promise<void>;
}): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  let streamClosed = false;
  let writeQueue = Promise.resolve();

  const markClosed = () => {
    streamClosed = true;
  };
  options.abortSignal.addEventListener("abort", markClosed, { once: true });

  const push = (event: ResumeAgentEvent) => {
    if (streamClosed) {
      return;
    }
    writeQueue = writeQueue
      .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
      .catch(() => {
        streamClosed = true;
      });
  };

  void (async () => {
    try {
      await options.run(push, options.abortSignal);
    } catch (error) {
      if (!options.abortSignal.aborted) {
        push({ type: "error", message: structuredAgentErrorMessage(error) });
      }
    } finally {
      options.abortSignal.removeEventListener("abort", markClosed);
      await writeQueue;
      if (!streamClosed) {
        await writer.close().catch(() => {
          streamClosed = true;
        });
      }
    }
  })();

  return new Response(readable, { headers: NDJSON_HEADERS });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test src/lib/agents/resume_agent_chat/stream-response.test.ts`
Expected: PASS（2 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/agents/resume_agent_chat/stream-response.ts src/lib/agents/resume_agent_chat/stream-response.test.ts
git commit -m "feat(agent-chat): extract NDJSON stream response helper"
```

---

## Task 5: 重写对话 Agent（agent.ts）

**Files:**
- Modify: `src/lib/agents/resume_agent_chat/agent.ts`（整文件替换）
- Modify: `src/components/pdf-agent-workbench.structure.test.ts`（新增 agent 断言）

> 说明：agent.ts 的运行时正确性由 Task 2 的 `streamAnswerEvents` 单测覆盖（它需要真实模型，无法在此直接单测）。本任务用结构断言锁定"generating 先于 streamText 置 running""空回答兜底"等契约。

- [ ] **Step 1: 写失败测试** — 在 `pdf-agent-workbench.structure.test.ts` 末尾追加：

```ts
test("PDF chat agent shows generating state before the first token and guards empty answers", () => {
  assert.match(pdfAgentSource, /startHeartbeat/);
  assert.match(pdfAgentSource, /streamAnswerEvents/);
  assert.match(pdfAgentSource, /模型未返回内容/);
  assert.match(pdfAgentSource, /模型思考中/);
  // generating 在调用 streamText 之前就置为 running（消除卡顿）
  assert.ok(pdfAgentSource.indexOf("模型思考中") < pdfAgentSource.indexOf("streamText("));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: FAIL — 新断言找不到 `startHeartbeat` / `streamAnswerEvents` 等（旧 agent.ts 尚未改）。

- [ ] **Step 3: 整文件替换 `agent.ts`**

```ts
import { streamText } from "ai";

import { getStructuredAgentTimeout, structuredAgentErrorMessage } from "@/lib/agents/base";
import { createLanguageModel } from "@/lib/llm";
import type { ParsedResumeMemory, ResumeAgentEvent } from "./events";
import { startHeartbeat } from "./heartbeat";
import { RESUME_EDIT_SYSTEM_PROMPT } from "./prompts";
import { streamAnswerEvents, type AnswerStreamPart } from "./stream-answer";
import { readResumePdf } from "./tools/read-resume-pdf";

export type { ResumeAgentEvent } from "./events";

const READING_STEP_ID = "reading";
const GENERATING_STEP_ID = "generating";
const TOOL_STEP_ID = "tool-read-resume-pdf";

/**
 * 对话回合：读取用户消息 →（复用上传时解析的简历，缺失则兜底解析一次）→
 * 立即进入"生成"运行态 → 流式产出回答。关键修复：generating 步骤在第一个
 * token 之前就置为 running，并配合 heartbeat 读秒，消除模型思考期的"卡住"。
 */
export async function runResumeEditAgent(options: {
  fileName: string;
  fileBuffer: Buffer;
  prompt: string;
  parsedResume?: ParsedResumeMemory;
  onEvent: (event: ResumeAgentEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { fileName, fileBuffer, prompt, parsedResume, onEvent, abortSignal } = options;

  // 当前阶段，用于异常时把对应步骤标记为失败（而非凭空造一个 generating 失败）。
  let failStep: { id: string; tag: "agent" | "model"; title: string } = {
    id: READING_STEP_ID,
    tag: "agent",
    title: "模型提取用户问题",
  };
  let stopHeartbeat: (() => void) | null = null;

  onEvent({ type: "step", id: READING_STEP_ID, tag: "agent", title: "模型提取用户问题", status: "running" });

  try {
    // 1) 取简历原文：优先复用上传时解析的缓存；缺失则兜底解析一次。
    let resume: ParsedResumeMemory;
    if (parsedResume?.content) {
      resume = parsedResume;
      onEvent({
        type: "step",
        id: "tool-read-resume-pdf-cache",
        tag: "model",
        title: "复用 read_resume_pdf 解析结果",
        detail: `已复用 ${parsedResume.charCount || parsedResume.content.length} 字简历原文`,
        status: "done",
      });
    } else {
      failStep = { id: TOOL_STEP_ID, tag: "model", title: "调用 read_resume_pdf 工具失败" };
      onEvent({ type: "step", id: TOOL_STEP_ID, tag: "model", title: "调用 read_resume_pdf 工具", status: "running" });
      resume = await readResumePdf({ fileName, fileBuffer });
      onEvent({
        type: "step",
        id: TOOL_STEP_ID,
        tag: "model",
        title: "调用 read_resume_pdf 工具",
        detail: `已解析简历，提取 ${resume.charCount} 字`,
        status: "done",
      });
      onEvent({ type: "resume-cache", parsedResume: resume });
    }

    onEvent({ type: "step", id: READING_STEP_ID, tag: "agent", title: "模型提取用户问题", status: "done" });

    // 2) 立即进入"生成"运行态——在第一个 token 之前，消除思考期死白。
    failStep = { id: GENERATING_STEP_ID, tag: "model", title: "模型汇总最终输出" };
    onEvent({
      type: "step",
      id: GENERATING_STEP_ID,
      tag: "model",
      title: "模型汇总最终输出",
      detail: "模型思考中…",
      status: "running",
    });
    stopHeartbeat = startHeartbeat(GENERATING_STEP_ID, onEvent);

    // 3) 流式生成
    let streamFailure: unknown;
    const result = streamText({
      model: createLanguageModel(),
      system: RESUME_EDIT_SYSTEM_PROMPT,
      prompt: [
        `【用户问题】\n${prompt.trim()}`,
        `【简历文件】\n${resume.fileName}`,
        `【简历原文】\n${resume.content}`,
      ].join("\n\n"),
      abortSignal,
      timeout: getStructuredAgentTimeout(),
      onError({ error }) {
        streamFailure = error;
      },
    });

    const { answerText, failure } = await streamAnswerEvents({
      // fullStream 的具体类型随 ai 版本而变，这里统一收敛到 AnswerStreamPart。
      stream: result.fullStream as unknown as AsyncIterable<AnswerStreamPart>,
      push: onEvent,
    });

    stopHeartbeat();
    stopHeartbeat = null;

    const failureReason = failure ?? streamFailure;
    if (failureReason) {
      throw failureReason;
    }

    // 空回答保护：模型只思考不产出，明确报错而非静默"完成但空白"。
    if (!answerText.trim()) {
      onEvent({ type: "step", id: GENERATING_STEP_ID, tag: "model", title: "模型汇总最终输出", status: "failed" });
      onEvent({ type: "error", message: "模型未返回内容，请重试。" });
      return;
    }

    onEvent({ type: "step", id: GENERATING_STEP_ID, tag: "model", title: "模型汇总最终输出", status: "done" });
    const citation = `已读取并解析简历：${resume.fileName} · 提取 ${resume.charCount || resume.content.length} 字`;
    onEvent({ type: "done", citation });
  } catch (error) {
    stopHeartbeat?.();
    if (abortSignal?.aborted) {
      return; // 用户主动中断：不当作错误。
    }
    onEvent({ type: "step", id: failStep.id, tag: failStep.tag, title: failStep.title, status: "failed" });
    onEvent({ type: "error", message: structuredAgentErrorMessage(error) });
  }
}
```

- [ ] **Step 4: 运行结构测试确认通过**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: PASS — 新断言通过；既有 agent 断言（`模型提取用户问题`/`readResumePdf`/`调用 .* 工具`/`模型汇总最终输出`/`复用 read_resume_pdf 解析结果`，以及 `doesNotMatch tools:{}` / `stepCountIs|createReadResumePdfTool`）仍通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/agents/resume_agent_chat/agent.ts src/components/pdf-agent-workbench.structure.test.ts
git commit -m "feat(agent-chat): emit generating state before first token, guard empty answers"
```

---

## Task 6: 两个流式端点（routes）

**Files:**
- Modify: `src/app/api/pdf-agent/route.ts`（整文件替换，简化）
- Create: `src/app/api/pdf-agent/parse/route.ts`
- Modify: `src/components/pdf-agent-workbench.structure.test.ts`（更新/新增 route 断言）

- [ ] **Step 1: 改测试** — 在 `pdf-agent-workbench.structure.test.ts`：

把"PDF agent keeps parsed resume memory…"测试里这一行：

```ts
  assert.match(routeSource, /parsedResume:\s*parsedResume/);
```

改为（新 route 用对象简写传参）：

```ts
  assert.match(routeSource, /parsedResume,/);
```

并在文件末尾追加解析端点断言：

```ts
test("parse route streams parseResumePdf through the shared NDJSON stream helper", () => {
  const parseRouteSource = readFileSync(new URL("../app/api/pdf-agent/parse/route.ts", import.meta.url), "utf8");
  assert.match(parseRouteSource, /parseResumePdf/);
  assert.match(parseRouteSource, /createAgentEventStream/);
  assert.match(parseRouteSource, /pdfFile/);

  const chatRouteSource = readFileSync(new URL("../app/api/pdf-agent/route.ts", import.meta.url), "utf8");
  assert.match(chatRouteSource, /createAgentEventStream/);
  assert.match(chatRouteSource, /runResumeEditAgent/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: FAIL — 找不到 `parse/route.ts`，且旧 `route.ts` 无 `createAgentEventStream`。

- [ ] **Step 3a: 整文件替换 `src/app/api/pdf-agent/route.ts`**

```ts
import type { NextRequest } from "next/server";

import { runResumeEditAgent } from "@/lib/agents/resume_agent_chat/agent";
import { createAgentEventStream } from "@/lib/agents/resume_agent_chat/stream-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 允许工具调用 + 流式生成最长 5 分钟

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const fileValue = formData.get("pdfFile");
  const pdfFile = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  const prompt = String(formData.get("prompt") ?? "").trim();
  const parsedResumeContent = String(formData.get("parsedResumeContent") ?? "").trim();
  const parsedResumeFileName = String(formData.get("parsedResumeFileName") ?? "").trim();
  const parsedResumeCharCount = Number(formData.get("parsedResumeCharCount") ?? 0);
  const parsedResume = parsedResumeContent
    ? {
        fileName: parsedResumeFileName || pdfFile?.name || "resume.pdf",
        charCount:
          Number.isFinite(parsedResumeCharCount) && parsedResumeCharCount > 0
            ? parsedResumeCharCount
            : parsedResumeContent.length,
        content: parsedResumeContent,
      }
    : undefined;

  return createAgentEventStream({
    abortSignal: request.signal,
    run: async (push, signal) => {
      if (!pdfFile && !parsedResume) {
        throw new Error("请先上传简历 PDF 文件。");
      }
      if (!prompt) {
        throw new Error("请输入你希望 Agent 修改的内容。");
      }

      const fileBuffer = pdfFile ? Buffer.from(await pdfFile.arrayBuffer()) : Buffer.alloc(0);

      await runResumeEditAgent({
        fileName: pdfFile?.name || parsedResume?.fileName || "resume.pdf",
        fileBuffer,
        prompt,
        parsedResume,
        onEvent: push,
        abortSignal: signal,
      });
    },
  });
}
```

- [ ] **Step 3b: 新建 `src/app/api/pdf-agent/parse/route.ts`**

```ts
import type { NextRequest } from "next/server";

import { parseResumePdf } from "@/lib/agents/resume_agent_chat/parse";
import { createAgentEventStream } from "@/lib/agents/resume_agent_chat/stream-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 仅解析，2 分钟足够

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const fileValue = formData.get("pdfFile");
  const pdfFile = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  return createAgentEventStream({
    abortSignal: request.signal,
    run: async (push, signal) => {
      if (!pdfFile) {
        throw new Error("请先上传简历 PDF 文件。");
      }
      const fileBuffer = Buffer.from(await pdfFile.arrayBuffer());
      await parseResumePdf({ fileName: pdfFile.name, fileBuffer, onEvent: push, abortSignal: signal });
    },
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/app/api/pdf-agent/route.ts src/app/api/pdf-agent/parse/route.ts src/components/pdf-agent-workbench.structure.test.ts
git commit -m "feat(agent-chat): split parse endpoint and use shared stream helper"
```

---

## Task 7: 重写前端工作台（pdf-agent-workbench.tsx）

**Files:**
- Modify: `src/components/pdf-agent-workbench.tsx`（整文件替换）
- Modify: `src/components/pdf-agent-workbench.structure.test.ts`（新增前端断言）

- [ ] **Step 1: 写失败测试** — 在 `pdf-agent-workbench.structure.test.ts` 末尾追加：

```ts
test("PDF agent parses on upload, supports stop, ticks seconds for any running step, and watches disconnects", () => {
  assert.match(workbenchSource, /\/api\/pdf-agent\/parse/);
  assert.match(workbenchSource, /kind: "upload"/);
  assert.match(workbenchSource, /heartbeat/);
  assert.match(workbenchSource, /连接中断/);
  assert.match(workbenchSource, /已停止生成/);
  assert.match(workbenchSource, />停止</);
  assert.match(workbenchSource, /lastActivityRef/);
  assert.match(workbenchSource, /runStream/);
  // 读秒不再只对工具步骤生效：任意 running 步骤都读秒
  assert.match(workbenchSource, /const isRunning = step\.status === "running"/);
  assert.doesNotMatch(workbenchSource, /step\.id\.startsWith\("tool-"\)/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: FAIL — 旧组件无 `/api/pdf-agent/parse` / `runStream` / `连接中断` 等。

- [ ] **Step 3: 整文件替换 `src/components/pdf-agent-workbench.tsx`**

```tsx
"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  Send,
  Square,
  Upload,
} from "lucide-react";

type TraceStepStatus = "running" | "done" | "failed";

type TraceStep = {
  id: string;
  tag: "agent" | "model";
  title: string;
  detail?: string;
  status: TraceStepStatus;
};

type AgentTurnStatus = "running" | "done" | "failed";

type AgentTurn = {
  id: string;
  kind: "chat" | "upload";
  prompt: string;
  createdAt: string;
  steps: TraceStep[];
  answer: string;
  citation: string;
  status: AgentTurnStatus;
  error: string;
};

type ParsedResumeCache = {
  fileName: string;
  charCount: number;
  content: string;
};

// 与后端 src/lib/agents/resume_agent_chat/events.ts 的 ResumeAgentEvent 保持一致。
type AgentEvent =
  | { type: "step"; id: string; tag: "agent" | "model"; title: string; detail?: string; status: TraceStepStatus }
  | { type: "heartbeat"; stepId: string; elapsedMs: number }
  | { type: "answer-delta"; text: string }
  | { type: "resume-cache"; parsedResume: ParsedResumeCache }
  | { type: "done"; citation: string }
  | { type: "error"; message: string };

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function markRunningSteps(steps: TraceStep[], status: TraceStepStatus): TraceStep[] {
  return steps.map((step) => (step.status === "running" ? { ...step, status } : step));
}

const TRACE_TAG_LABEL: Record<TraceStep["tag"], string> = {
  agent: "agent",
  model: "model",
};

const AgentTraceStep = memo(function AgentTraceStep({ step }: { step: TraceStep }) {
  const isRunning = step.status === "running";
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, step.id]);

  const runningDetail =
    step.id === "tool-read-resume-pdf"
      ? `正在解析 PDF，已运行 ${elapsedSeconds} 秒`
      : step.id === "generating"
        ? `模型生成中，已运行 ${elapsedSeconds} 秒`
        : `已运行 ${elapsedSeconds} 秒`;
  const detailText = isRunning ? runningDetail : step.detail;

  return (
    <div className={`agent-trace-step is-${step.status}`}>
      <span className="agent-trace-icon" aria-hidden="true">
        {step.status === "running" ? (
          <LoaderCircle className="agent-stage-spinner" size={15} />
        ) : step.status === "failed" ? (
          <AlertCircle size={15} />
        ) : (
          <CheckCircle2 size={15} />
        )}
      </span>
      <div className="agent-trace-body">
        <div className="agent-trace-line">
          <span className={`agent-trace-tag tag-${step.tag}`}>{TRACE_TAG_LABEL[step.tag]}</span>
          <strong className="agent-trace-title">{step.title}</strong>
        </div>
        {detailText ? <code className="agent-trace-detail">{detailText}</code> : null}
      </div>
    </div>
  );
});

const AgentTurnView = memo(function AgentTurnView({ turn }: { turn: AgentTurn }) {
  const generatingRunning = turn.steps.some((step) => step.id === "generating" && step.status === "running");
  const showAnswer =
    turn.answer.length > 0 ||
    turn.citation.length > 0 ||
    generatingRunning ||
    (turn.kind === "chat" && turn.status === "done");

  return (
    <div className="agent-turn">
      {turn.kind === "chat" ? (
        <div className="agent-chat-message agent-chat-message-user">
          <span>xjl · {turn.createdAt}</span>
          <p>{turn.prompt}</p>
        </div>
      ) : null}

      {turn.steps.map((step) => (
        <AgentTraceStep key={step.id} step={step} />
      ))}

      {turn.error ? (
        <div className="pdf-agent-error" role="alert">
          <AlertCircle size={15} />
          {turn.error}
        </div>
      ) : null}

      {showAnswer ? (
        <div className="agent-answer">
          <div className="agent-answer-head">
            <span className="agent-answer-avatar">RA</span>
            {turn.citation ? <span className="agent-answer-citation">{turn.citation}</span> : null}
          </div>
          {turn.answer || generatingRunning ? (
            <div className="agent-answer-body">
              <p>{turn.answer || "正在生成回答…"}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function PdfAgentWorkbench() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [pdfPreviewVersion, setPdfPreviewVersion] = useState(0);
  const [pdfFrameKey, setPdfFrameKey] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [parsedResumeCache, setParsedResumeCache] = useState<ParsedResumeCache | null>(null);
  const objectUrlRef = useRef("");
  const isMountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"user" | "watchdog" | null>(null);
  const activeTurnRef = useRef<string | null>(null);
  const lastActivityRef = useRef(0);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const resizePromptTextarea = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 82);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 82 ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    resizePromptTextarea();
  }, [prompt, resizePromptTextarea]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [turns]);

  // 断连看门狗：运行中超过 15 秒没有任何事件（含心跳）则判定连接中断。
  useEffect(() => {
    if (!isAgentRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > 15000) {
        abortReasonRef.current = "watchdog";
        abortRef.current?.abort();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAgentRunning]);

  const downloadName = useMemo(() => {
    if (!pdfFile) {
      return "resume-agent-version.pdf";
    }
    const baseName = pdfFile.name.replace(/\.pdf$/i, "");
    return `${baseName}-agent-v${Math.max(pdfPreviewVersion, 1)}.pdf`;
  }, [pdfFile, pdfPreviewVersion]);

  const updateTurn = useCallback((turnId: string, updater: (turn: AgentTurn) => AgentTurn) => {
    setTurns((current) => current.map((turn) => (turn.id === turnId ? updater(turn) : turn)));
  }, []);

  const promptPlaceholder = useMemo(() => {
    if (!isAgentRunning) {
      return "输入简历修改要求";
    }
    const latestTurn = turns[turns.length - 1];
    const runningStep = latestTurn?.steps.find((step) => step.status === "running");
    if (runningStep?.id === "tool-read-resume-pdf") {
      return "正在解析 PDF...";
    }
    if (runningStep?.id === "generating") {
      return "正在汇总最终输出...";
    }
    return "Agent 正在处理...";
  }, [isAgentRunning, turns]);

  const applyEvent = useCallback(
    (turnId: string, eventPayload: AgentEvent) => {
      if (!isMountedRef.current) {
        return;
      }
      lastActivityRef.current = Date.now();
      if (eventPayload.type === "heartbeat") {
        return; // 心跳仅用于刷新活跃时间（看门狗）。
      }
      if (eventPayload.type === "resume-cache") {
        setParsedResumeCache(eventPayload.parsedResume);
        return;
      }
      updateTurn(turnId, (turn) => {
        switch (eventPayload.type) {
          case "step": {
            const nextStep: TraceStep = {
              id: eventPayload.id,
              tag: eventPayload.tag,
              title: eventPayload.title,
              detail: eventPayload.detail,
              status: eventPayload.status,
            };
            const existingIndex = turn.steps.findIndex((step) => step.id === eventPayload.id);
            const steps =
              existingIndex >= 0
                ? turn.steps.map((step, index) =>
                    index === existingIndex && !(step.status === "done" && nextStep.status === "running")
                      ? nextStep
                      : step,
                  )
                : [...turn.steps, nextStep];
            return { ...turn, steps };
          }
          case "answer-delta":
            return { ...turn, answer: turn.answer + eventPayload.text };
          case "done":
            return {
              ...turn,
              citation: eventPayload.citation,
              status: "done",
              steps: markRunningSteps(turn.steps, "done"),
            };
          case "error":
            return {
              ...turn,
              status: "failed",
              error: eventPayload.message,
              steps: markRunningSteps(turn.steps, "failed"),
            };
          default:
            return turn;
        }
      });
    },
    [updateTurn],
  );

  const runStream = useCallback(
    async (url: string, formData: FormData, turnId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      abortReasonRef.current = null;
      activeTurnRef.current = turnId;
      lastActivityRef.current = Date.now();
      setIsAgentRunning(true);

      try {
        const response = await fetch(url, { method: "POST", body: formData, signal: controller.signal });
        if (!response.ok || !response.body) {
          throw new Error(`请求失败（${response.status}）`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) {
              try {
                applyEvent(turnId, JSON.parse(line) as AgentEvent);
              } catch {
                // 跳过无法解析的行，保持流式继续。
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (isMountedRef.current) {
          updateTurn(turnId, (turn) =>
            turn.status === "running"
              ? { ...turn, status: "done", steps: markRunningSteps(turn.steps, "done") }
              : turn,
          );
        }
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        if (controller.signal.aborted) {
          const stopped = abortReasonRef.current === "user";
          updateTurn(turnId, (turn) => ({
            ...turn,
            status: "failed",
            error: stopped ? "已停止生成。" : "连接中断，请重试。",
            steps: markRunningSteps(turn.steps, "failed"),
          }));
          return;
        }
        const message = error instanceof Error ? error.message : "Agent 执行失败，请稍后重试。";
        updateTurn(turnId, (turn) => ({
          ...turn,
          status: "failed",
          error: message,
          steps: markRunningSteps(turn.steps, "failed"),
        }));
        setAgentError(message);
      } finally {
        // 仅当前活跃流可重置全局状态，避免"解析中再次上传"中断旧流时的竞态。
        if (abortRef.current === controller) {
          abortRef.current = null;
          activeTurnRef.current = null;
          abortReasonRef.current = null;
          if (isMountedRef.current) {
            setIsAgentRunning(false);
          }
        }
      }
    },
    [applyEvent, updateTurn],
  );

  const handlePdfUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.currentTarget.files?.[0] ?? null;
      if (!nextFile) {
        return;
      }

      const isPdf = nextFile.type === "application/pdf" || nextFile.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        setAgentError("请上传 PDF 文件。");
        return;
      }

      // 解析中再次上传：先中断旧流。
      if (abortRef.current) {
        abortReasonRef.current = "user";
        abortRef.current.abort();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      const nextUrl = URL.createObjectURL(nextFile);
      objectUrlRef.current = nextUrl;
      setPdfFile(nextFile);
      setPdfPreviewUrl(nextUrl);
      setPdfPreviewVersion(1);
      setPdfFrameKey((current) => current + 1);
      setLastUpdatedAt(formatTime());
      setAgentError("");
      setParsedResumeCache(null);

      // 上传即解析：在 Agent 窗口插入 upload 回合并调用解析端点。
      const turnId = makeId();
      setTurns([
        {
          id: turnId,
          kind: "upload",
          prompt: "",
          createdAt: formatTime(),
          steps: [
            { id: "tool-read-resume-pdf", tag: "model", title: "调用 read_resume_pdf 工具", status: "running" },
          ],
          answer: "",
          citation: "",
          status: "running",
          error: "",
        },
      ]);

      const formData = new FormData();
      formData.append("pdfFile", nextFile);
      void runStream("/api/pdf-agent/parse", formData, turnId);
    },
    [runStream],
  );

  const handleRefreshPreview = useCallback(() => {
    if (!pdfPreviewUrl) {
      setAgentError("请先上传 PDF。");
      return;
    }
    setPdfFrameKey((current) => current + 1);
    setLastUpdatedAt(formatTime());
    setAgentError("");
  }, [pdfPreviewUrl]);

  const handleClearAgent = useCallback(() => {
    if (isAgentRunning) {
      return;
    }
    setAgentError("");
    setPrompt("");
    setTurns([]);
    requestAnimationFrame(resizePromptTextarea);
  }, [isAgentRunning, resizePromptTextarea]);

  const handleStop = useCallback(() => {
    abortReasonRef.current = "user";
    abortRef.current?.abort();
  }, []);

  const handleSendPrompt = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedPrompt = prompt.trim();
      if (!pdfPreviewUrl || !pdfFile) {
        setAgentError("请先上传 PDF 文件。");
        return;
      }
      if (!trimmedPrompt) {
        setAgentError("请输入你希望 Agent 修改的内容。");
        return;
      }
      if (isAgentRunning) {
        return;
      }

      setAgentError("");
      setPrompt("");

      const turnId = makeId();
      setTurns((current) => [
        ...current,
        {
          id: turnId,
          kind: "chat",
          prompt: trimmedPrompt,
          createdAt: formatTime(),
          steps: [{ id: "reading", tag: "agent", title: "模型提取用户问题", status: "running" }],
          answer: "",
          citation: "",
          status: "running",
          error: "",
        },
      ]);

      const formData = new FormData();
      formData.append("prompt", trimmedPrompt);
      if (parsedResumeCache && parsedResumeCache.fileName === pdfFile.name) {
        formData.append("parsedResumeFileName", parsedResumeCache.fileName);
        formData.append("parsedResumeCharCount", String(parsedResumeCache.charCount));
        formData.append("parsedResumeContent", parsedResumeCache.content);
      } else {
        formData.append("pdfFile", pdfFile);
      }

      await runStream("/api/pdf-agent", formData, turnId);
    },
    [isAgentRunning, parsedResumeCache, pdfFile, pdfPreviewUrl, prompt, runStream],
  );

  return (
    <section className="pdf-agent-workbench" aria-label="Agent 改简历工作台">
      <section className="pdf-preview-panel">
        <div className="pdf-preview-header">
          <div>
            <span className="panel-kicker">LIVE PDF PREVIEW</span>
            <h2>浏览器实时预览</h2>
          </div>
          <label className="pdf-upload-button">
            <input type="file" accept="application/pdf,.pdf" onChange={handlePdfUpload} />
            <Upload size={16} />
            <span>上传 PDF</span>
          </label>
        </div>

        <div className="pdf-preview-surface">
          {pdfPreviewUrl ? (
            <iframe
              key={pdfFrameKey}
              className="pdf-preview-frame"
              src={pdfPreviewUrl}
              title={pdfFile?.name ?? "PDF 预览"}
            />
          ) : (
            <div className="pdf-empty-state">
              <FileText size={26} />
              <strong>上传 PDF 后立即在这里预览</strong>
            </div>
          )}
        </div>

        <footer className="pdf-preview-toolbar">
          <div className="pdf-version-meta">
            <strong>{pdfFile?.name ?? "尚未选择文件"}</strong>
            <span>
              v{Math.max(pdfPreviewVersion, 1)} {lastUpdatedAt ? `· 更新于 ${lastUpdatedAt}` : "· 等待上传"}
            </span>
          </div>
          <div className="pdf-preview-actions">
            <button type="button" onClick={handleRefreshPreview} disabled={!pdfPreviewUrl}>
              <RefreshCw size={15} />
              <span>刷新预览</span>
            </button>
            <a
              className={!pdfPreviewUrl ? "is-disabled" : ""}
              href={pdfPreviewUrl || undefined}
              download={downloadName}
              aria-disabled={!pdfPreviewUrl}
            >
              <Download size={15} />
              <span>下载 PDF</span>
            </a>
          </div>
        </footer>
      </section>

      <aside className="pdf-agent-panel">
        <div className="pdf-agent-header">
          <div>
            <div className="pdf-agent-title-row">
              <h2>RA</h2>
              <span className={`agent-run-state ${isAgentRunning ? "is-running" : ""}`}>
                {isAgentRunning ? <LoaderCircle className="agent-stage-spinner" size={14} /> : <Bot size={14} />}
                {isAgentRunning ? "运行中" : "就绪"}
              </span>
            </div>
            <p>Resume Assistant Agent</p>
          </div>
          <button type="button" className="agent-clear-button" onClick={handleClearAgent} disabled={isAgentRunning}>
            清空
          </button>
        </div>

        <div className="agent-conversation-scroll" ref={scrollRef} aria-label="Agent 对话和执行过程">
          {agentError && turns.length === 0 ? (
            <div className="pdf-agent-error" role="alert">
              <AlertCircle size={15} />
              {agentError}
            </div>
          ) : null}

          {turns.length === 0 && !agentError ? (
            <div className="agent-empty-hint">
              <Bot size={26} />
              <strong>上传 PDF 后 RA 会自动解析，再告诉它怎么改</strong>
            </div>
          ) : null}

          {turns.map((turn) => (
            <AgentTurnView key={turn.id} turn={turn} />
          ))}
        </div>

        <form className="agent-prompt-form" onSubmit={handleSendPrompt}>
          <div className="agent-prompt-shell">
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isAgentRunning) {
                    event.currentTarget.form?.requestSubmit();
                  }
                }
              }}
              aria-label="输入简历修改要求"
              placeholder={promptPlaceholder}
              rows={1}
              disabled={isAgentRunning}
            />
            {isAgentRunning ? (
              <button type="button" className="agent-send-button" onClick={handleStop}>
                <Square size={15} />
                停止
              </button>
            ) : (
              <button type="submit" className="agent-send-button">
                <Send size={16} />
                发送
              </button>
            )}
          </div>
        </form>
      </aside>
    </section>
  );
}
```

- [ ] **Step 4: 运行完整结构测试确认通过**

Run: `node --import tsx --test src/components/pdf-agent-workbench.structure.test.ts`
Expected: PASS（含新断言与全部既有断言）。

- [ ] **Step 5: 提交**

```bash
git add src/components/pdf-agent-workbench.tsx src/components/pdf-agent-workbench.structure.test.ts
git commit -m "feat(agent-chat): parse on upload, per-step seconds, stop button, disconnect watchdog"
```

---

## Task 8: 全量验证与手动确认

**Files:** 无生产代码改动（除非验证发现 bug）。

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS，无 TypeScript 错误。
（若 `result.fullStream as unknown as AsyncIterable<AnswerStreamPart>` 报错，确认 `AnswerStreamPart` 的可选字段拼写与 Task 2 一致。）

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: PASS。新增 4 个单测文件 + 结构测试全部通过。

- [ ] **Step 3: 手动验证（开发服务器）**

Run: `npm run dev`，浏览器打开 Agent Chat 工作台：
1. 上传一个 PDF → Agent 窗口立即出现"调用 read_resume_pdf 工具"步骤并**读秒**；完成后显示"简历已就绪 · 提取 N 字"，输入框解禁。
2. 发送一条修改要求 → 依次出现"模型提取用户问题 ✓"、"复用 read_resume_pdf 解析结果 ✓"、"模型汇总最终输出（读秒、转圈）"，**思考期不再死白**；随后逐字流式出现回答。
3. 生成中点"停止" → 立即停，回合显示"已停止生成。"。
4. （可选）断网模拟：生成中切断网络 → 约 15 秒后回合显示"连接中断，请重试。"，不再无限转圈。

- [ ] **Step 4: 最终提交（如手动验证有修复）**

```bash
git add -A
git commit -m "fix(agent-chat): adjustments from manual verification"
```

---

## Self-Review

**Spec coverage（§ 对应任务）：**
- §3 双端点 + 共享外壳 → Task 4（外壳）、Task 6（两路由）✓
- §4 heartbeat 事件 → Task 1 ✓
- §5 流式外壳 → Task 4 ✓
- §6 心跳工具 → Task 1 ✓
- §7 解析流程 → Task 3 + Task 6（parse 路由）✓
- §8 对话回合（generating 先置 running、空回答兜底、streamAnswerEvents）→ Task 2 + Task 5 ✓
- §9 前端（upload 回合、统一 runStream、任意 running 读秒、回答占位、停止、看门狗）→ Task 7 ✓
- §10 错误/边界（abort、看门狗、空回答、解析失败、解析中再上传）→ Task 5/6/7 ✓
- §11 测试（streamAnswerEvents 单测、parse 单测、结构测试更新）→ Tasks 2/3/4/5/6/7 ✓
- §13 非目标：未引入真实 tool-calling / SSE / 多文件记忆 ✓
- §14 参数：心跳 4s（Task 1 默认值）、看门狗 15s（Task 7）、parse 120s / chat 300s（Task 6）✓

**Placeholder scan:** 无 TODO/TBD；每个改代码的步骤都给了完整代码。

**Type consistency:** `ResumeAgentEvent`（含 `heartbeat`）、`AnswerStreamPart`、`ParsedResumeMemory`、`TraceStep`、`AgentTurn`（含 `kind`）、`startHeartbeat`/`streamAnswerEvents`/`parseResumePdf`/`createAgentEventStream`/`runResumeEditAgent`/`runStream`/`markRunningSteps` 在各任务间签名一致。步骤 id 统一：`reading` / `generating` / `tool-read-resume-pdf` / `tool-read-resume-pdf-cache`。前端 `AgentEvent` 联合与后端 `ResumeAgentEvent` 字段一致。

**注意事项（实现者）：**
- `lucide-react` 的停止图标用 `Square`（确认已安装版本导出；如无则用 `StopCircle`）。
- 单测用绝对/相对路径单文件运行；全量用 `npm test`。
- 仅提交各任务涉及的文件，不要把仓库里其它 WIP 一起提交。
