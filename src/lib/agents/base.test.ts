import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createStructuredAgentProgressTracker,
  getStructuredAgentTimeout,
  structuredAgentErrorMessage,
  type StructuredAgentProgress,
} from "./base";

test("structured agent progress tracker reports output phase without forwarding raw deltas", () => {
  const events: StructuredAgentProgress[] = [];
  const tracker = createStructuredAgentProgressTracker({
    name: "summary_agent",
    onProgress: (event) => events.push(event),
  });

  tracker.start();
  tracker.recordTextDelta("hello");
  tracker.recordTextDelta(" world");
  tracker.recordPartialOutput({ executiveSummary: "候选人优势清晰" });

  assert.deepEqual(
    events.map((event) => event.phase),
    ["requesting_model", "model_thinking", "streaming_output"],
  );
  assert.equal(events[2].snippet, undefined);
  assert.equal(events[2].payload, undefined);
  assert.match(events[2].message, /正在生成结构化诊断报告/);
});

test("structured agent progress tracker emits heartbeat for the active phase", () => {
  const events: StructuredAgentProgress[] = [];
  let now = 0;
  const tracker = createStructuredAgentProgressTracker({
    name: "summary_agent",
    onProgress: (event) => events.push(event),
    now: () => now,
  });

  tracker.start();
  now = 31000;
  tracker.emitHeartbeat();

  const heartbeat = events.at(-1);
  assert.equal(heartbeat?.phase, "model_thinking");
  assert.match(heartbeat?.message ?? "", /仍在执行/);
  assert.deepEqual(heartbeat?.details, ["summary_agent 已运行 31 秒"]);
});

test("structured agent calls have hard total and no-chunk timeouts", () => {
  assert.deepEqual(getStructuredAgentTimeout(), {
    totalMs: 180000,
    chunkMs: 90000,
  });
});

test("structured agent timeout errors are shown as actionable Chinese messages", () => {
  assert.equal(
    structuredAgentErrorMessage(new Error("streamText timed out after 90000ms")),
    "模型调用超时，请稍后重试或换一个更快的模型。",
  );
});
