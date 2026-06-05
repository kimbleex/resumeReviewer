# Agent Chat 流式优化设计

> 状态：已通过设计评审，待写实现计划。
> 日期：2026-06-05
> 范围：`src/components/pdf-agent-workbench.tsx` 及其后端管线（`src/lib/agents/resume_agent_chat/`、`src/app/api/pdf-agent/`）。

## 1. 背景与目标

当前 PDF Agent 对话区有三个问题：

1. **会"读取用户信息后卡住"** —— 模型思考/推理期间没有任何运行指示，回合看起来死掉。
2. **过程提示不全** —— 读秒只对工具步骤生效，"思考""生成"阶段不读秒；用户无法确认链路还活着。
3. **解析时机不对** —— PDF 在第一条消息时才解析，上传后无反馈。

目标：

- 上传 PDF 即解析，并在 Agent 窗口以"工具调用"步骤 + 读秒展示。
- 对话回合中"读取用户消息 → 生成最终结果"全程有运行指示与读秒，**消除思考期的死白**。
- 后端心跳 + 前端看门狗，确保"链接没断"可被用户确信；真断了能自动提示而非无限转圈。
- 提供"停止生成"控制。

## 2. 根因分析

`src/lib/agents/resume_agent_chat/agent.ts` 现状：

- `reading`、`tool-read-resume-pdf` 在 `streamText` **开始前**即被标记 `done`。
- `generating` 仅在 **第一个 `text-delta`** 时才变 `running`（agent.ts:122-134）。
- `fullStream` 循环只处理 `text-delta` 与 `error`，**忽略 `reasoning-delta`**；而 `src/lib/llm.ts` 用 `extractReasoningMiddleware`（`<think>` 标签），模型会先输出推理。
- 前端 `AgentTraceStep`（pdf-agent-workbench.tsx:72）读秒条件是 `step.id.startsWith("tool-")`，所以思考/生成不读秒。
- 前端 `showAnswer` 需 `answer.length>0 || status==="done"`，思考期连占位回答框都不显示。

结果：模型思考期间——所有步骤显示 ✓、无转圈、无回答框、无读秒 = 卡住。推理越久越明显。

## 3. 总体架构

拆成两个**职责单一**的流式端点，共用一个流式外壳。

| 端点 | 触发点 | 职责 |
|---|---|---|
| `POST /api/pdf-agent/parse` **(新增)** | `handlePdfUpload` | 跑 `read_resume_pdf`，读秒 + 心跳，回传解析文本并落缓存 |
| `POST /api/pdf-agent` **(简化)** | `handleSendPrompt` | 复用缓存文本，做"读取消息 → 生成结果"，全程读秒 + 心跳 |

确定性约束（不变）：**不引入真实 LLM tool-calling**。解析是确定性步骤（直接调 `readResumePdf`），结构测试禁止 `tools:{}` / `stepCountIs` / `createReadResumePdfTool`。系统提示词维持"原文已在消息中，无需调用工具"。

模块结构（`src/lib/agents/resume_agent_chat/`）：

```
events.ts                 事件类型（+ heartbeat）
prompts.ts                系统提示词（不变）
tools/read-resume-pdf.ts  readResumePdf（不变，被 parse.ts 复用）
parse.ts                  (新) parseResumePdf —— 上传解析流程
agent.ts                  (改) runResumeEditAgent —— 对话回合
stream-answer.ts          (新) streamAnswerEvents —— fullStream→事件 纯函数，可单测
heartbeat.ts              (新) startHeartbeat —— 心跳定时器小工具
stream-response.ts        (新) createAgentEventStream —— NDJSON 流式外壳
```

> 注：`stream-response.ts` 返回 Web 标准 `Response`，入参用 `AbortSignal`（不依赖 `NextRequest`），由 route 传入 `request.signal`。

## 4. 事件协议（events.ts）

在现有 `ResumeAgentEvent` 基础上新增 `heartbeat`，其余不变：

```ts
export type ResumeAgentEvent =
  | { type: "step"; id: string; tag: "agent" | "model"; title: string; detail?: string; status: "running" | "done" | "failed" }
  | { type: "heartbeat"; stepId: string; elapsedMs: number }   // 新增
  | { type: "answer-delta"; text: string }
  | { type: "resume-cache"; parsedResume: ParsedResumeMemory }
  | { type: "done"; citation: string }
  | { type: "error"; message: string };
```

`tag` 维持 `"agent" | "model"`（工具步骤继续用 `model`，避免 CSS/测试改动）。

固定步骤 id：`reading`（读取用户消息，tag=agent）、`generating`（生成最终结果，tag=model）、`tool-read-resume-pdf`（解析，tag=model）。需保留的中文文案：`模型提取用户问题`、`模型汇总最终输出`、`调用 read_resume_pdf 工具`、`正在解析 PDF`、`已运行`。

## 5. 共享流式外壳（stream-response.ts）

抽出 route.ts 现有手写逻辑（TransformStream + writeQueue 背压 + abort + 错误兜底 + close + NDJSON 头）：

