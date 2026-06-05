"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  FilePenLine,
  GitBranch,
  LoaderCircle,
  LogOut,
  Play,
  Shield,
  Upload,
  User,
  X,
} from "lucide-react";

import {
  reviewStreamChunkSchema,
  type ReviewRunResult,
  type ReviewStageEvent,
  type ReviewStageProgressPhase,
} from "@/lib/review/schemas";
import {
  buildReviewResumeState,
  failRunningStages,
  hasReusableReviewState,
  interruptRunningStages,
  loadLocalReviewRun,
  saveLocalReviewRun,
  tryReconstructReviewRunResult,
  type LocalReviewRunSnapshot,
} from "@/lib/review/local-run-cache";
import {
  EMPTY_STAGE_LIVE_STATE,
  STAGE_META,
  STAGE_ORDER,
  createEmptyStageLiveState,
  formatPhaseLabel,
  formatWorkflowStatus,
  isRecord,
  isStageName,
  type StageLiveState,
  type StageLogEntry,
  type StageName,
  type StageStatus,
} from "@/components/review-studio-shared";
import { PdfAgentWorkbench } from "@/components/pdf-agent-workbench";

// Result panels (incl. html2pdf export + heavy lucide icons) are only needed
// once a stage-detail drawer is opened, so load them in a separate chunk.
const StageDetailDrawer = dynamic(() => import("@/components/review-stage-detail"), {
  ssr: false,
});

export type ReviewIdentity =
  | {
    kind: "user";
    user: {
      id: string;
      username: string;
      role: "ADMIN" | "MEMBER";
      status: "ACTIVE" | "BLOCKED";
    };
  }
  | {
    kind: "guest";
    guest: {
      id: string;
      status: "ACTIVE" | "BLOCKED";
      trialUsedCount: number;
      maxTrialCount: number;
      remainingTrialCount: number;
    };
  };

function createInitialStageStatus(): Record<StageName, StageStatus> {
  return {
    resume_loader: "pending",
    resume_parser: "pending",
    hr_agent: "pending",
    interviewer_agent: "pending",
    career_master_agent: "pending",
    summary_agent: "pending",
    rewrite_agent: "pending",
  };
}

function isStageReadyToRun(stage: StageName, stagePayloads: Partial<Record<StageName, unknown>>): boolean {
  if (stage === "resume_loader") {
    return true;
  }
  if (stage === "resume_parser") {
    return Boolean(stagePayloads.resume_loader);
  }
  const parallelReviewers: StageName[] = ["hr_agent", "interviewer_agent", "career_master_agent"];
  if (parallelReviewers.includes(stage)) {
    return Boolean(stagePayloads.resume_parser);
  }
  if (stage === "summary_agent") {
    return Boolean(
      stagePayloads.hr_agent &&
      stagePayloads.interviewer_agent &&
      stagePayloads.career_master_agent
    );
  }
  if (stage === "rewrite_agent") {
    return Boolean(stagePayloads.summary_agent);
  }
  return false;
}

function getStagesToReset(startStage: StageName): StageName[] {
  const parallelReviewers: StageName[] = ["hr_agent", "interviewer_agent", "career_master_agent"];

  if (startStage === "resume_loader") {
    return [...STAGE_ORDER];
  } else if (startStage === "resume_parser") {
    return STAGE_ORDER.slice(1) as unknown as StageName[];
  } else if (parallelReviewers.includes(startStage)) {
    return [startStage, "summary_agent", "rewrite_agent"];
  } else if (startStage === "summary_agent") {
    return ["summary_agent", "rewrite_agent"];
  } else if (startStage === "rewrite_agent") {
    return ["rewrite_agent"];
  }
  return [];
}

function createReviewRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-run-${Date.now()}`;
}

function getReviewOwnerKey(identity?: ReviewIdentity): string {
  if (identity?.kind === "user") {
    return `user:${identity.user.id}`;
  }
  if (identity?.kind === "guest") {
    return `guest:${identity.guest.id}`;
  }
  return "anonymous";
}

function firstActiveStage(stageStatus: Record<StageName, StageStatus>): StageName {
  return (
    STAGE_ORDER.find((stage) => ["running", "interrupted", "failed"].includes(stageStatus[stage])) ??
    STAGE_ORDER.find((stage) => stageStatus[stage] !== "done") ??
    "rewrite_agent"
  );
}

function applyStageProgressEvent(
  previous: Partial<Record<StageName, StageLiveState>>,
  stage: StageName,
  event: ReviewStageEvent,
) {
  const current = previous[stage] ?? createEmptyStageLiveState();
  const nextPhase = event.phase ?? current.phase;

  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const newLog: StageLogEntry = {
    timestamp,
    phase: nextPhase,
    message: event.message,
    type: "info",
  };

  const prevLogs = current.logs || [];
  let updatedLogs = [...prevLogs];
  const lastLog = prevLogs[prevLogs.length - 1];

  if (lastLog && lastLog.phase === newLog.phase && lastLog.message === newLog.message) {
    updatedLogs[updatedLogs.length - 1] = {
      ...lastLog,
      timestamp,
    };
  } else {
    updatedLogs.push(newLog);
  }

  return {
    ...previous,
    [stage]: {
      phase: nextPhase,
      latestMessage: event.message || current.latestMessage,
      details: event.details.length > 0 ? event.details : current.details,
      logs: updatedLogs.slice(-24),
    },
  };
}

function sanitizeStageLiveState(value: unknown): StageLiveState {
  if (!isRecord(value)) {
    return createEmptyStageLiveState();
  }

  const logs = Array.isArray(value.logs)
    ? value.logs
      .filter(isRecord)
      .map((log) => ({
        timestamp: typeof log.timestamp === "string" ? log.timestamp : "",
        phase: (typeof log.phase === "string" ? log.phase : null) as ReviewStageProgressPhase | null,
        message: typeof log.message === "string" ? log.message : "",
        type: (log.type === "success" || log.type === "error" ? log.type : "info") as StageLogEntry["type"],
      }))
      .filter((log) => log.message)
      .slice(-24)
    : [];

  return {
    phase: (typeof value.phase === "string" ? value.phase : null) as ReviewStageProgressPhase | null,
    latestMessage: typeof value.latestMessage === "string" ? value.latestMessage : "",
    details: Array.isArray(value.details) ? value.details.filter((item): item is string => typeof item === "string") : [],
    logs,
  };
}

function sanitizeStageStreams(
  streams: Partial<Record<StageName, unknown>>,
): Partial<Record<StageName, StageLiveState>> {
  return STAGE_ORDER.reduce<Partial<Record<StageName, StageLiveState>>>((nextStreams, stage) => {
    if (streams[stage]) {
      nextStreams[stage] = sanitizeStageLiveState(streams[stage]);
    }
    return nextStreams;
  }, {});
}

function parseChunkLine(line: string) {
  return reviewStreamChunkSchema.parse(JSON.parse(line));
}

const FlowRunnerPath = memo(function FlowRunnerPath({
  path,
  lineClass,
  duration = "2.4s",
  delay = "0s",
}: {
  path: string;
  lineClass: string;
  duration?: string;
  delay?: string;
}) {
  const runnerClass =
    lineClass === "flow-line-done"
      ? "flow-line-runner flow-line-runner-done"
      : lineClass === "flow-line-active"
        ? "flow-line-runner flow-line-runner-active"
        : lineClass === "flow-line-ready"
          ? "flow-line-runner flow-line-runner-ready"
          : "flow-line-runner";

  return (
    <path
      d={path}
      className={`${lineClass} ${runnerClass}`}
      fill="none"
      vectorEffect="non-scaling-stroke"
      style={{ animationDelay: delay, animationDuration: duration }}
    />
  );
});

const WorkflowDownArrow = memo(function WorkflowDownArrow({
  isDone,
  isRunning,
  isReady,
}: {
  isDone: boolean;
  isRunning: boolean;
  isReady: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, fromY: 278, toX: 100, toY: 160 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const loaderCard = parent.querySelector('.workflow-node-resume_loader');
      const parserCard = parent.querySelector('.workflow-node-resume_parser');
      const rect = parent.getBoundingClientRect();
      if (loaderCard && parserCard && rect.width > 0) {
        const lRect = loaderCard.getBoundingClientRect();
        const pRect = parserCard.getBoundingClientRect();
        setPorts({
          fromX: lRect.right - rect.left,
          fromY: (lRect.top + lRect.height / 2) - rect.top,
          toX: pRect.left - rect.left,
          toY: (pRect.top + pRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      const loader = flowParent.querySelector('.workflow-node-resume_loader');
      if (loader) ro.observe(loader);
      const parser = flowParent.querySelector('.workflow-node-resume_parser');
      if (parser) ro.observe(parser);
    }
    update();
    return () => ro.disconnect();
  }, []);

  const lineClass = isDone ? "flow-line-done" : isRunning ? "flow-line-active" : isReady ? "flow-line-ready" : "flow-line-idle";

  const fx = ports.fromX;
  const fy = ports.fromY;
  const tx = ports.toX;
  const ty = ports.toY;
  const cx = (fx + tx) / 2; // center X for vertical segment
  const r = 12;
  const path = Math.abs(fy - ty) < 4
    ? `M ${fx} ${fy} H ${tx}`
    : `M ${fx} ${fy} H ${cx - r} Q ${cx} ${fy} ${cx} ${fy > ty ? fy - r : fy + r} V ${fy > ty ? ty + r : ty - r} Q ${cx} ${ty} ${cx + r} ${ty} H ${tx}`;

  const arrowColor =
    isDone ? "var(--green)" : (isRunning || isReady) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  return (
    <div className="flowchart-arrow-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={path} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={path} className={lineClass} fill="none" />
        <FlowRunnerPath path={path} lineClass={lineClass} duration="1.45s" />
        <path
          d={`M ${tx - 6} ${ty - 5} L ${tx} ${ty} L ${tx - 6} ${ty + 5}`}
          stroke={arrowColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
});

const WorkflowVerticalArrow = memo(function WorkflowVerticalArrow({
  isDone,
  isRunning,
  isReady,
}: {
  isDone: boolean;
  isRunning: boolean;
  isReady: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ cx: 24, fromY: -8, toY: 58 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const flowParent = el.closest('.workflow-flowchart');
      const wrapper = el.parentElement;
      const fromSelector = wrapper?.classList.contains('workflow-vertical-arrow-right')
        ? '.workflow-node-summary_agent'
        : '.workflow-input-node';
      const toSelector = wrapper?.classList.contains('workflow-vertical-arrow-right')
        ? '.workflow-node-rewrite_agent'
        : '.workflow-node-resume_loader';
      const prev = flowParent?.querySelector(fromSelector);
      const next = flowParent?.querySelector(toSelector);
      const rect = flowParent?.getBoundingClientRect();
      if (prev && next && rect && rect.height > 0) {
        const prevRect = prev.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        setPorts({
          cx: (nextRect.left + nextRect.width / 2) - rect.left,
          fromY: prevRect.bottom - rect.top,
          toY: nextRect.top - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    const wrapper = el.parentElement;
    if (flowParent) {
      ro.observe(flowParent);
      const fromSelector = wrapper?.classList.contains('workflow-vertical-arrow-right')
        ? '.workflow-node-summary_agent'
        : '.workflow-input-node';
      const toSelector = wrapper?.classList.contains('workflow-vertical-arrow-right')
        ? '.workflow-node-rewrite_agent'
        : '.workflow-node-resume_loader';
      const prev = flowParent.querySelector(fromSelector);
      const next = flowParent.querySelector(toSelector);
      if (prev) ro.observe(prev);
      if (next) ro.observe(next);
    }
    update();
    return () => ro.disconnect();
  }, []);

  const lineClass = isDone ? "flow-line-done" : isRunning ? "flow-line-active" : isReady ? "flow-line-ready" : "flow-line-idle";
  const arrowColor = isDone ? "var(--green)" : (isRunning || isReady) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";
  const { cx, fromY, toY } = ports;
  const path = `M ${cx} ${fromY} V ${toY}`;

  return (
    <div className="flowchart-vertical-arrow-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <defs>
          <marker id="arrow-down-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-down-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-down-gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="rgba(0, 242, 254, 0.38)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
        </defs>
        <path d={path} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" />
        <path d={path} className={lineClass} markerEnd={isDone ? "url(#arrow-down-green)" : (isRunning || isReady) ? "url(#arrow-down-cyan)" : "url(#arrow-down-gray)"} />
        <FlowRunnerPath path={path} lineClass={lineClass} duration="1.45s" />
      </svg>
    </div>
  );
});


const WorkflowBranchConnector = memo(function WorkflowBranchConnector({
  isParserDone,
  hrStatus,
  interviewerStatus,
  careerStatus,
}: {
  isParserDone: boolean;
  hrStatus: StageStatus;
  interviewerStatus: StageStatus;
  careerStatus: StageStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, fromY: 160, toX: 100, topY: 42, midY: 160, bottomY: 278 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const parserCard = parent.querySelector('.workflow-node-resume_parser');
      const hrCard = parent.querySelector('.workflow-node-hr_agent');
      const interviewerCard = parent.querySelector('.workflow-node-interviewer_agent');
      const careerCard = parent.querySelector('.workflow-node-career_master_agent');
      const rect = parent.getBoundingClientRect();
      if (parserCard && hrCard && interviewerCard && careerCard && rect.width > 0) {
        const pRect = parserCard.getBoundingClientRect();
        const hRect = hrCard.getBoundingClientRect();
        const iRect = interviewerCard.getBoundingClientRect();
        const cRect = careerCard.getBoundingClientRect();
        setPorts({
          fromX: pRect.right - rect.left,
          fromY: (pRect.top + pRect.height / 2) - rect.top,
          toX: Math.min(hRect.left, iRect.left, cRect.left) - rect.left,
          topY: (hRect.top + hRect.height / 2) - rect.top,
          midY: (iRect.top + iRect.height / 2) - rect.top,
          bottomY: (cRect.top + cRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      for (const sel of ['.workflow-node-resume_parser', '.workflow-node-hr_agent', '.workflow-node-interviewer_agent', '.workflow-node-career_master_agent']) {
        const n = flowParent.querySelector(sel);
        if (n) ro.observe(n);
      }
    }
    update();
    return () => ro.disconnect();
  }, []);

  const readyClass = isParserDone ? "flow-line-ready" : "flow-line-idle";
  const getBranchClass = (status: StageStatus) =>
    status === "done" ? "flow-line-done" : status === "running" ? "flow-line-active" : readyClass;

  const leftClass = getBranchClass(hrStatus);
  const midClass = getBranchClass(interviewerStatus);
  const rightClass = getBranchClass(careerStatus);

  const allReviewersDone = hrStatus === "done" && interviewerStatus === "done" && careerStatus === "done";
  const anyReviewerRunning = hrStatus === "running" || interviewerStatus === "running" || careerStatus === "running";
  const trunkClass = allReviewersDone
    ? "flow-line-done"
    : anyReviewerRunning
      ? "flow-line-active"
      : isParserDone
        ? "flow-line-ready"
        : "flow-line-idle";

  const fx = ports.fromX;
  const fy = ports.fromY;
  const tx = ports.toX;
  const ty1 = ports.topY;
  const ty2 = ports.midY;
  const ty3 = ports.bottomY;
  const cx = (fx + tx) / 2;
  const r = 12;

  const buildBranchPath = (ty: number) => {
    if (Math.abs(ty - fy) < 8) {
      return `M ${cx - r} ${fy} H ${tx}`;
    }
    const sign = ty < fy ? -1 : 1;
    const startCornerY = fy + sign * r;
    const endCornerY = ty - sign * r;
    return `M ${cx - r} ${fy} Q ${cx} ${fy} ${cx} ${startCornerY} V ${endCornerY} Q ${cx} ${ty} ${cx + r} ${ty} H ${tx}`;
  };

  const pathTrunk = `M ${fx} ${fy} H ${cx - r}`;
  const pathTop = buildBranchPath(ty1);
  const pathMid = buildBranchPath(ty2);
  const pathBottom = buildBranchPath(ty3);

  const arrowColor = (status: StageStatus, ready: boolean) =>
    status === "done" ? "var(--green)" : (status === "running" || ready) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  const chevron = (y: number, color: string) => (
    <path d={`M ${tx - 6} ${y - 5} L ${tx} ${y} L ${tx - 6} ${y + 5}`} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );

  return (
    <div className="flowchart-branch-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={pathTrunk} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathTop} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathMid} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathBottom} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />

        <path d={pathTrunk} className={trunkClass} fill="none" />
        <path d={pathTop} className={leftClass} fill="none" />
        <path d={pathMid} className={midClass} fill="none" />
        <path d={pathBottom} className={rightClass} fill="none" />
        <FlowRunnerPath path={pathTrunk} lineClass={trunkClass} duration="1.75s" />
        <FlowRunnerPath path={pathTop} lineClass={leftClass} duration="2.15s" delay="-0.35s" />
        <FlowRunnerPath path={pathMid} lineClass={midClass} duration="1.65s" delay="-0.1s" />
        <FlowRunnerPath path={pathBottom} lineClass={rightClass} duration="2.15s" delay="-0.75s" />

        {chevron(ty1, arrowColor(hrStatus, isParserDone))}
        {chevron(ty2, arrowColor(interviewerStatus, isParserDone))}
        {chevron(ty3, arrowColor(careerStatus, isParserDone))}
      </svg>
    </div>
  );
});

const WorkflowMergeConnector = memo(function WorkflowMergeConnector({
  hrStatus,
  interviewerStatus,
  careerStatus,
  summaryStatus,
}: {
  hrStatus: StageStatus;
  interviewerStatus: StageStatus;
  careerStatus: StageStatus;
  summaryStatus: StageStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, topY: 42, midY: 160, bottomY: 278, toX: 100, toY: 42 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const hrCard = parent.querySelector('.workflow-node-hr_agent');
      const interviewerCard = parent.querySelector('.workflow-node-interviewer_agent');
      const careerCard = parent.querySelector('.workflow-node-career_master_agent');
      const summaryCard = parent.querySelector('.workflow-node-summary_agent');
      const rect = parent.getBoundingClientRect();
      if (hrCard && interviewerCard && careerCard && summaryCard && rect.width > 0) {
        const hRect = hrCard.getBoundingClientRect();
        const iRect = interviewerCard.getBoundingClientRect();
        const cRect = careerCard.getBoundingClientRect();
        const sRect = summaryCard.getBoundingClientRect();
        setPorts({
          fromX: Math.max(hRect.right, iRect.right, cRect.right) - rect.left,
          topY: (hRect.top + hRect.height / 2) - rect.top,
          midY: (iRect.top + iRect.height / 2) - rect.top,
          bottomY: (cRect.top + cRect.height / 2) - rect.top,
          toX: sRect.left - rect.left,
          toY: (sRect.top + sRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      for (const sel of ['.workflow-node-hr_agent', '.workflow-node-interviewer_agent', '.workflow-node-career_master_agent', '.workflow-node-summary_agent']) {
        const n = flowParent.querySelector(sel);
        if (n) ro.observe(n);
      }
    }
    update();
    return () => ro.disconnect();
  }, []);

  const allReviewersDone = hrStatus === "done" && interviewerStatus === "done" && careerStatus === "done";
  const readyToSummarize = allReviewersDone && summaryStatus === "pending";
  const pendingClass = readyToSummarize ? "flow-line-ready" : "flow-line-idle";
  const getMergeClass = (status: StageStatus) =>
    summaryStatus === "done"
      ? "flow-line-done"
      : summaryStatus === "running"
        ? "flow-line-active"
        : status === "done"
          ? "flow-line-done"
          : pendingClass;

  const leftClass = getMergeClass(hrStatus);
  const midClass = getMergeClass(interviewerStatus);
  const rightClass = getMergeClass(careerStatus);

  const trunkClass = summaryStatus === "done"
    ? "flow-line-done"
    : summaryStatus === "running"
      ? "flow-line-active"
      : allReviewersDone
        ? "flow-line-ready"
        : "flow-line-idle";

  const fx = ports.fromX;
  const tx = ports.toX;
  const ty1 = ports.topY;
  const ty2 = ports.midY;
  const ty3 = ports.bottomY;
  const toY = ports.toY;
  const cx = (fx + tx) / 2;
  const r = 12;

  const buildBranchPath = (ty: number) => {
    if (Math.abs(ty - toY) < 8) {
      return `M ${fx} ${ty} H ${cx + r}`;
    }
    const sign = ty > toY ? -1 : 1;
    const startCornerY = ty + sign * r;
    const endCornerY = toY - sign * r;
    return `M ${fx} ${ty} H ${cx - r} Q ${cx} ${ty} ${cx} ${startCornerY} V ${endCornerY} Q ${cx} ${toY} ${cx + r} ${toY}`;
  };

  const pathTop = buildBranchPath(ty1);
  const pathMid = buildBranchPath(ty2);
  const pathBottom = buildBranchPath(ty3);
  const pathTrunk = `M ${cx + r} ${toY} H ${tx}`;

  const arrowColor =
    summaryStatus === "done" ? "var(--green)" : (summaryStatus === "running" || allReviewersDone) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  return (
    <div className="flowchart-merge-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={pathTop} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathMid} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathBottom} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathTrunk} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />

        <path d={pathTop} className={leftClass} fill="none" />
        <path d={pathMid} className={midClass} fill="none" />
        <path d={pathBottom} className={rightClass} fill="none" />
        <path d={pathTrunk} className={trunkClass} fill="none" />
        <FlowRunnerPath path={pathTop} lineClass={leftClass} duration="2.15s" delay="-0.2s" />
        <FlowRunnerPath path={pathMid} lineClass={midClass} duration="1.65s" delay="-0.55s" />
        <FlowRunnerPath path={pathBottom} lineClass={rightClass} duration="2.15s" delay="-0.9s" />
        <FlowRunnerPath path={pathTrunk} lineClass={trunkClass} duration="1.75s" />

        <path
          d={`M ${tx - 6} ${toY - 5} L ${tx} ${toY} L ${tx - 6} ${toY + 5}`}
          stroke={arrowColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
});

const StageWorkflowCard = memo(function StageWorkflowCard({
  stage,
  index,
  isSelected,
  hasResult,
  status,
  liveState,
  onOpenStageDetails,
  onStartStage,
  onInterrupt,
  isRunningAny,
  isReady,
}: {
  stage: StageName;
  index: number;
  isSelected: boolean;
  hasResult: boolean;
  status: StageStatus;
  liveState: StageLiveState;
  onOpenStageDetails: (stage: StageName) => void;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
  isReady: boolean;
}) {
  const meta = STAGE_META[stage];
  const statusLabel = formatWorkflowStatus(status, liveState.phase);

  return (
    <div
      className={`workflow-node-card workflow-node-${stage} workflow-node-${status} ${isSelected ? "is-selected" : ""} ${hasResult ? "has-result" : ""}`}
      onClick={() => onOpenStageDetails(stage)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenStageDetails(stage);
        }
      }}
      aria-label={`打开 ${meta.label} 节点详情，当前状态：${statusLabel}`}
      aria-pressed={isSelected}
    >
      <span className="workflow-node-content">
        <span className="workflow-node-kicker">STEP 0{index + 1}</span>
        <strong>{meta.label}</strong>
        <span className="workflow-node-status-text">
          {liveState.latestMessage || meta.focus}
        </span>
      </span>
      <StageStatusIndicator
        stage={stage}
        status={status}
        label={statusLabel}
        onStartStage={onStartStage}
        onInterrupt={onInterrupt}
        isRunningAny={isRunningAny}
        isReady={isReady}
      />
    </div>
  );
});

function StageStatusIndicator({
  stage,
  status,
  label,
  onStartStage,
  onInterrupt,
  isRunningAny,
  isReady,
}: {
  stage: StageName;
  status: StageStatus;
  label: string;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
  isReady: boolean;
}) {
  if (status === "running") {
    return (
      <button
        className="workflow-node-status-indicator workflow-node-status-indicator-running interactive-status-btn"
        onClick={(e) => {
          e.stopPropagation();
          onInterrupt();
        }}
        aria-label="中断诊断"
        title="点击中断诊断"
        type="button"
      >
        <span className="indicator-running-container">
          <LoaderCircle className="spin-icon default-icon" size={15} aria-hidden="true" />
          <X className="stop-icon" size={15} aria-hidden="true" />
        </span>
      </button>
    );
  }

  // If the pipeline is not running and this stage is ready to be run, show Play icon on hover
  if (!isRunningAny && isReady) {
    const playTooltip = status === "pending" ? "启动该阶段诊断" : "重新启动该阶段诊断";
    return (
      <button
        className={`workflow-node-status-indicator workflow-node-status-indicator-${status} interactive-status-btn`}
        onClick={(e) => {
          e.stopPropagation();
          onStartStage(stage);
        }}
        aria-label={playTooltip}
        title={playTooltip}
        type="button"
      >
        <span className="indicator-play-container">
          <span className="default-icon flex items-center justify-center">
            {status === "done" && <CheckCircle2 size={15} aria-hidden="true" />}
            {(status === "interrupted" || status === "failed") && <AlertCircle size={15} aria-hidden="true" />}
            {status === "pending" && <span className="workflow-status-dot" aria-hidden="true" />}
          </span>
          <Play className="play-icon" size={11} fill="currentColor" aria-hidden="true" />
        </span>
      </button>
    );
  }

  if (status === "done") {
    return (
      <span
        className="workflow-node-status-indicator workflow-node-status-indicator-done"
        aria-label={label}
        title={label}
      >
        <CheckCircle2 size={15} aria-hidden="true" />
      </span>
    );
  }

  if (status === "interrupted" || status === "failed") {
    return (
      <span
        className={`workflow-node-status-indicator workflow-node-status-indicator-${status}`}
        aria-label={label}
        title={label}
      >
        <AlertCircle size={15} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className="workflow-node-status-indicator workflow-node-status-indicator-pending"
      aria-label={label}
      title={label}
    >
      <span className="workflow-status-dot" aria-hidden="true" />
    </span>
  );
}

function FutureAgentSkeleton() {
  return (
    <article className="workflow-node-card future-agent-card" aria-label="预留 Agent 节点">
      <span className="workflow-node-content">
        <span className="workflow-node-kicker">STEP 07</span>
        <strong>Future Agent</strong>
        <span className="workflow-node-status-text">预留扩展节点，等待接入下一位 Agent</span>
      </span>
      <span
        className="workflow-node-status-indicator workflow-node-status-indicator-future"
        aria-label="预留骨架"
        title="预留骨架"
      >
        <span className="workflow-status-dot" aria-hidden="true" />
      </span>
    </article>
  );
}

type WorkflowTimelineProps = {
  setupNode: ReactNode;
  isInputReady: boolean;
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
  onOpenStageDetails: (stage: StageName) => void;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
};

const WorkflowTimeline = memo(function WorkflowTimeline({
  setupNode,
  isInputReady,
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
  onOpenStageDetails,
  onStartStage,
  onInterrupt,
  isRunningAny,
}: WorkflowTimelineProps) {
  const getLiveState = (stage: StageName) => stageStreams[stage] ?? EMPTY_STAGE_LIVE_STATE;
  const getStatus = (stage: StageName) => stageStatus[stage];
  const hasResult = (stage: StageName) => Boolean(stagePayloads[stage]);
  const isReady = (stage: StageName) => isStageReadyToRun(stage, stagePayloads);

  return (
    <div className="workflow-flowchart" aria-label="Resume review workflow flowchart">
      {/* 1. Setup Node (Input Card) - Spans col 1-3 */}
      <div className="workflow-setup-container workflow-entry-column">
        {setupNode}
      </div>

      {/* Vertical arrow from Input to Loader */}
      <div className="workflow-vertical-arrow-left">
        <WorkflowVerticalArrow
          isDone={getStatus("resume_loader") === "done"}
          isRunning={getStatus("resume_loader") === "running"}
          isReady={isInputReady}
        />
      </div>

      {/* 2. Resume Loader (bottom row, col 1) */}
      <div className="workflow-loader-container">
        <StageWorkflowCard
          stage="resume_loader"
          index={1}
          isSelected={selectedStage === "resume_loader"}
          hasResult={hasResult("resume_loader")}
          status={getStatus("resume_loader")}
          liveState={getLiveState("resume_loader")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("resume_loader")}
        />
      </div>

      {/* Horizontal connector Loader -> Parser */}
      <div className="workflow-down-arrow-container">
        <WorkflowDownArrow
          isDone={getStatus("resume_parser") === "done"}
          isRunning={getStatus("resume_parser") === "running"}
          isReady={getStatus("resume_loader") === "done"}
        />
      </div>

      {/* 3. Resume Parser (bottom row, col 3) */}
      <div className="workflow-parser-container">
        <StageWorkflowCard
          stage="resume_parser"
          index={2}
          isSelected={selectedStage === "resume_parser"}
          hasResult={hasResult("resume_parser")}
          status={getStatus("resume_parser")}
          liveState={getLiveState("resume_parser")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("resume_parser")}
        />
      </div>

      {/* Branch Parser -> Parallel Reviewer Agent */}
      <div className="workflow-branch-container">
        <WorkflowBranchConnector
          isParserDone={getStatus("resume_parser") === "done"}
          hrStatus={getStatus("hr_agent")}
          interviewerStatus={getStatus("interviewer_agent")}
          careerStatus={getStatus("career_master_agent")}
        />
      </div>

      {/* 4. Three Parallel Reviewers */}
      <div className="workflow-reviewer-row">
        <StageWorkflowCard
          stage="hr_agent"
          index={3}
          isSelected={selectedStage === "hr_agent"}
          hasResult={hasResult("hr_agent")}
          status={getStatus("hr_agent")}
          liveState={getLiveState("hr_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("hr_agent")}
        />
        <StageWorkflowCard
          stage="interviewer_agent"
          index={4}
          isSelected={selectedStage === "interviewer_agent"}
          hasResult={hasResult("interviewer_agent")}
          status={getStatus("interviewer_agent")}
          liveState={getLiveState("interviewer_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("interviewer_agent")}
        />
        <StageWorkflowCard
          stage="career_master_agent"
          index={5}
          isSelected={selectedStage === "career_master_agent"}
          hasResult={hasResult("career_master_agent")}
          status={getStatus("career_master_agent")}
          liveState={getLiveState("career_master_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("career_master_agent")}
        />
      </div>

      {/* Merge Reviewer Agents -> Summary Agent */}
      <div className="workflow-merge-container">
        <WorkflowMergeConnector
          hrStatus={getStatus("hr_agent")}
          interviewerStatus={getStatus("interviewer_agent")}
          careerStatus={getStatus("career_master_agent")}
          summaryStatus={getStatus("summary_agent")}
        />
      </div>

      {/* 5. Summary Agent */}
      <div className="workflow-summary-container">
        <StageWorkflowCard
          stage="summary_agent"
          index={6}
          isSelected={selectedStage === "summary_agent"}
          hasResult={hasResult("summary_agent")}
          status={getStatus("summary_agent")}
          liveState={getLiveState("summary_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("summary_agent")}
        />
      </div>

      {/* Vertical arrow from Summary to Rewrite */}
      <div className="workflow-vertical-arrow-right">
        <WorkflowVerticalArrow
          isDone={getStatus("rewrite_agent") === "done"}
          isRunning={getStatus("rewrite_agent") === "running"}
          isReady={getStatus("summary_agent") === "done"}
        />
      </div>

      {/* 6. Resume Rewrite */}
      <div className="workflow-rewrite-container workflow-output-column">
        <StageWorkflowCard
          stage="rewrite_agent"
          index={7}
          isSelected={selectedStage === "rewrite_agent"}
          hasResult={hasResult("rewrite_agent")}
          status={getStatus("rewrite_agent")}
          liveState={getLiveState("rewrite_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("rewrite_agent")}
        />
      </div>
    </div>
  );
}, areWorkflowTimelinePropsEqual);

function areWorkflowTimelinePropsEqual(previous: WorkflowTimelineProps, next: WorkflowTimelineProps) {
  if (previous.setupNode !== next.setupNode || previous.isInputReady !== next.isInputReady) {
    return false;
  }
  if (previous.selectedStage !== next.selectedStage) {
    return false;
  }
  if (previous.onOpenStageDetails !== next.onOpenStageDetails) {
    return false;
  }
  if (previous.onStartStage !== next.onStartStage) {
    return false;
  }
  if (previous.onInterrupt !== next.onInterrupt) {
    return false;
  }
  if (previous.isRunningAny !== next.isRunningAny) {
    return false;
  }

  return STAGE_ORDER.every((stage) => {
    const previousStream = previous.stageStreams[stage];
    const nextStream = next.stageStreams[stage];

    return (
      previous.stageStatus[stage] === next.stageStatus[stage] &&
      Boolean(previous.stagePayloads[stage]) === Boolean(next.stagePayloads[stage]) &&
      (previousStream?.phase ?? null) === (nextStream?.phase ?? null) &&
      (previousStream?.latestMessage ?? "") === (nextStream?.latestMessage ?? "")
    );
  });
}

export function ReviewStudio({
  identity,
  onSessionChanged,
}: {
  identity?: ReviewIdentity;
  onSessionChanged?: () => void;
}) {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [cachedResumeFileName, setCachedResumeFileName] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [targetDescription, setTargetDescription] = useState("");
  const [targetRoleDraft, setTargetRoleDraft] = useState("");
  const [targetDescriptionDraft, setTargetDescriptionDraft] = useState("");
  const [isTargetJobOpen, setIsTargetJobOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [runningStages, setRunningStages] = useState<StageName[]>([]);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [stageStatus, setStageStatus] = useState<Record<StageName, StageStatus>>(createInitialStageStatus());
  const [stageStreams, setStageStreams] = useState<Partial<Record<StageName, StageLiveState>>>({});
  const [stagePayloads, setStagePayloads] = useState<Partial<Record<StageName, unknown>>>({});
  const [finalResult, setFinalResult] = useState<ReviewRunResult | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageName>("resume_loader");
  const [detailsStage, setDetailsStage] = useState<StageName | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<"workflow" | "agent">("workflow");
  const [isIdentityMenuOpen, setIsIdentityMenuOpen] = useState(false);
  const floatingMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        floatingMenuRef.current &&
        !floatingMenuRef.current.contains(event.target as Node)
      ) {
        setIsIdentityMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const phaseTimelineRef = useRef<Partial<Record<StageName, ReviewStageProgressPhase>>>({});
  const pendingProgressEventsRef = useRef<Array<{ stage: StageName; event: ReviewStageEvent }>>([]);
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const runningStagesRef = useRef<StageName[]>([]);
  const selectedStageRef = useRef<StageName>("resume_loader");
  const ownerKey = getReviewOwnerKey(identity);
  const isGuest = identity?.kind === "guest";
  const guestRemainingTrialCount = isGuest ? identity.guest.remainingTrialCount : 0;
  const isBlocked =
    identity?.kind === "user"
      ? identity.user.status !== "ACTIVE"
      : identity?.kind === "guest"
        ? identity.guest.status !== "ACTIVE"
        : true;
  const identityLabel =
    identity?.kind === "user"
      ? `${identity.user.username} · ${identity.user.role === "ADMIN" ? "管理员" : "正式成员"}`
      : identity?.kind === "guest"
        ? `游客试用 · 剩余 ${guestRemainingTrialCount} 次`
        : "未登录";
  const hasLocalCheckpoint = hasReusableReviewState(stagePayloads);
  const canResumeLocalRun = Boolean(currentRunId && hasLocalCheckpoint && !finalResult && !resumeFile);
  const canRunReview =
    !!identity &&
    !isBlocked &&
    (identity.kind === "user" || identity.guest.remainingTrialCount > 0 || canResumeLocalRun);
  const uploadLabel = resumeFile
    ? resumeFile.name
    : cachedResumeFileName
      ? `${cachedResumeFileName} (本地断点)`
      : "选择简历源文件";
  const primaryActionLabel = isRunning ? "评审进行中..." : canResumeLocalRun ? "继续评审" : "启动评审";
  const isInputReady = Boolean((resumeFile || cachedResumeFileName || canResumeLocalRun) && targetRole);

  useEffect(() => {
    runningStagesRef.current = runningStages;
  }, [runningStages]);

  useEffect(() => {
    selectedStageRef.current = selectedStage;
  }, [selectedStage]);

  useEffect(() => {
    let cancelled = false;

    void loadLocalReviewRun(ownerKey)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        if (!snapshot) {
          setCurrentRunId(null);
          setCachedResumeFileName("");
          setRunningStages([]);
          setStageStatus(createInitialStageStatus());
          setStageStreams({});
          setStagePayloads({});
          setFinalResult(null);
          setSelectedStage("resume_loader");
          return;
        }

        const restoredStatus = interruptRunningStages(
          snapshot.stageStatus as Record<StageName, StageStatus>,
        ) as Record<StageName, StageStatus>;

        setCurrentRunId(snapshot.runId);
        setCachedResumeFileName(snapshot.resumeFileName);
        setResumeFile(null);
        setTargetRole(snapshot.targetRole);
        setTargetDescription(snapshot.targetDescription);
        setTargetRoleDraft(snapshot.targetRole);
        setTargetDescriptionDraft(snapshot.targetDescription);
        setStageStatus(restoredStatus);
        setStagePayloads(snapshot.stagePayloads as Partial<Record<StageName, unknown>>);
        setStageStreams(sanitizeStageStreams(snapshot.stageStreams as Partial<Record<StageName, unknown>>));
        let finalResult = snapshot.finalResult;
        if (!finalResult && snapshot.stagePayloads.rewrite_agent) {
          finalResult = tryReconstructReviewRunResult({
            targetRole: snapshot.targetRole,
            targetDescription: snapshot.targetDescription,
            stagePayloads: snapshot.stagePayloads,
          });
        }

        setFinalResult(finalResult);
        setRunningStages([]);
        setIsRunning(false);
        setSelectedStage(firstActiveStage(restoredStatus));
        setDetailsStage(null);

        if (!finalResult && hasReusableReviewState(snapshot.stagePayloads)) {
          setErrorMessage("已恢复上次本地断点，可点击继续诊断。");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  useEffect(() => {
    if (!currentRunId) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      const snapshot: LocalReviewRunSnapshot = {
        ownerKey,
        runId: currentRunId,
        resumeFileName: resumeFile?.name || cachedResumeFileName || "cached-resume.txt",
        targetRole,
        targetDescription,
        stageStatus,
        stagePayloads,
        stageStreams: sanitizeStageStreams(stageStreams),
        finalResult,
        updatedAt: Date.now(),
      };

      void saveLocalReviewRun(snapshot).catch(() => undefined);
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    cachedResumeFileName,
    currentRunId,
    finalResult,
    ownerKey,
    resumeFile?.name,
    stagePayloads,
    stageStatus,
    stageStreams,
    targetDescription,
    targetRole,
  ]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onSessionChanged?.();
  }, [onSessionChanged]);

  const flushPendingProgressEvents = useCallback(() => {
    if (progressFlushTimerRef.current) {
      clearTimeout(progressFlushTimerRef.current);
      progressFlushTimerRef.current = null;
    }

    const pendingEvents = pendingProgressEventsRef.current;
    if (pendingEvents.length === 0) return;

    pendingProgressEventsRef.current = [];
    setStageStreams((previous) =>
      pendingEvents.reduce(
        (nextStreams, item) => applyStageProgressEvent(nextStreams, item.stage, item.event),
        previous,
      ),
    );
  }, []);

  const queueStageProgressEvent = useCallback(
    (stage: StageName, event: ReviewStageEvent) => {
      pendingProgressEventsRef.current.push({ stage, event });

      if (!progressFlushTimerRef.current) {
        progressFlushTimerRef.current = setTimeout(flushPendingProgressEvents, 100);
      }
    },
    [flushPendingProgressEvents],
  );

  const appendTerminalError = useCallback((message: string) => {
    const trimmedMessage = message.trim() || "诊断执行失败。";
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const targets = runningStagesRef.current.length > 0 ? runningStagesRef.current : [selectedStageRef.current];

    setStageStreams((previous) => {
      const nextStreams = { ...previous };
      targets.forEach((stage) => {
        const current = nextStreams[stage] ?? createEmptyStageLiveState();
        const errorLog: StageLogEntry = {
          timestamp,
          phase: current.phase,
          message: trimmedMessage,
          type: "error",
        };
        nextStreams[stage] = {
          ...current,
          latestMessage: trimmedMessage,
          logs: [
            ...(current.logs || []),
            errorLog,
          ].slice(-24),
        };
      });
      return nextStreams;
    });
  }, []);

  useEffect(
    () => () => {
      if (progressFlushTimerRef.current) {
        clearTimeout(progressFlushTimerRef.current);
      }
      requestAbortControllerRef.current?.abort();
    },
    [],
  );

  const handleOpenStageDetails = useCallback((stage: StageName) => {
    setSelectedStage(stage);
    setDetailsStage(stage);
  }, []);
  const handleCloseStageDetails = useCallback(() => {
    setDetailsStage(null);
  }, []);
  const handleToggleTargetJob = useCallback(() => {
    setTargetRoleDraft(targetRole);
    setTargetDescriptionDraft(targetDescription);
    setIsTargetJobOpen((previous) => !previous);
  }, [targetDescription, targetRole]);
  const handleSaveTargetJob = useCallback(() => {
    const nextRole = targetRoleDraft.trim();
    if (!nextRole) {
      setErrorMessage("请填写目标岗位名称后保存。");
      return;
    }

    setTargetRole(nextRole);
    setTargetDescription(targetDescriptionDraft.trim());
    setIsTargetJobOpen(false);
    setErrorMessage("");
  }, [targetDescriptionDraft, targetRoleDraft]);

  async function handleChunkStream(response: Response) {
    if (!response.body) {
      throw new Error("Streaming response is not available in this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedTerminalChunk = false;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let chunk: ReturnType<typeof parseChunkLine>;
        try {
          chunk = parseChunkLine(line);
        } catch {
          const errorMessage =
            line.startsWith("<!DOCTYPE") ||
            line.startsWith("<html") ||
            line.includes("Gateway Timeout") ||
            line.includes("Internal Server Error")
              ? "服务器网络超时或发生内部错误，诊断已被中断，请重试。"
              : `流式响应解析失败: ${line.slice(0, 100)}`;
          appendTerminalError(errorMessage);
          if (line.startsWith("<!DOCTYPE") || line.startsWith("<html") || line.includes("Gateway Timeout") || line.includes("Internal Server Error")) {
            setErrorMessage(errorMessage);
          } else {
            setErrorMessage(errorMessage);
          }
          setStageStatus((previous) => failRunningStages(previous) as Record<StageName, StageStatus>);
          setIsRunning(false);
          requestAbortControllerRef.current = null;
          continue;
        }
        if (chunk.type === "event") {
          handleStageEvent(chunk.event);
          continue;
        }
        if (chunk.type === "result") {
          receivedTerminalChunk = true;
          flushPendingProgressEvents();
          setFinalResult(chunk.result);
          setSelectedStage("rewrite_agent");
          setIsRunning(false);
          requestAbortControllerRef.current = null;
          onSessionChanged?.();
          continue;
        }
        receivedTerminalChunk = true;
        flushPendingProgressEvents();
        appendTerminalError(chunk.message);
        setStageStatus((previous) => failRunningStages(previous) as Record<StageName, StageStatus>);
        setErrorMessage(chunk.message);
        setIsRunning(false);
        requestAbortControllerRef.current = null;
        onSessionChanged?.();
      }

      if (done) {
        break;
      }
    }

    if (!receivedTerminalChunk) {
      throw new Error("诊断连接已提前关闭，可能是云端执行时间超过限制。请点击继续诊断重试。");
    }
  }

  function handleStageEvent(event: ReviewStageEvent) {
    const stage = isStageName(event.stage) ? event.stage : null;

    if (event.kind === "stage_progress" && stage) {
      queueStageProgressEvent(stage, event);

      if (event.phase && phaseTimelineRef.current[stage] !== event.phase) {
        phaseTimelineRef.current[stage] = event.phase;
        setTimeline((previous) => [...previous, `${STAGE_META[stage].label}: ${formatPhaseLabel(event.phase)} - ${event.message}`].slice(-20));
      }
      return;
    }

    setTimeline((previous) => [...previous, `${event.title}: ${event.message}`].slice(-20));

    if (event.kind === "stage_started" && stage) {
      flushPendingProgressEvents();
      setRunningStages((previous) =>
        previous.includes(stage) ? previous : [...previous, stage],
      );
      setStageStatus((previous) => ({
        ...previous,
        [stage]: "running",
      }));

      const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      const initialLogs: StageLogEntry[] = [
        {
          timestamp,
          phase: null,
          message: event.message,
          type: "info"
        }
      ];
      if (event.details && event.details.length > 0) {
        event.details.forEach((detail) => {
          initialLogs.push({
            timestamp,
            phase: null,
            message: `[数据载入] ${detail}`,
            type: "info"
          });
        });
      }

      setStageStreams((previous) => ({
        ...previous,
        [stage]: {
          ...(previous[stage] ?? createEmptyStageLiveState()),
          latestMessage: event.message,
          details: event.details,
          phase: null,
          logs: initialLogs
        },
      }));
      setSelectedStage(stage);
      return;
    }

    if (event.kind === "stage_completed" && stage) {
      flushPendingProgressEvents();
      setRunningStages((previous) => previous.filter((runningStage) => runningStage !== stage));
      setStageStatus((previous) => ({
        ...previous,
        [stage]: "done",
      }));

      const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      setStageStreams((previous) => {
        const current = previous[stage] ?? createEmptyStageLiveState();
        return {
          ...previous,
          [stage]: {
            ...current,
            latestMessage: event.message,
            details: event.details,
            phase: null,
            logs: [
              ...(current.logs || []),
              {
                timestamp,
                phase: null,
                message: event.message,
                type: "success"
              }
            ]
          },
        };
      });

      if (event.payload) {
        setStagePayloads((previous) => ({
          ...previous,
          [stage]: event.payload,
        }));
        setSelectedStage(stage);
      }
      return;
    }

    if (event.kind === "pipeline_completed") {
      flushPendingProgressEvents();
      setRunningStages([]);
      setIsRunning(false);
      requestAbortControllerRef.current = null;
    }
  }

  const handleInterruptReview = useCallback(() => {
    requestAbortControllerRef.current?.abort();
    requestAbortControllerRef.current = null;
    flushPendingProgressEvents();
    setRunningStages([]);
    setStageStatus((previous) => interruptRunningStages(previous) as Record<StageName, StageStatus>);
    setIsRunning(false);
    setErrorMessage("已中断诊断，可点击继续诊断从本地断点重试。");
  }, [flushPendingProgressEvents]);

  const executeReview = useCallback(async (opts: {
    payloads: Partial<Record<StageName, unknown>>;
    status: Record<StageName, StageStatus>;
    finalResult: ReviewRunResult | null;
    startStage: StageName;
  }) => {
    const abortController = new AbortController();
    requestAbortControllerRef.current = abortController;

    const isResumingLocalRun = Boolean(opts.payloads.resume_loader);
    const nextRunId = isResumingLocalRun && currentRunId ? currentRunId : createReviewRunId();

    setErrorMessage("");
    setIsRunning(true);
    setRunningStages([]);
    setCurrentRunId(nextRunId);

    if (resumeFile) {
      setCachedResumeFileName(resumeFile.name);
    }

    phaseTimelineRef.current = {};
    pendingProgressEventsRef.current = [];
    if (progressFlushTimerRef.current) {
      clearTimeout(progressFlushTimerRef.current);
      progressFlushTimerRef.current = null;
    }

    const formData = new FormData();
    if (resumeFile && !isResumingLocalRun) {
      formData.append("resumeFile", resumeFile);
    }
    formData.append("targetRole", targetRole.trim());
    formData.append("targetDescription", targetDescription.trim());
    if (isResumingLocalRun) {
      formData.append("resumeState", JSON.stringify(buildReviewResumeState({ stagePayloads: opts.payloads, finalResult: opts.finalResult })));
    }

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });
      if (!response.ok) {
        let errorMsg = `诊断请求失败 (${response.status})`;
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errData = await response.json();
            if (errData && typeof errData.message === "string") {
              errorMsg = errData.message;
            }
          } else {
            const text = await response.text();
            if (text && text.length < 200) {
              errorMsg = text;
            }
          }
        } catch {}
        throw new Error(errorMsg);
      }
      await handleChunkStream(response);
    } catch (error) {
      flushPendingProgressEvents();
      const wasAborted =
        abortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      const errorMessage = wasAborted
        ? "已中断诊断，可点击继续诊断从本地断点重试。"
        : error instanceof Error
          ? error.message
          : "Review request failed.";
      appendTerminalError(errorMessage);
      setStageStatus((previous) =>
        (wasAborted ? interruptRunningStages(previous) : failRunningStages(previous)) as Record<StageName, StageStatus>,
      );
      setRunningStages([]);
      setErrorMessage(errorMessage);
      setIsRunning(false);
      requestAbortControllerRef.current = null;
    }
  }, [
    currentRunId,
    resumeFile,
    targetRole,
    targetDescription,
    handleChunkStream,
    flushPendingProgressEvents,
    appendTerminalError
  ]);

  const handleStartStage = useCallback(async (stage: StageName) => {
    if (isRunning) return;

    if (!canRunReview) {
      setErrorMessage(isGuest ? "游客试用次数已用完，请登录正式账号。" : "当前身份无权启动诊断。");
      return;
    }
    if (!targetRole.trim()) {
      setErrorMessage("请先配置目标岗位。");
      setTargetRoleDraft(targetRole);
      setTargetDescriptionDraft(targetDescription);
      setIsTargetJobOpen(true);
      return;
    }

    const resetStages = getStagesToReset(stage);
    const nextPayloads = { ...stagePayloads };
    const nextStatus = { ...stageStatus };
    const nextStreams = { ...stageStreams };

    resetStages.forEach((s) => {
      delete nextPayloads[s];
      nextStatus[s] = "pending";
      delete nextStreams[s];
    });

    let nextFinalResult = finalResult;
    if (resetStages.includes("summary_agent") || resetStages.includes("rewrite_agent")) {
      nextFinalResult = null;
    }

    setStagePayloads(nextPayloads);
    setStageStatus(nextStatus);
    setStageStreams(nextStreams);
    setFinalResult(nextFinalResult);
    setSelectedStage(stage);
    setDetailsStage(null);

    await executeReview({
      payloads: nextPayloads,
      status: nextStatus,
      finalResult: nextFinalResult,
      startStage: stage,
    });
  }, [
    canRunReview,
    targetRole,
    targetDescription,
    stagePayloads,
    stageStatus,
    stageStreams,
    finalResult,
    isRunning,
    isGuest,
    executeReview
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canRunReview) {
      setErrorMessage(isGuest ? "游客试用次数已用完，请登录正式账号。" : "当前身份无权启动诊断。");
      return;
    }
    const isResumingLocalRun = !resumeFile && hasLocalCheckpoint;

    if (!resumeFile && !isResumingLocalRun) {
      setErrorMessage("请先上传简历文件。");
      return;
    }
    if (!targetRole.trim()) {
      setErrorMessage("请先配置目标岗位。");
      setTargetRoleDraft(targetRole);
      setTargetDescriptionDraft(targetDescription);
      setIsTargetJobOpen(true);
      return;
    }

    let startStage: StageName = "resume_loader";
    let nextPayloads = { ...stagePayloads };
    let nextStatus = { ...stageStatus };
    let nextFinalResult = finalResult;

    if (isResumingLocalRun) {
      startStage = firstActiveStage(stageStatus);
      nextStatus = interruptRunningStages(stageStatus) as Record<StageName, StageStatus>;
      setSelectedStage(startStage);
    } else {
      nextPayloads = {};
      nextStatus = createInitialStageStatus();
      nextFinalResult = null;
      setTimeline([]);
      setStageStreams({});
      setStagePayloads({});
      setFinalResult(null);
      setStageStatus(nextStatus);
      setSelectedStage("resume_loader");
    }
    setDetailsStage(null);

    await executeReview({
      payloads: nextPayloads,
      status: nextStatus,
      finalResult: nextFinalResult,
      startStage,
    });
  }

  const workflowSetupNode = (
    <div className="workflow-canvas-controls flowchart-step-row full-width-row">
      <div
        className={`workflow-setup-panel workflow-node-card workflow-input-node ${
          isInputReady ? "workflow-node-done" : "is-selected"
        }`}
      >
        <div className="workflow-setup-header">
          <span className="workflow-node-content">
            <span className="workflow-node-kicker">STEP 01</span>
            <strong>Input</strong>
            <span className="workflow-node-status-text">
              {isInputReady ? "简历与目标岗位已就绪" : "上传简历并配置目标岗位"}
            </span>
          </span>

          <form className="workflow-start-panel" onSubmit={handleSubmit}>
            <button
              className="workflow-start-action"
              type="submit"
              disabled={isRunning || !canRunReview}
              aria-label={primaryActionLabel}
              title={primaryActionLabel}
            >
              {isRunning ? <LoaderCircle className="spin-icon" size={16} /> : <Play size={14} />}
              <span>{primaryActionLabel}</span>
            </button>
          </form>
        </div>

        <div className="workflow-setup-form">
          <label className="compact-upload" title={uploadLabel}>
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={(event) => {
                const nextFile = event.currentTarget.files?.[0] ?? null;
                setResumeFile(nextFile);
                if (nextFile) {
                  setCachedResumeFileName(nextFile.name);
                  setCurrentRunId(null);
                  setErrorMessage("");
                }
              }}
            />
            <Upload size={17} />
            <span>{uploadLabel}</span>
            {Boolean(resumeFile || cachedResumeFileName) && (
              <span className="target-job-icon-badge" title="已上传">
                <CheckCircle2 size={10} />
              </span>
            )}
          </label>

          <div className={`target-job-config ${isTargetJobOpen ? "is-open" : ""}`}>
            <button
              className={`target-job-trigger ${targetRole ? "is-configured" : ""}`}
              type="button"
              onClick={handleToggleTargetJob}
              disabled={isRunning}
              aria-expanded={isTargetJobOpen}
              aria-haspopup="dialog"
              title={targetRole ? "目标岗位: 已配置" : "目标岗位: 未配置"}
            >
              <BriefcaseBusiness size={16} />
              <span className="target-job-label">{targetRole || "目标岗位"}</span>
              {targetRole ? (
                <span className="target-job-icon-badge" title="已配置">
                  <CheckCircle2 size={10} />
                </span>
              ) : null}
            </button>

            {isTargetJobOpen ? (
              <div className="target-job-popover" role="dialog" aria-label="目标岗位配置">
                <label className="target-job-popover-field">
                  <span>岗位名称</span>
                  <input
                    type="text"
                    value={targetRoleDraft}
                    onChange={(event) => setTargetRoleDraft(event.currentTarget.value)}
                    placeholder="例如：AI Agent 平台工程师"
                    disabled={isRunning}
                  />
                </label>
                <label className="target-job-popover-field">
                  <span>岗位描述（选填）</span>
                  <textarea
                    value={targetDescriptionDraft}
                    onChange={(event) => setTargetDescriptionDraft(event.currentTarget.value)}
                    placeholder="可以从招聘平台复制 JD，留空则由 Agent 根据岗位名称自行判断。"
                    disabled={isRunning}
                    rows={4}
                  />
                </label>
                <div className="target-job-popover-actions">
                  <button type="button" className="secondary-action" onClick={() => setIsTargetJobOpen(false)}>
                    取消
                  </button>
                  <button type="button" className="target-job-save" onClick={handleSaveTargetJob}>
                    保存配置
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="app-shell review-console-shell animate-fade-in">
      <header className="compact-topbar">
        <div className="topbar-brand">
          <span className="eyebrow">RESUME DIAGNOSTIC CORE</span>
          <h1>Mutil-Agent Resume Reviewer</h1>
        </div>

        <nav className="workspace-nav" aria-label="工作台导航">
          <button
            className={`workspace-nav-button ${activeWorkspace === "workflow" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveWorkspace("workflow")}
          >
            <GitBranch size={15} />
            <span>Workflow</span>
          </button>
          <button
            className={`workspace-nav-button ${activeWorkspace === "agent" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveWorkspace("agent")}
          >
            <FilePenLine size={15} />
            <span>Agent Chat</span>
          </button>
        </nav>

        {activeWorkspace === "agent" ? (
          <div className="agent-topbar-context">
            <FilePenLine size={15} />
            PDF 实时预览与对话修改
          </div>
        ) : null}

        <div className="topbar-identity-menu" ref={floatingMenuRef}>
          <button
            className={`topbar-identity-trigger ${isIdentityMenuOpen ? "is-open" : ""}`}
            type="button"
            onClick={() => setIsIdentityMenuOpen((prev) => !prev)}
            aria-label="打开身份设置"
            aria-expanded={isIdentityMenuOpen}
          >
            {identity?.kind === "user" && identity.user.role === "ADMIN" ? <Shield size={16} /> : <User size={16} />}
            <span>{identityLabel}</span>
            <ChevronDown size={14} />
          </button>

          {isIdentityMenuOpen ? (
            <div className="topbar-identity-panel">
              <div className="topbar-identity-summary">
                <div className={`topbar-identity-avatar ${identity?.kind === "user" && identity.user.role === "ADMIN" ? "is-admin" : ""}`}>
                  {identity?.kind === "user" ? identity.user.username.slice(0, 2).toUpperCase() : "G"}
                </div>
                <div>
                  <strong>{identity?.kind === "user" ? identity.user.username : "临时游客"}</strong>
                  <span>
                    {identity?.kind === "user" ? (identity.user.role === "ADMIN" ? "系统管理员" : "正式账户") : `游客体验 (剩余 ${guestRemainingTrialCount} 次)`}
                  </span>
                </div>
              </div>

              {identity?.kind === "user" && identity.user.role === "ADMIN" ? (
                <a className="topbar-identity-action admin-link" href="/admin">
                  <Shield size={14} />
                  管理面板
                </a>
              ) : null}
              {identity?.kind === "user" ? (
                <button className="topbar-identity-action logout-link" type="button" onClick={() => { handleLogout(); setIsIdentityMenuOpen(false); }}>
                  <LogOut size={14} />
                  退出登录
                </button>
              ) : (
                <button className="topbar-identity-action admin-link" type="button" onClick={() => { handleLogout(); setIsIdentityMenuOpen(false); }}>
                  <LogOut size={14} style={{ transform: "rotate(180deg)" }} />
                  登录正式账号
                </button>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {activeWorkspace === "workflow" && errorMessage ? (
        <div className="top-error-banner" role="alert">
          <AlertCircle size={17} />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {activeWorkspace === "workflow" ? (
        <section className="review-workspace">
          <aside className="workflow-pane">
            <WorkflowTimeline
              setupNode={workflowSetupNode}
              isInputReady={isInputReady}
              selectedStage={selectedStage}
              stagePayloads={stagePayloads}
              stageStatus={stageStatus}
              stageStreams={stageStreams}
              onOpenStageDetails={handleOpenStageDetails}
              onStartStage={handleStartStage}
              onInterrupt={handleInterruptReview}
              isRunningAny={isRunning}
            />
          </aside>

          {detailsStage ? (
            <StageDetailDrawer
              finalResult={finalResult}
              selectedStage={detailsStage}
              stagePayloads={stagePayloads}
              stageStatus={stageStatus}
              stageStreams={stageStreams}
              onClose={handleCloseStageDetails}
            />
          ) : null}
        </section>
      ) : (
        <PdfAgentWorkbench />
      )}
    </main>
  );
}
