import { test } from "node:test";
import assert from "node:assert/strict";

import { createStructuredAgentProgressTracker, type StructuredAgentProgress } from "./base";

test("structured agent progress tracker forwards text deltas and partial object updates", () => {
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
    ["requesting_model", "model_thinking", "streaming_output", "streaming_output", "streaming_output"],
  );
  assert.deepEqual(
    events.slice(2).map((event) => event.payload && (event.payload as { streamType?: string }).streamType),
    ["output_text", "output_text", "partial_object"],
  );
  assert.equal(events[2].snippet, "hello");
  assert.equal(events[3].snippet, " world");
  assert.match(events[4].snippet ?? "", /executiveSummary/);
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
