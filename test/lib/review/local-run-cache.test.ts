import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

import { buildReviewResumeState, interruptRunningStages, loadLocalReviewRun, saveLocalReviewRun, type LocalReviewRunSnapshot } from "@/lib/review/local-run-cache";
import { getReviewDisplayPayloads } from "@/lib/review/scoring";
import type { ResumeDocument, ResumeProfile, ReviewerFeedback } from "@/lib/review/schemas";
import { createInitialStageStatus } from "@/lib/review/stages";

test("buildReviewResumeState maps completed stage payloads to API resume state", () => {
  const document: ResumeDocument = {
    path: "upload://resume.txt",
    fileType: "txt",
    content: "Resume text",
  };
  const profile: ResumeProfile = {
    candidateName: "Jordan",
    personalInfo: { name: "Jordan", age: "", phone: "", email: "", location: "", links: [] },
    headline: "RPA Engineer",
    targetRoles: ["RPA Engineer"],
    yearsOfExperience: "4 years",
    coreSkills: ["RPA"],
    skillGroups: [],
    workExperiences: [],
    projects: [],
    educationRecords: [],
    strengths: [],
    risks: [],
    missingInformation: [],
    reasoningSummary: [],
  };
  const hrFeedback: ReviewerFeedback = {
    agentName: "hr_agent",
    perspective: "HR",
    overallScore: 72,
    reasoningSummary: [],
    strengths: [],
    concerns: [],
    scoreBreakdown: [],
    suggestions: [],
  };

  const resumeState = buildReviewResumeState({
    stagePayloads: {
      resume_loader: document,
      resume_parser: profile,
      hr_agent: hrFeedback,
    },
    finalResult: null,
  });

  assert.deepEqual(resumeState, {
    document,
    profile,
    reviewerFeedback: {
      hr_agent: hrFeedback,
    },
  });
});

test("interruptRunningStages preserves completed nodes and marks active nodes as interrupted", () => {
  assert.deepEqual(
    interruptRunningStages({
      ...createInitialStageStatus(),
      resume_loader: "done",
      resume_parser: "done",
      hr_agent: "running",
      interviewer_agent: "running",
    }),
    {
      ...createInitialStageStatus(),
      resume_loader: "done",
      resume_parser: "done",
      hr_agent: "interrupted",
      interviewer_agent: "interrupted",
    },
  );
});

function installBrowserStorage(t: TestContext, withIndexedDb = true) {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    clear: () => entries.clear(),
  };
  for (const [key, value] of Object.entries({ localStorage: storage, indexedDB: withIndexedDb ? new IDBFactory() : undefined })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  return storage;
}

function rewriteSnapshot(updatedAt = 1): LocalReviewRunSnapshot {
  return {
    runId: "rewrite-run",
    resumeFileName: "resume.md",
    targetRole: "工程师",
    targetDescription: "",
    stageStatus: { ...createInitialStageStatus(), rewrite_agent: "running" },
    stagePayloads: {
      resume_loader: { path: "resume.md", fileType: "md", content: "原始简历" },
      rewrite_agent: { checkpoint: "rewrite_content", value: { rewrittenContent: "# 张三\n\n工程师", explanation: "" } },
    },
    stageStreams: {},
    finalResult: null,
    updatedAt,
  };
}

test("rewrite body is recoverable immediately before IndexedDB has committed", async (t) => {
  installBrowserStorage(t, false);
  const snapshot = rewriteSnapshot();
  const saving = saveLocalReviewRun(snapshot);
  // Simulate refresh before waiting for any asynchronous persistence work.
  const restored = await loadLocalReviewRun();
  assert.deepEqual(restored, snapshot);
  assert.equal(buildReviewResumeState({ stagePayloads: restored!.stagePayloads, finalResult: null }).checkpoints?.rewrite_agent?.checkpoint, "rewrite_content");
  assert.deepEqual(getReviewDisplayPayloads(restored!.stagePayloads).rewrite_agent, {
    rewrittenContent: "# 张三\n\n工程师", explanation: "",
  });
  await saving;
});

test("saving waits for an IndexedDB commit and preserves the newest result across consecutive writes", async (t) => {
  const storage = installBrowserStorage(t);
  const first = rewriteSnapshot(1);
  const completed: LocalReviewRunSnapshot = {
    ...rewriteSnapshot(2),
    stageStatus: { ...createInitialStageStatus(), rewrite_agent: "done" },
    stagePayloads: { ...first.stagePayloads, rewrite_agent: { rewrittenContent: "# 张三\n\n完整简历", explanation: "已精简表达" } },
  };
  await Promise.all([saveLocalReviewRun(first), saveLocalReviewRun(completed)]);
  storage.clear();
  const restored = await loadLocalReviewRun();
  assert.deepEqual(restored?.stagePayloads, completed.stagePayloads);
  assert.equal(restored?.stageStatus.rewrite_agent, "done");
});

test("refresh uses the recovery copy when IndexedDB contains an older snapshot", async (t) => {
  const storage = installBrowserStorage(t);
  await saveLocalReviewRun(rewriteSnapshot(1));
  const newest = rewriteSnapshot(2);
  for (const stage of ["hr_agent", "interviewer_agent", "career_master_agent"] as const) {
    newest.stageStatus[stage] = "done";
  }
  storage.setItem("resume-review-recovery-v1", JSON.stringify(newest));
  assert.deepEqual(await loadLocalReviewRun(), newest);
});

test("an aborted transaction retains a recoverable Markdown copy", async (t) => {
  installBrowserStorage(t);
  const originalPut = IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof originalPut>) {
    const request = originalPut.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  const snapshot = rewriteSnapshot();
  await saveLocalReviewRun(snapshot);
  assert.deepEqual(await loadLocalReviewRun(), snapshot);
});

test("storage failures are reported if neither browser store can save the rewrite", async (t) => {
  const storage = installBrowserStorage(t, false);
  t.mock.method(storage, "setItem", () => { throw new Error("QuotaExceededError"); });
  await assert.rejects(saveLocalReviewRun(rewriteSnapshot()), /无法保存本地断点/);
});

test("a successful write request is not treated as saved if its transaction later aborts", async (t) => {
  const storage = installBrowserStorage(t);
  t.mock.method(storage, "setItem", () => { throw new Error("QuotaExceededError"); });
  const originalPut = IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof originalPut>) {
    const request = originalPut.apply(this, args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  await assert.rejects(saveLocalReviewRun(rewriteSnapshot()));
  assert.equal(await loadLocalReviewRun(), null);
});
