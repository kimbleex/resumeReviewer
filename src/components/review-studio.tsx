"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
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
  const lineClass = isDone ? "flow-line-done" : isRunning ? "flow-line-active" : isReady ? "flow-line-ready" : "flow-line-idle";
  const marker = isDone ? "url(#arrow-green)" : isRunning || isReady ? "url(#arrow-cyan)" : "url(#arrow-gray)";
  const path = "M 10 24 H 62";

  return (
    <div className="flowchart-arrow-container">
      <svg width="76" height="48" viewBox="0 0 76 48" fill="none">
        <defs>
          <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrow-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="rgba(0, 242, 254, 0.38)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
        </defs>

        {/* Faint static pipeline background path */}
        <path d={path} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />

        {/* Active glowing dynamic flow overlay */}
        <path
          d={path}
          className={lineClass}
          vectorEffect="non-scaling-stroke"
          markerEnd={marker}
        />
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
  const [dims, setDims] = useState({ w: 90, h: 450 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const readyClass = isParserDone ? "flow-line-ready" : "flow-line-idle";
  const getBranchClass = (status: StageStatus) =>
    status === "done" ? "flow-line-done" : status === "running" ? "flow-line-active" : readyClass;

  const leftClass = getBranchClass(hrStatus);
  const midClass = getBranchClass(interviewerStatus);
  const rightClass = getBranchClass(careerStatus);

  const leftPath = "M -14 160 H 48 Q 60 160 60 148 V 54 Q 60 42 72 42 H 134";
  const midPath = "M -14 160 H 134";
  const rightPath = "M -14 160 H 48 Q 60 160 60 172 V 266 Q 60 278 72 278 H 134";

  const arrowColor = (status: StageStatus, ready: boolean) =>
    status === "done" ? "var(--green)" : (status === "running" || ready) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  // Inverse scale factors: cancel the non-uniform SVG transform so chevron renders undistorted.
  // The SVG maps viewBox(120×320) → pixels(dims.w × dims.h).
  // Applying scale(120/w, 320/h) inside the group undoes that, making 1 unit = 1px.
  const isx = 120 / dims.w;
  const isy = 320 / dims.h;
  // Chevron shape in PIXELS (same visual size as WorkflowDownArrow marker)
  const dx = 5; // px wide
  const dy = 5; // px tall half-height
  // Arrowhead group: translate to endpoint, undo scale, draw chevron
  const arrowGroup = (cx: number, cy: number, color: string) => (
    <g transform={`translate(${cx},${cy}) scale(${isx},${isy})`}>
      <path
        d={`M ${-dx} ${-dy} L ${dx * 0.3} 0 L ${-dx} ${dy}`}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </g>
  );

  return (
    <div className="flowchart-branch-container" style={{ position: "relative" }} ref={containerRef}>
      <svg width="100%" height="100%" viewBox="0 0 120 320" preserveAspectRatio="none" fill="none">
        <defs>
          <filter id="glow-cyan-b" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-green-b" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint static pipeline background paths */}
        <path d={leftPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />

        {/* Active glowing dynamic flow overlays */}
        <path d={leftPath} className={leftClass} fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} className={midClass} fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} className={rightClass} fill="none" vectorEffect="non-scaling-stroke" />
        <FlowRunnerPath path={leftPath} lineClass={leftClass} duration="2.15s" delay="-0.35s" />
        <FlowRunnerPath path={midPath} lineClass={midClass} duration="1.65s" delay="-0.1s" />
        <FlowRunnerPath path={rightPath} lineClass={rightClass} duration="2.15s" delay="-0.75s" />

        {/* Undistorted arrowheads via inverse-scale transform */}
        {arrowGroup(134, 42, arrowColor(hrStatus, isParserDone))}
        {arrowGroup(134, 160, arrowColor(interviewerStatus, isParserDone))}
        {arrowGroup(134, 278, arrowColor(careerStatus, isParserDone))}
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
  const [dims, setDims] = useState({ w: 90, h: 450 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
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

  const leftPath = "M -14 42 H 48 Q 60 42 60 54 V 148 Q 60 160 72 160 H 134";
  const midPath = "M -14 160 H 134";
  const rightPath = "M -14 278 H 48 Q 60 278 60 266 V 172 Q 60 160 72 160 H 134";

  const arrowColor =
    summaryStatus === "done" ? "var(--green)" : (summaryStatus === "running" || allReviewersDone) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  const isx = 120 / dims.w;
  const isy = 320 / dims.h;
  const dx = 5;
  const dy = 5;

  return (
    <div className="flowchart-merge-container" style={{ position: "relative" }} ref={containerRef}>
      <svg width="100%" height="100%" viewBox="0 0 120 320" preserveAspectRatio="none" fill="none">
        <defs>
          <filter id="glow-cyan-m" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-green-m" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint static pipeline background paths */}
        <path d={leftPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />

        {/* Active glowing dynamic flow overlays */}
        <path d={leftPath} className={leftClass} fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} className={midClass} fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} className={rightClass} fill="none" vectorEffect="non-scaling-stroke" />
        <FlowRunnerPath path={leftPath} lineClass={leftClass} duration="2.15s" delay="-0.2s" />
        <FlowRunnerPath path={midPath} lineClass={midClass} duration="1.65s" delay="-0.55s" />
        <FlowRunnerPath path={rightPath} lineClass={rightClass} duration="2.15s" delay="-0.9s" />

        {/* Undistorted arrowhead via inverse-scale transform */}
        <g transform={`translate(134,160) scale(${isx},${isy})`}>
          <path
            d={`M ${-dx} ${-dy} L ${dx * 0.3} 0 L ${-dx} ${dy}`}
            stroke={arrowColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
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
      className={`workflow-node-card workflow-node-${status} ${isSelected ? "is-selected" : ""} ${hasResult ? "has-result" : ""}`}
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
      {/* 1. Resume Loader */}
      <div className="flowchart-step-row full-width-row">
        <StageWorkflowCard
          stage="resume_loader"
          index={0}
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

      {/* Down arrow loader -> parser */}
      <WorkflowDownArrow
        isDone={getStatus("resume_parser") === "done"}
        isRunning={getStatus("resume_parser") === "running"}
        isReady={getStatus("resume_loader") === "done"}
      />

      {/* 2. Resume Parser */}
      <div className="flowchart-step-row full-width-row">
        <StageWorkflowCard
          stage="resume_parser"
          index={1}
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
      <WorkflowBranchConnector
        isParserDone={getStatus("resume_parser") === "done"}
        hrStatus={getStatus("hr_agent")}
        interviewerStatus={getStatus("interviewer_agent")}
        careerStatus={getStatus("career_master_agent")}
      />

      {/* 3. Three Parallel Evaluator Agents */}
      <div className="workflow-reviewer-row">
        <StageWorkflowCard
          stage="hr_agent"
          index={2}
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
          index={3}
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
          index={4}
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
      <WorkflowMergeConnector
        hrStatus={getStatus("hr_agent")}
        interviewerStatus={getStatus("interviewer_agent")}
        careerStatus={getStatus("career_master_agent")}
        summaryStatus={getStatus("summary_agent")}
      />

      {/* 4. Summary Agent */}
      <div className="flowchart-step-row full-width-row">
        <StageWorkflowCard
          stage="summary_agent"
          index={5}
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

      <WorkflowDownArrow
        isDone={getStatus("rewrite_agent") === "done"}
        isRunning={getStatus("rewrite_agent") === "running"}
        isReady={getStatus("summary_agent") === "done"}
      />

      <div className="flowchart-step-row full-width-row">
        <StageWorkflowCard
          stage="rewrite_agent"
          index={6}
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
  const primaryActionLabel = isRunning ? "专家团诊断中..." : canResumeLocalRun ? "继续诊断" : "启动简历诊断";

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

  return (
    <main className="app-shell review-console-shell animate-fade-in">
      <header className="compact-topbar">
        <div className="topbar-brand">
          <span className="eyebrow">RESUME DIAGNOSTIC CORE</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>Mutil-Agent Resume Reviewer</h1>
            {identity && (
              <span className={`identity-badge identity-badge-${identity.kind === "user" ? (identity.user.role === "ADMIN" ? "admin" : "member") : "guest"}`}>
                {identity.kind === "user" ? (identity.user.role === "ADMIN" ? "管理员" : "正式成员") : `游客试用 (余 ${guestRemainingTrialCount} 次)`}
              </span>
            )}
          </div>
        </div>

        <form className="topbar-actions" onSubmit={handleSubmit}>
          <label className="compact-upload">
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
          </label>

          <div className={`target-job-config ${isTargetJobOpen ? "is-open" : ""}`}>
            <button
              className={`target-job-trigger ${targetRole ? "is-configured" : ""}`}
              type="button"
              onClick={handleToggleTargetJob}
              disabled={isRunning}
              aria-expanded={isTargetJobOpen}
              aria-haspopup="dialog"
            >
              <BriefcaseBusiness size={16} />
              <span className="target-job-trigger-copy">
                <strong>目标岗位</strong>
                <span>{targetRole || "点击配置岗位名称/描述"}</span>
              </span>
              <span className={`target-job-state ${targetRole ? "is-configured" : "is-empty"}`}>
                {targetRole ? (
                  <>
                    <CheckCircle2 size={13} />
                    已配置
                  </>
                ) : (
                  "未配置"
                )}
              </span>
              <ChevronDown size={15} />
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

          <button className="primary-action" type="submit" disabled={isRunning || !canRunReview}>
            {isRunning ? <LoaderCircle className="spin-icon" size={17} /> : <Play size={17} />}
            {primaryActionLabel}
          </button>
        </form>
      </header>

      {errorMessage ? (
        <div className="top-error-banner" role="alert">
          <AlertCircle size={17} />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <section className="review-workspace">
        <aside className="workflow-pane">
          <WorkflowTimeline
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

      {/* Floating Identity Hub */}
      <div className="floating-identity-container" ref={floatingMenuRef}>
        <button
          className={`floating-identity-trigger ${isIdentityMenuOpen ? "is-open" : ""}`}
          type="button"
          onClick={() => setIsIdentityMenuOpen((prev) => !prev)}
          aria-label="打开身份设置"
        >
          {identity?.kind === "user" && identity.user.role === "ADMIN" ? <Shield size={20} /> : <User size={20} />}
        </button>

        {isIdentityMenuOpen ? (
          <div className="floating-identity-panel">
            <div className="floating-identity-userinfo">
              <div className={`floating-identity-avatar ${identity?.kind === "user" && identity.user.role === "ADMIN" ? "floating-identity-avatar-admin" : ""}`}>
                {identity?.kind === "user" ? identity.user.username.slice(0, 2).toUpperCase() : "G"}
              </div>
              <div className="floating-identity-text">
                <span className="floating-identity-name">
                  {identity?.kind === "user" ? identity.user.username : "临时游客"}
                </span>
                <span className="floating-identity-role">
                  {identity?.kind === "user" ? (identity.user.role === "ADMIN" ? "系统管理员" : "正式账户") : `游客体验 (剩余 ${guestRemainingTrialCount} 次)`}
                </span>
              </div>
            </div>

            <div className="floating-identity-actions">
              {identity?.kind === "user" && identity.user.role === "ADMIN" ? (
                <a className="floating-identity-action-btn admin-link" href="/admin">
                  <Shield size={14} />
                  管理面板
                </a>
              ) : null}
              {identity?.kind === "user" ? (
                <button className="floating-identity-action-btn logout-btn" type="button" onClick={() => { handleLogout(); setIsIdentityMenuOpen(false); }}>
                  <LogOut size={14} />
                  退出登录
                </button>
              ) : (
                <button className="floating-identity-action-btn admin-link" type="button" onClick={() => { handleLogout(); setIsIdentityMenuOpen(false); }} style={{ fontSize: "0.78rem" }}>
                  <LogOut size={14} style={{ transform: "rotate(180deg)" }} />
                  登录正式账号
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