```ts
export function createAgentEventStream(options: {
  abortSignal: AbortSignal;
  run: (push: (event: ResumeAgentEvent) => void, signal: AbortSignal) => Promise<void>;
}): Response
```

行为：
- `push` 经 `writeQueue` 串行 `writer.write`，`streamClosed` 后丢弃。
- 监听 `abortSignal` 的 `abort` → 置 `streamClosed`。
- `run` 抛错 → `push({type:"error", message})`（经 `structuredAgentErrorMessage`），用户主动 abort 不算错误。
- finally：`await writeQueue` 后 `writer.close()`。
- 头：`application/x-ndjson`、`no-store`、`X-Accel-Buffering: no`、`Content-Encoding: none`。

两个 route 都只剩：解析 formData → 调 `createAgentEventStream`。

## 6. 心跳小工具（heartbeat.ts）

```ts
export function startHeartbeat(
  stepId: string,
  push: (event: ResumeAgentEvent) => void,
  intervalMs = 4000,
): () => void   // 返回 stop()，用 Date.now() 计 elapsedMs（服务端运行时，无 Workflow 限制）
```

每 `intervalMs` 发 `{ type:"heartbeat", stepId, elapsedMs }`。解析与生成两个长等待阶段各自启停。

## 7. 后端 A —— 解析流程（parse.ts + parse/route.ts）

`parseResumePdf({ fileName, fileBuffer, onEvent, abortSignal })`：

1. `step tool-read-resume-pdf running`（`调用 read_resume_pdf 工具`）
2. `startHeartbeat("tool-read-resume-pdf", onEvent)`
3. `await readResumePdf(...)`（其 `onParsed` 拿到字数）
4. 停心跳
5. `step tool-read-resume-pdf done`（detail `已解析简历，提取 N 字`）
6. `resume-cache`（parsed）
7. `done`（citation `简历已就绪 · 提取 N 字`）
8. 出错：停心跳 → `step ... failed` + `error`

`parse/route.ts`：要求 `pdfFile`（缺失抛错），`createAgentEventStream({ abortSignal: request.signal, run: (push, signal) => parseResumePdf({...,onEvent:push,abortSignal:signal}) })`。`runtime="nodejs"`、`maxDuration=120`。

## 8. 后端 B —— 对话回合（agent.ts + route.ts）

`runResumeEditAgent` 新顺序（**核心修复**）：

1. `step reading running` → `step reading done`
2. 取 resume：优先入参 `parsedResume.content`；缺失则**兜底**走一次 `tool-read-resume-pdf`（保持健壮，正常路径不会走到）
3. **立即** `step generating running`（detail `模型思考中…`）—— 在首 token 之前
4. `const stopHeartbeat = startHeartbeat("generating", onEvent)`
5. `streamText({..., onError })` → 交给 `streamAnswerEvents` 消费 `fullStream`
6. finally 停心跳；流结束 `step generating done` → `done`（citation 含字数）
7. **空回答保护**：流结束且累计文本为空且无显式错误 → `error`（`模型未返回内容，请重试。`）
8. 出错/中断：`step generating failed` + `error`（abort 走 `structuredAgentErrorMessage` 友好文案）

`streamAnswerEvents`（纯函数，可单测）：

```ts
export async function streamAnswerEvents(options: {
  stream: AsyncIterable<AnswerStreamPart>;   // {type:"reasoning-delta"} | {type:"text-delta",text} | {type:"finish"} | {type:"error",error}
  push: (event: ResumeAgentEvent) => void;
}): Promise<{ answerText: string; failure?: unknown }>
```

逻辑：
- `reasoning-delta`：保持 `generating` running（心跳已覆盖读秒，可不发 step）。
- 首个 `text-delta`：把 `generating` detail 切 `正在生成回答…`（发一次 step running 更新），再 `answer-delta`。
- 后续 `text-delta`：累加 + `answer-delta`。
- `error`：记 failure（不抛，交由上层统一处理）。
- 返回累计文本与失败信息。

`route.ts` 简化：解析 formData（沿用 `parsedResumeContent` 等字段）→ 若有缓存内容用缓存，否则兜底带 `pdfFile` → `createAgentEventStream(...)` 调 `runResumeEditAgent`。`maxDuration` 维持 300。

## 9. 前端（pdf-agent-workbench.tsx）

### 9.1 AgentTurn 泛化

`AgentTurn` 增 `kind: "chat" | "upload"`。upload 回合不渲染用户气泡，只渲染解析步骤 + 完成提示；解析失败提供"重新解析"。

### 9.2 上传即解析

`handlePdfUpload`：建预览 + 清空 turns/cache（不变）→ 新建 upload 回合（含 `tool-read-resume-pdf` running）→ `runStream("/api/pdf-agent/parse", formData(pdfFile), uploadTurnId)`。`resume-cache` 落 `parsedResumeCache`；done 显示"简历已就绪"。解析期间 `isAgentRunning=true`（自动禁用输入/发送）。

### 9.3 统一流式消费

把现有 reader 循环抽成 `runStream(url, formData, turnId)`：建 `AbortController` 存 `abortRef` → fetch → 逐行 NDJSON → `applyEvent`（解析与对话共用）。`applyEvent` 增 `heartbeat` 分支（刷新看门狗活动时间，可选更新步骤 elapsed）。

### 9.4 读秒（任意 running 步骤）

`AgentTraceStep` 读秒条件从 `step.id.startsWith("tool-")` 改为 `step.status === "running"`。文案：
- `tool-read-resume-pdf` → `正在解析 PDF，已运行 N 秒`
- `generating` → `模型生成中，已运行 N 秒`
- 其他 running → `已运行 N 秒`

### 9.5 回答框

`generating` running 时即渲染回答区占位（`正在生成回答…`），不再等到有文本/done，消除死白。

### 9.6 停止控制

`isAgentRunning` 时，发送按钮切换为"停止"（同一按钮 Send/Stop）。点停 → `abortRef.current?.abort()`。reader 抛 AbortError 且 `controller.signal.aborted` → 该回合标"已停止生成"（中性提示，不炸红 error 框），运行步骤标记结束。

### 9.7 断连看门狗

`lastActivityRef` 在每次 `applyEvent`（含 heartbeat）时刷新为 `Date.now()`。运行中起一个 1s `setInterval`：若 `Date.now() - lastActivityRef > 15000` → `abortRef.abort()` + 回合标"连接中断，请重试。"。组件卸载/回合结束清理定时器。

## 10. 错误与边界

- **用户 abort**：友好"已停止生成"，非错误。
- **看门狗超时**：回合"连接中断，请重试。"，停转圈。
- **空回答**：后端发 `error`"模型未返回内容，请重试。"。
- **解析失败**：upload 回合 failed + "重新解析"。
- **上传非 PDF**：维持现有校验。
- **解析中再次上传**：abort 旧流 → 重置 → 解析新文件。

## 11. 测试策略（TDD）

先改测试到新契约（red）再实现（green）。

1. **单元（高价值）** `stream-answer.test.ts`（node:test）：喂假 `stream`
   - `[reasoning-delta, reasoning-delta, text-delta "你好", finish]` → 断言首个 `generating running` 在任何 `answer-delta` **之前**；得到 `answer-delta "你好"`；返回 `answerText==="你好"`。
   - 纯 reasoning 无 text → `answerText===""`（上层据此发空回答 error）。
2. **单元** `parse` 事件序列：stub `readResumePdf` → 断言 `tool-read-resume-pdf running → done → resume-cache → done`。
3. **结构测试** 更新 `pdf-agent-workbench.structure.test.ts`：
   - 保留：`模型提取用户问题`、`正在解析 PDF`、`已运行`、`/api/pdf-agent`、`getReader()`、`answer-delta`、`agent-trace-step`、`agent-stage-spinner`。
   - 新增：`/api/pdf-agent/parse`、`heartbeat`、停止（`停止`）、看门狗（`连接中断`）、读秒条件改为 `status === "running"`。
   - agent.ts：新增断言 `generating` 在流前置 running、`heartbeat`/`startHeartbeat`、`reasoning-delta`、空回答 error 文案；维持 `readResumePdf`、`调用 .* 工具`、`模型汇总最终输出`，及 `doesNotMatch tools:{} / stepCountIs / createReadResumePdfTool`。
   - events.ts：断言 `heartbeat`。
4. **全量**：`npm run typecheck` + `npm test` 通过。

## 12. 受影响文件清单

改：
- `src/lib/agents/resume_agent_chat/events.ts`
- `src/lib/agents/resume_agent_chat/agent.ts`
- `src/app/api/pdf-agent/route.ts`
- `src/components/pdf-agent-workbench.tsx`
- `src/components/pdf-agent-workbench.structure.test.ts`
- `src/app/styles/pdf-agent.css`（如需"已停止/连接中断/回答占位"少量样式）

新增：
- `src/app/api/pdf-agent/parse/route.ts`
- `src/lib/agents/resume_agent_chat/parse.ts`
- `src/lib/agents/resume_agent_chat/stream-answer.ts`
- `src/lib/agents/resume_agent_chat/heartbeat.ts`
- `src/lib/agents/resume_agent_chat/stream-response.ts`
- `src/lib/agents/resume_agent_chat/stream-answer.test.ts`

## 13. 非目标（YAGNI）

- 不引入真实 LLM tool-calling。
- 不做多文件 / 多轮上下文记忆（仍单份简历缓存）。
- 不改 PDF 预览（iframe object URL 方案不动）。
- 不引入 SSE/WebSocket（维持 NDJSON over fetch stream）。
- 停止后不支持"继续生成"（停止即结束该回合）。

## 14. 参数取值

- 心跳间隔：4000ms
- 看门狗阈值：15000ms
- 解析端点 `maxDuration`：120s；对话端点：300s
