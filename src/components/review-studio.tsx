"use client";

import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  Cpu,
  FileText,
  LoaderCircle,
  Play,
  Sparkles,
  Upload,
  ChevronDown,
  ChevronUp,
  Terminal,
  X,
  Calendar,
  MapPin,
  Mail,
  Phone,
  ExternalLink,
  Globe,
  Award,
  ShieldAlert,
  GraduationCap,
  Briefcase,
  Wrench,
  FolderGit2,
  Check,
  TrendingUp,
  ThumbsUp,
  User,
  Download,
  Edit,
  LogOut,
  Shield,
} from "lucide-react";

import {
  finalResumeReviewSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  reviewStreamChunkSchema,
  type ResumeProfile,
  type ReviewRunResult,
  type ReviewStageEvent,
  type ReviewStageProgressPhase,
  type ReviewerFeedback,
  type RevisionSuggestion,
  type ScoreDetail,
  resumeRewriteSchema,
  type ResumeRewrite,
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
  type LocalReviewStageStatus,
} from "@/lib/review/local-run-cache";

type StageStatus = LocalReviewStageStatus;

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

const STAGE_ORDER = [
  "resume_loader",
  "resume_parser",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
  "rewrite_agent",
] as const;

type StageName = (typeof STAGE_ORDER)[number];

type StageLogEntry = {
  timestamp: string;
  phase: ReviewStageProgressPhase | null;
  message: string;
  type?: "info" | "success" | "error";
};

type StageLiveState = {
  phase: ReviewStageProgressPhase | null;
  latestMessage: string;
  details: string[];
  logs?: StageLogEntry[];
};

const STAGE_META: Record<
  StageName,
  { label: string; focus: string; icon: typeof FileText }
> = {
  resume_loader: {
    label: "Loader",
    focus: "读取并解析原始简历数据源",
    icon: FileText,
  },
  resume_parser: {
    label: "Parser",
    focus: "深度结构化解析候选人画像",
    icon: Bot,
  },
  hr_agent: {
    label: "HR Agent",
    focus: "招聘视角评估与 ATS 规则适配",
    icon: BriefcaseBusiness,
  },
  interviewer_agent: {
    label: "Interviewer Agent",
    focus: "技术深度检验、可追问性与履历查验",
    icon: Cpu,
  },
  career_master_agent: {
    label: "Career Master Agent",
    focus: "资深职业大师评估与高阶行业叙事",
    icon: Sparkles,
  },
  summary_agent: {
    label: "Summary",
    focus: "意见整合并产出修改指导",
    icon: CheckCircle2,
  },
  rewrite_agent: {
    label: "Rewrite",
    focus: "智能简历全方位深度改写",
    icon: Edit,
  },
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

function createEmptyStageLiveState(): StageLiveState {
  return {
    phase: null,
    latestMessage: "",
    details: [],
    logs: [],
  };
}

const EMPTY_STAGE_LIVE_STATE: StageLiveState = createEmptyStageLiveState();

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

function isStageName(value: string): value is StageName {
  return STAGE_ORDER.includes(value as StageName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatStageLabel(value: string): string {
  return isStageName(value) ? STAGE_META[value].label : value.replace(/_/g, " ");
}

function formatReadyLevel(value: ReviewRunResult["finalReview"]["readyLevel"]): string {
  switch (value) {
    case "needs_rewrite":
      return "亟需重写";
    case "promising":
      return "极具潜力";
    case "strong":
      return "背景强劲";
    default:
      return value;
  }
}

function formatPriority(value: RevisionSuggestion["priority"]): string {
  switch (value) {
    case "high":
      return "最高优先级";
    case "medium":
      return "中优先级";
    case "low":
      return "低优先级";
    default:
      return value;
  }
}

function formatPhaseLabel(phase: ReviewStageProgressPhase | null): string {
  switch (phase) {
    case "requesting_model":
      return "发起请求";
    case "model_thinking":
      return "Agent 深度思考中";
    case "streaming_output":
      return "模型流式响应";
    case "validating_output":
      return "解析并格式化结果";
    default:
      return "等待处理";
  }
}

function formatWorkflowStatus(status: StageStatus, phase: ReviewStageProgressPhase | null): string {
  if (phase) {
    return formatPhaseLabel(phase);
  }
  if (status === "done") {
    return "诊断完成";
  }
  if (status === "running") {
    return "执行诊断中";
  }
  if (status === "interrupted") {
    return "已中断，可继续";
  }
  if (status === "failed") {
    return "执行失败，可重试";
  }
  return "等待队列中";
}

function parseChunkLine(line: string) {
  return reviewStreamChunkSchema.parse(JSON.parse(line));
}

function CollapsibleSection({
  title,
  children,
  defaultExpanded = true
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  return (
    <section className={`collapsible-section ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="collapsible-title-wrap">
          <span className="collapsible-bullet-icon" />
          <h4>{title}</h4>
        </div>
        <span className="collapsible-chevron">
          <ChevronDown size={16} />
        </span>
      </button>
      {isExpanded && <div className="collapsible-body">{children}</div>}
    </section>
  );
}

function BulletList({ items, emptyText = "暂无" }: { items: string[]; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="muted-copy">{emptyText}</p>;
  }

  return (
    <ul className="bullet-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ScoreTable({ items }: { items: ScoreDetail[] }) {
  if (items.length === 0) {
    return <p className="muted-copy">暂无评分拆解</p>;
  }

  return (
    <div className="dimension-scores-box">
      {items.map((item) => {
        const scoreClass = item.score >= 85 ? "high" : item.score >= 60 ? "mid" : "low";
        return (
          <div key={`${item.label}-${item.score}`} className="dimension-score-row">
            <div className="dimension-score-header">
              <span className="dimension-score-label">{item.label}</span>
              <span className={`dimension-score-badge ${scoreClass}`}>{item.score} 分</span>
            </div>
            <div className="dimension-progress-bg">
              <div className={`dimension-progress-fill ${scoreClass}`} style={{ width: `${item.score}%` }} />
            </div>
            {item.reason && <p className="dimension-score-reason">{item.reason}</p>}
          </div>
        );
      })}
    </div>
  );
}

function SuggestionTable({ suggestions }: { suggestions: RevisionSuggestion[] }) {
  if (suggestions.length === 0) {
    return <p className="muted-copy">暂无修改建议</p>;
  }

  return (
    <div className="revision-cards-board">
      {suggestions.map((item, index) => (
        <div key={`${item.section}-${index}`} className={`revision-card priority-${item.priority}`}>
          <div className="revision-card-header">
            <div className="revision-card-section">
              <span className="revision-section-icon"><BriefcaseBusiness size={14} /></span>
              <span className="revision-section-name">{item.section}</span>
            </div>
            <span className={`revision-priority-pill ${item.priority}`}>
              {formatPriority(item.priority)}
            </span>
          </div>

          <div className="revision-issue-row">
            <span className="revision-issue-icon"><ShieldAlert size={14} /></span>
            <span className="revision-issue-text">{item.issue}</span>
          </div>

          <div className="revision-recommendation-row">
            <span className="revision-recommendation-label">优化指导方案</span>
            <span className="revision-recommendation-text">{item.recommendation}</span>
          </div>

          {item.exampleRewrite && (
            <div className="revision-comparison-grid">
              <div className="revision-rewrite-block">
                <span className="revision-rewrite-label">优化示范样例</span>
                <pre className="revision-rewrite-content">{item.exampleRewrite}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MetricGrid({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="metric-grid">
      {rows.map((row) => (
        <div key={row.label} className="metric-cell">
          <dt>{row.label}</dt>
          <dd>{row.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
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

function LiveConsole({
  stage,
  liveState,
  status,
}: {
  stage: StageName;
  liveState: StageLiveState;
  status: StageStatus;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const logs = liveState.logs || [];

  useEffect(() => {
    const scrollTimer = window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);

    return () => window.clearTimeout(scrollTimer);
  }, [logs.length, null, null]);

  const wasRunning = useRef(false);
  if (status === "running" && !wasRunning.current) {
    wasRunning.current = true;
  } else if (status !== "running") {
    wasRunning.current = false;
  }

  const phases = ["requesting_model", "model_thinking", "streaming_output", "validating_output"] as const;
  const currentPhase = liveState.phase;

  return (
    <div className={`live-console-box ${status === "running" ? "is-running" : ""} ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        type="button"
        className="live-console-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="console-header-left">
          <Terminal size={15} />
          <strong>AI 专家工作流实时决策分析终端</strong>
          {status === "running" && (
            <span className="running-dot-wrapper">
              <span className="pulse-indicator" />
              <span className="console-running-text">云端计算中</span>
            </span>
          )}
        </span>
        <span className="console-header-right">
          <span className="console-log-count">{logs.length} 条轻量事件</span>
          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {isExpanded && (
        <div className="live-console-body">
          {/* Stepper display */}
          {status !== "pending" && (
            <div className="console-phase-stepper">
              {phases.map((p, idx) => {
                const isActive = currentPhase === p;
                const isDone = phases.indexOf(currentPhase as any) > idx || status === "done";
                return (
                  <div key={p} className={`console-phase-step ${isActive ? "active" : ""} ${isDone ? "completed" : ""}`}>
                    <span className="phase-indicator-dot" />
                    <span className="phase-label">{formatPhaseLabel(p)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Console logger */}
          <div className="console-log-screen" ref={scrollRef}>
            {logs.length === 0 ? (
              <p className="console-placeholder-text">等待评审任务启动，此处只显示阶段状态与心跳，不渲染模型原文。</p>
            ) : (
              <div className="console-logs-list">
                {logs.map((log, index) => (
                  <div key={index} className={`console-log-line log-type-${log.type || "info"}`}>
                    <span className="log-time">[{log.timestamp}]</span>
                    <span className="log-phase">[{formatPhaseLabel(log.phase)}]</span>
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewerResultPanel({ feedback }: { feedback: ReviewerFeedback }) {
  return (
    <article className="result-panel">
      <header className="result-header">
        <div>
          <span className="eyebrow">DIAGNOSTIC REPORT</span>
          <h3>{formatStageLabel(feedback.agentName)} 评审结果</h3>
        </div>
        <div className="score-badge-large">{feedback.overallScore}<span>分</span></div>
      </header>

      <MetricGrid
        rows={[
          { label: "专家评估视角", value: feedback.perspective },
          { label: "发掘的核心亮点", value: `${feedback.strengths.length} 项` },
          { label: "发现的潜在关注点", value: `${feedback.concerns.length} 项` },
        ]}
      />

      <div className="result-columns-collapsible">
        <CollapsibleSection title="深度分析摘要" defaultExpanded={true}>
          <BulletList items={feedback.reasoningSummary} />
        </CollapsibleSection>
        <CollapsibleSection title="候选人核心优势" defaultExpanded={true}>
          <BulletList items={feedback.strengths} />
        </CollapsibleSection>
        <CollapsibleSection title="背景瑕疵 / 痛点漏洞" defaultExpanded={true}>
          <BulletList items={feedback.concerns} />
        </CollapsibleSection>
      </div>

      <CollapsibleSection title="维度能力分解评分" defaultExpanded={true}>
        <ScoreTable items={feedback.scoreBreakdown} />
      </CollapsibleSection>

      <CollapsibleSection title="针对性逐项修改路线方案" defaultExpanded={true}>
        <SuggestionTable suggestions={feedback.suggestions} />
      </CollapsibleSection>
    </article>
  );
}

function ResumeProfilePanel({ profile }: { profile: ResumeProfile }) {
  // Filter skill groups
  const hasSkillGroups = profile.skillGroups && profile.skillGroups.length > 0;
  const hasWorkExperience = profile.workExperiences && profile.workExperiences.length > 0;
  const hasProjects = profile.projects && profile.projects.length > 0;
  const hasEducation = profile.educationRecords && profile.educationRecords.length > 0;
  const risksAndMissing = [...profile.risks, ...profile.missingInformation];

  return (
    <div className="premium-dashboard-container">
      {/* 1. Profile Hero Card */}
      <section className="profile-hero-card">
        <div className="profile-hero-info">
          <h3>{profile.candidateName || "未识别姓名"} 的个人基础信息</h3>
        </div>

        <div className="profile-meta-grid">
          <div className="profile-meta-item">
            <span className="profile-meta-icon"><Calendar size={16} /></span>
            <div className="profile-meta-content">
              <span className="profile-meta-label">年龄情况</span>
              <span className="profile-meta-value">{profile.personalInfo.age || "-"}</span>
            </div>
          </div>
          <div className="profile-meta-item">
            <span className="profile-meta-icon"><Briefcase size={16} /></span>
            <div className="profile-meta-content">
              <span className="profile-meta-label">工作年限</span>
              <span className="profile-meta-value">{profile.yearsOfExperience || "-"}</span>
            </div>
          </div>
          <div className="profile-meta-item">
            <span className="profile-meta-icon"><MapPin size={16} /></span>
            <div className="profile-meta-content">
              <span className="profile-meta-label">意向所在地</span>
              <span className="profile-meta-value">{profile.personalInfo.location || "-"}</span>
            </div>
          </div>
          <div className="profile-meta-item">
            <span className="profile-meta-icon"><Phone size={16} /></span>
            <div className="profile-meta-content">
              <span className="profile-meta-label">联系电话</span>
              <span className="profile-meta-value">{profile.personalInfo.phone || "-"}</span>
            </div>
          </div>
          <div className="profile-meta-item">
            <span className="profile-meta-icon"><Mail size={16} /></span>
            <div className="profile-meta-content">
              <span className="profile-meta-label">电子邮箱</span>
              <span className="profile-meta-value">{profile.personalInfo.email || "-"}</span>
            </div>
          </div>
          {profile.personalInfo.links && profile.personalInfo.links.length > 0 && (
            <div className="profile-meta-item">
              <span className="profile-meta-icon"><Globe size={16} /></span>
              <div className="profile-meta-content">
                <span className="profile-meta-label">社交与作品集</span>
                <div className="flex flex-col gap-1 mt-0.5">
                  {profile.personalInfo.links.map((link, idx) => (
                    <a key={idx} href={link.startsWith("http") ? link : `https://${link}`} target="_blank" rel="noopener noreferrer" className="profile-meta-link">
                      <span>作品集 #{idx + 1}</span>
                      <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. Highlights & Summary & Risks Checklist */}
      <div className="dashboard-grid-2col">
        {/* Background Summary & Key Strengths */}
        <div className="dashboard-card">
          <div className="dashboard-card-title">
            <span className="dashboard-card-title-icon"><TrendingUp size={15} /></span>
            <span>候选人背景特征与闪光优势</span>
          </div>

          {profile.reasoningSummary && profile.reasoningSummary.length > 0 && (
            <div className="reasoning-quotes-box">
              {profile.reasoningSummary.map((summary, idx) => (
                <div key={idx} className="reasoning-quote-item">“ {summary} ”</div>
              ))}
            </div>
          )}

          {profile.strengths && profile.strengths.length > 0 && (
            <div className="strengths-checklist">
              {profile.strengths.map((str, idx) => (
                <div key={idx} className="strength-item-custom">
                  <span className="strength-icon-wrap"><Check size={14} /></span>
                  <span className="strength-text">{str}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Risks and Missing Info */}
        <div className="dashboard-card">
          <div className="dashboard-card-title">
            <span className="dashboard-card-title-icon"><ShieldAlert size={15} /></span>
            <span>简历潜在缺陷、漏洞与缺失点</span>
          </div>

          {risksAndMissing.length > 0 ? (
            <div className="gaps-checklist">
              {risksAndMissing.map((gap, idx) => (
                <div key={idx} className="gap-item-custom">
                  <span className="gap-icon-wrap"><AlertCircle size={14} /></span>
                  <span className="gap-text">{gap}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy text-center py-4">完美画像！未检测出明显的信息漏洞与履历硬伤。</p>
          )}
        </div>
      </div>

      {/* 3. Skill stack dashboard */}
      <section className="dashboard-card">
        <div className="dashboard-card-title">
          <span className="dashboard-card-title-icon"><Wrench size={15} /></span>
          <span>专业技能图谱 & 核心技术栈</span>
        </div>

        <div className="skills-dashboard-row">
          {profile.coreSkills && profile.coreSkills.length > 0 && (
            <div className="skill-category-card">
              <div className="skill-category-header">核心高亮技能 (Core Stack)</div>
              <div className="skills-pill-group">
                {profile.coreSkills.map((skill) => (
                  <span key={skill} className="skill-pill-custom is-core">{skill}</span>
                ))}
              </div>
            </div>
          )}

          {hasSkillGroups && (
            <div className="skills-card-grid">
              {profile.skillGroups.map((group) => (
                <div key={group.category} className="skill-category-card">
                  <div className="skill-category-header">{group.category}</div>
                  <div className="skills-pill-group">
                    {group.items.map((skill) => (
                      <span key={skill} className="skill-pill-custom">{skill}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 4. Experience timeline dashboard */}
      {hasWorkExperience && (
        <section className="dashboard-card">
          <div className="dashboard-card-title">
            <span className="dashboard-card-title-icon"><Briefcase size={15} /></span>
            <span>历任职业履历生涯时间轴</span>
          </div>

          <div className="visual-timeline">
            {profile.workExperiences.map((exp, idx) => (
              <div key={idx} className="timeline-card-node">
                <div className="timeline-dot" />
                <div className="timeline-item-box">
                  <div className="timeline-item-header">
                    <div className="timeline-title-group">
                      <span className="timeline-title-company">{exp.company || "未知企业"}</span>
                      <div className="timeline-role-row">
                        {exp.role && <span className="timeline-title-role">{exp.role}</span>}
                        {exp.location && <span className="text-xs text-dim flex items-center gap-1"><MapPin size={10} />{exp.location}</span>}
                      </div>
                    </div>
                    {exp.period && <span className="timeline-period-badge">{exp.period}</span>}
                  </div>

                  <div className="timeline-item-body">
                    {exp.responsibilities && exp.responsibilities.length > 0 && (
                      <div>
                        <div className="timeline-bullet-title">工作职责与要点</div>
                        <ul className="timeline-bullets-list">
                          {exp.responsibilities.map((bullet, bidx) => (
                            <li key={bidx}>{bullet}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {exp.achievements && exp.achievements.length > 0 && (
                      <div className="mt-1">
                        <div className="timeline-bullet-title text-green flex items-center gap-1"><ThumbsUp size={11} /> 核心业绩与产出亮点</div>
                        <ul className="timeline-bullets-list">
                          {exp.achievements.map((ach, aidx) => (
                            <li key={aidx} className="font-medium text-emerald-dim">{ach}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {exp.technologies && exp.technologies.length > 0 && (
                      <div className="timeline-tech-tags mt-1">
                        {exp.technologies.map((tech) => (
                          <span key={tech} className="timeline-tech-pill">{tech}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Project experience dashboard */}
      {hasProjects && (
        <section className="dashboard-card">
          <div className="dashboard-card-title">
            <span className="dashboard-card-title-icon"><FolderGit2 size={15} /></span>
            <span>主持 / 参与项目履历与实践成果</span>
          </div>

          <div className="visual-timeline">
            {profile.projects.map((proj, idx) => (
              <div key={idx} className="timeline-card-node">
                <div className="timeline-dot" />
                <div className="timeline-item-box">
                  <div className="timeline-item-header">
                    <div className="timeline-title-group">
                      <span className="timeline-title-company">{proj.name || "未知项目"}</span>
                      {proj.role && <div className="timeline-role-row mt-0.5"><span className="timeline-title-role">{proj.role}</span></div>}
                    </div>
                    {proj.period && <span className="timeline-period-badge">{proj.period}</span>}
                  </div>

                  <div className="timeline-item-body">
                    {proj.description && (
                      <p className="text-sm-custom text-normal leading-relaxed">{proj.description}</p>
                    )}
                    {proj.highlights && proj.highlights.length > 0 && (
                      <div>
                        <div className="timeline-bullet-title">项目亮点 / 技术攻关成果</div>
                        <ul className="timeline-bullets-list">
                          {proj.highlights.map((bullet, bidx) => (
                            <li key={bidx}>{bullet}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {proj.technologies && proj.technologies.length > 0 && (
                      <div className="timeline-tech-tags mt-1">
                        {proj.technologies.map((tech) => (
                          <span key={tech} className="timeline-tech-pill">{tech}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. Education dashboard */}
      {hasEducation && (
        <section className="dashboard-card">
          <div className="dashboard-card-title">
            <span className="dashboard-card-title-icon"><GraduationCap size={15} /></span>
            <span>受教育背景及学术经历</span>
          </div>

          <div className="skills-card-grid">
            {profile.educationRecords.map((edu, idx) => (
              <div key={idx} className="skill-category-card">
                <div className="timeline-item-header">
                  <div className="timeline-title-group">
                    <span className="timeline-title-company">{edu.school}</span>
                    <div className="timeline-role-row">
                      {edu.major && <span className="font-semibold text-sm-custom">{edu.major}</span>}
                      {edu.degree && <span className="timeline-title-role">{edu.degree}</span>}
                    </div>
                  </div>
                  {edu.period && <span className="timeline-period-badge">{edu.period}</span>}
                </div>
                {edu.details && edu.details.length > 0 && (
                  <ul className="timeline-bullets-list mt-1">
                    {edu.details.map((det, didx) => (
                      <li key={didx}>{det}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FinalReviewPanel({ result }: { result: ReviewRunResult }) {
  const finalReview = result.finalReview;

  return (
    <section className="result-stack summary-result-stack">
      {/* 1. Report Header Banner */}
      <header className="summary-report-header">
        <div className="summary-report-title">
          <div className="summary-title-badge">
            <Sparkles size={12} />
            <span>智能评审报告已出炉</span>
          </div>
          <h2>智能协同终审诊断书</h2>
          <p className="summary-report-desc">多 Agent 专家智囊团联合审计，完成对候选人画像、ATS 适配性与核心竞争力的全局诊断</p>
        </div>
        <div className="summary-report-meta">
          <span className="summary-meta-badge">
            <FolderGit2 size={12} />
            <span>源文件: {result.document.path?.split(/[\\/]/).pop() || "未命名简历"}</span>
          </span>
        </div>
      </header>

      {/* 2. Stunning Scorecard Grid */}
      <div className="summary-stats-grid">
        <div className="summary-stat-card card-score">
          <div className="stat-card-glow" />
          <div className="stat-card-content">
            <dt>综合评审核心得分</dt>
            <dd className="stat-value font-bold">{finalReview.overallScore}<span>分</span></dd>
            <span className="stat-card-badge score-high">击败 88% 同类简历</span>
          </div>
        </div>

        <div className="summary-stat-card card-readiness">
          <div className="stat-card-glow" />
          <div className="stat-card-content">
            <dt>简历就绪评估等级</dt>
            <dd className="stat-value font-bold text-ready-level">{formatReadyLevel(finalReview.readyLevel)}</dd>
            <span className="stat-card-badge status-high">推荐启动面试</span>
          </div>
        </div>

        <div className="summary-stat-card card-experts">
          <div className="stat-card-glow" />
          <div className="stat-card-content">
            <dt>协作智囊团专家数</dt>
            <dd className="stat-value font-bold">{result.reviewerFeedback.length}<span>位</span></dd>
            <span className="stat-card-badge expert-high">已联署评审意见</span>
          </div>
        </div>
      </div>

      {/* 3. Exquisite Executive Summary Card */}
      <article className="summary-executive-box">
        <div className="executive-box-header">
          <span className="executive-bullet" />
          <h3>EXECUTIVE SUMMARY · 全局诊断意见</h3>
        </div>
        <p className="executive-text">{finalReview.executiveSummary || "已生成全局汇总方案"}</p>
      </article>

      {/* 4. Priorities, Breakdown, and Suggestions */}
      <CollapsibleSection title="最高优先级修改路线图" defaultExpanded={true}>
        <ol className="priority-list">
          {finalReview.topPriorities.length > 0 ? (
            finalReview.topPriorities.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
          ) : (
            <li>暂无优先级建议</li>
          )}
        </ol>
      </CollapsibleSection>

      <CollapsibleSection title="评分细分核心矩阵" defaultExpanded={true}>
        <ScoreTable items={finalReview.scoreBreakdown} />
      </CollapsibleSection>

      <CollapsibleSection title="协同 Agent 诊断结果全览" defaultExpanded={true}>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>专家评估视角</th>
                <th>百分制评分</th>
                <th>首要关注点</th>
              </tr>
            </thead>
            <tbody>
              {result.reviewerFeedback.map((item) => (
                <tr key={item.agentName}>
                  <td className="font-semibold">{formatStageLabel(item.agentName)}</td>
                  <td>{item.perspective}</td>
                  <td className="table-score-highlight font-bold">{item.overallScore} 分</td>
                  <td>{item.concerns[0] || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="简历逐板块修改指导方案" defaultExpanded={true}>
        <SuggestionTable suggestions={finalReview.sectionRevisions} />
      </CollapsibleSection>
    </section>
  );
}

function LoaderResultPanel({ payload }: { payload: unknown }) {
  const loaderPayload = isRecord(payload) ? payload : {};

  return (
    <article className="result-panel result-panel-featured">
      <header className="result-header">
        <div>
          <span className="eyebrow">LOADER STATUS</span>
          <h3>简历源文件加载已成功</h3>
        </div>
        <div className="score-pill subtle">{String(loaderPayload.fileType ?? "-")}</div>
      </header>
      <MetricGrid
        rows={[
          { label: "本地暂存路径", value: String(loaderPayload.path ?? "-") },
          { label: "文件存储格式", value: String(loaderPayload.fileType ?? "-") },
        ]}
      />
    </article>
  );
}

function SummaryResultPanel({ payload }: { payload: unknown }) {
  const parsed = finalResumeReviewSchema.safeParse(payload);
  if (!parsed.success) {
    return <EmptyResultPanel title="汇总结果暂不可用" detail="Summary Agent 完成后会展示最终摘要、评分拆解和优先建议。" />;
  }

  return (
    <article className="result-panel result-panel-featured">
      <header className="result-header">
        <div>
          <span className="eyebrow">SUMMARY REPORT</span>
          <h3>整合汇总诊断阶段已完成</h3>
        </div>
        <div className="score-badge-large">{parsed.data.overallScore}<span>分</span></div>
      </header>
      <MetricGrid
        rows={[
          { label: "综合就绪等级", value: formatReadyLevel(parsed.data.readyLevel) },
          { label: "高优先级优化项数量", value: `${parsed.data.topPriorities.length} 项` },
        ]}
      />

      <CollapsibleSection title="整合修改路线意见摘要" defaultExpanded={true}>
        <p className="summary-copy">{parsed.data.executiveSummary || "暂无"}</p>
      </CollapsibleSection>

      <CollapsibleSection title="百分制细分维度诊断表" defaultExpanded={true}>
        <ScoreTable items={parsed.data.scoreBreakdown} />
      </CollapsibleSection>
    </article>
  );
}

function EmptyResultPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <article className="empty-result-panel">
      <FileText size={22} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function RewriteResultPanel({
  payload,
  finalResult,
}: {
  payload: unknown;
  finalResult: ReviewRunResult | null;
}) {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const rewriteData = resumeRewriteSchema.safeParse(payload || finalResult?.rewrite);

  if (!rewriteData.success) {
    return (
      <EmptyResultPanel
        title="简历重写数据不可用"
        detail="简历重写仍在处理中或格式不正确。请耐心等待智能协同重写优化完成。"
      />
    );
  }

  const { rewrittenContent, explanation } = rewriteData.data;

  // Retrieve candidate name from finalResult profile
  const candidateName = finalResult?.profile?.candidateName || "候选人";
  const downloadFileName = `${candidateName}_优化后全新简历.md`;

  const parseMarkdownToHtml = (markdown: string): string => {
    let html = markdown
      .replace(/\r\n/g, "\n")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Headers
    html = html.replace(/^# (.*$)/gim, '<h1 class="pdf-name">$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="pdf-section-title">$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3 class="pdf-subsection-title">$1</h3>');

    // Bold text
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Split into lines to manage lists and paragraphs
    const lines = html.split("\n");
    let inList = false;
    const processedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (inList) {
          processedLines.push("</ul>");
          inList = false;
        }
        continue;
      }

      const listMatch = line.match(/^[-*]\s+(.*)$/);
      if (listMatch) {
        if (!inList) {
          processedLines.push("<ul>");
          inList = true;
        }
        processedLines.push(`<li>${listMatch[1]}</li>`);
      } else {
        if (inList) {
          processedLines.push("</ul>");
          inList = false;
        }

        if (line.startsWith("<h") || line.startsWith("<ul") || line.startsWith("<li")) {
          processedLines.push(line);
        } else {
          processedLines.push(`<p>${line}</p>`);
        }
      }
    }

    if (inList) {
      processedLines.push("</ul>");
    }

    return processedLines.join("\n");
  };

  const handleDownload = () => {
    if (!rewrittenContent) return;
    const blob = new Blob([rewrittenContent], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", downloadFileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPdf = async () => {
    if (!rewrittenContent) return;
    setIsDownloadingPdf(true);

    try {
      // Dynamically import html2pdf on the client side only
      // @ts-ignore
      const html2pdf = (await import("html2pdf.js")).default;

      const htmlContent = parseMarkdownToHtml(rewrittenContent);

      const container = document.createElement("div");
      container.innerHTML = `
        <style>
          .pdf-resume-wrapper {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #1e293b;
            line-height: 1.45;
            padding: 10px 20px;
            background: #ffffff;
          }
          h1.pdf-name {
            font-size: 22px;
            font-weight: 700;
            color: #0f172a;
            text-align: center;
            margin-top: 0;
            margin-bottom: 14px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 6px;
          }
          h2.pdf-section-title {
            font-size: 13.5px;
            font-weight: 700;
            color: #0c4a6e;
            border-bottom: 1px solid #cbd5e1;
            padding-bottom: 3px;
            margin-top: 16px;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
          }
          h3.pdf-subsection-title {
            font-size: 12px;
            font-weight: 600;
            color: #0f172a;
            margin-top: 10px;
            margin-bottom: 4px;
          }
          p {
            font-size: 11.5px;
            margin: 0 0 6px 0;
            color: #334155;
          }
          ul {
            margin: 0 0 6px 0;
            padding-left: 18px;
          }
          li {
            font-size: 11.5px;
            color: #334155;
            margin-bottom: 2.5px;
          }
          strong {
            color: #0f172a;
            font-weight: 600;
          }
        </style>
        <div class="pdf-resume-wrapper">
          ${htmlContent}
        </div>
      `;

      const options = {
        margin: 15,
        filename: `${candidateName}_优化后全新简历.pdf`,
        image: { type: "jpeg" as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm" as const, format: "a4" as const, orientation: "portrait" as const }
      };

      await html2pdf().from(container).set(options).save();
    } catch (error) {
      console.error("PDF download failed:", error);
      alert("PDF 下载失败，请重新尝试。");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <section className="result-stack summary-result-stack">
      {/* 1. Optimizer Header Banner */}
      <header className="summary-report-header" style={{ marginBottom: "1.5rem" }}>
        <div className="summary-report-title">
          <div className="summary-title-badge">
            <Sparkles size={12} />
            <span>AI 协同智能改写已完成</span>
          </div>
          <h2>智能协同优化重写简历</h2>
          <p className="summary-report-desc">
            整合 HR、技术面试官及职业规划大师的终审修改建议，已为您深度重构并润色简历文本
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button
            onClick={handleDownload}
            disabled={!rewrittenContent || isDownloadingPdf}
            className="download-resume-btn-secondary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "rgba(255, 255, 255, 0.03)",
              color: isDownloadingPdf ? "#64748b" : "#e2e8f0",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              padding: "0.6rem 1.2rem",
              fontSize: "0.875rem",
              fontWeight: "600",
              cursor: isDownloadingPdf ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <Download size={15} />
            <span>下载 Markdown (.md)</span>
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={!rewrittenContent || isDownloadingPdf}
            className="download-resume-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: isDownloadingPdf
                ? "rgba(255, 255, 255, 0.05)"
                : "linear-gradient(135deg, #06b6d4, #0891b2)",
              color: isDownloadingPdf ? "#94a3b8" : "#ffffff",
              border: isDownloadingPdf ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
              borderRadius: "8px",
              padding: "0.6rem 1.2rem",
              fontSize: "0.875rem",
              fontWeight: "600",
              cursor: isDownloadingPdf ? "not-allowed" : "pointer",
              boxShadow: isDownloadingPdf ? "none" : "0 4px 14px rgba(6, 182, 212, 0.3)",
              transition: "all 0.2s ease",
            }}
          >
            {isDownloadingPdf ? (
              <LoaderCircle className="spin-icon" size={13} />
            ) : (
              <Sparkles size={13} />
            )}
            <span>{isDownloadingPdf ? "正在生成 PDF 简历..." : "导出为 PDF 格式"}</span>
          </button>
        </div>
      </header>

      {/* 2. Explanation Box */}
      {explanation && (
        <div
          className="summary-executive-box"
          style={{
            marginBottom: "1.5rem",
            borderLeft: "4px solid #06b6d4",
            background: "rgba(6, 182, 212, 0.03)",
          }}
        >
          <h4 style={{ color: "#06b6d4", margin: "0 0 0.5rem 0", fontSize: "0.95rem", fontWeight: "600" }}>
            本次重写优化要点说明
          </h4>
          <p className="summary-copy" style={{ margin: 0, fontSize: "0.875rem", lineHeight: "1.6" }}>
            {explanation}
          </p>
        </div>
      )}

      {/* 3. Rewritten Content Preview */}
      <CollapsibleSection title="全新简历实时预览 (标准 Markdown 格式)" defaultExpanded={true}>
        <div
          className="markdown-preview-container"
          style={{
            background: "#12141a",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "8px",
            padding: "1.5rem",
            maxHeight: "650px",
            overflowY: "auto",
            fontFamily: "'Courier New', Courier, monospace, sans-serif",
            fontSize: "0.875rem",
            lineHeight: "1.7",
            color: "#e2e8f0",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {rewrittenContent || "正在装载简历内容..."}
        </div>
      </CollapsibleSection>
    </section>
  );
}

const StageResultContent = memo(function StageResultContent({
  finalResult,
  payload,
  stage,
}: {
  finalResult: ReviewRunResult | null;
  payload: unknown;
  stage: StageName;
}) {
  if (!payload && !(stage === "summary_agent" && finalResult)) {
    return (
      <EmptyResultPanel
        title={`${STAGE_META[stage].label} 结果装载中`}
        detail="工作流仍在前置或当前节点执行中。任务就绪后，此位置将实时渲染结构化诊断细节板书。"
      />
    );
  }

  if (stage === "resume_loader") {
    return <LoaderResultPanel payload={payload} />;
  }

  if (stage === "resume_parser") {
    const parsed = resumeProfileSchema.safeParse(payload);
    return parsed.success ? (
      <ResumeProfilePanel profile={parsed.data} />
    ) : (
      <EmptyResultPanel title="画像数据构建失败" detail="模型流式解析有误，系统尝试在校验模块中进行自动数据抢救恢复。" />
    );
  }

  if (stage === "hr_agent" || stage === "interviewer_agent" || stage === "career_master_agent") {
    const parsed = reviewerFeedbackSchema.safeParse(payload);
    return parsed.success ? (
      <ReviewerResultPanel feedback={parsed.data} />
    ) : (
      <EmptyResultPanel title="专家诊断分析不可用" detail="诊断响应格式损坏，建议您检查模型环境或重新触发分析流程。" />
    );
  }

  if (stage === "summary_agent" && finalResult) {
    return <FinalReviewPanel result={finalResult} />;
  }

  if (stage === "rewrite_agent") {
    return <RewriteResultPanel payload={payload} finalResult={finalResult} />;
  }

  return <SummaryResultPanel payload={payload} />;
});

function ResultExplorer({
  finalResult,
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
}: {
  finalResult: ReviewRunResult | null;
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
}) {
  const meta = STAGE_META[selectedStage];
  const Icon = meta.icon;
  const liveState = stageStreams[selectedStage] ?? EMPTY_STAGE_LIVE_STATE;
  const status = stageStatus[selectedStage];
  const [isResultExpanded, setIsResultExpanded] = useState(true);
  const payload = stagePayloads[selectedStage];

  return (
    <div className="node-result-layout" key={selectedStage}>
      <header className="node-result-header">
        <div className="node-result-title">
          <span className="node-result-icon">
            <Icon size={18} />
          </span>
          <div>
            <span className="eyebrow">NODE DETAILS</span>
            <h2>{meta.label} 诊断台</h2>
          </div>
        </div>
        <span className={`workflow-status-pill workflow-status-${status}`}>
          {formatWorkflowStatus(status, liveState.phase)}
        </span>
      </header>

      <div className="result-viewer">
        <LiveConsole stage={selectedStage} liveState={liveState} status={status} />
        
        <div className={`live-console-box ${status === "done" ? "is-done" : ""} ${isResultExpanded ? "is-expanded" : "is-collapsed"}`}>
          <button
            type="button"
            className="live-console-header"
            onClick={() => setIsResultExpanded(!isResultExpanded)}
            style={{ width: "100%", borderBottom: isResultExpanded ? "1px solid var(--line)" : "none", textAlign: "left" }}
          >
            <span className="console-header-left" style={{ color: payload ? "var(--green)" : "var(--cyan)" }}>
              <FileText size={15} />
              <strong>{meta.label} 诊断分析报告 & 优化结果</strong>
              {status === "done" && (
                <span className="running-dot-wrapper" style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "99px", padding: "1px 8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <span className="phase-indicator-dot" style={{ background: "var(--green)", width: "6px", height: "6px", borderRadius: "50%", display: "inline-block" }} />
                  <span className="console-running-text" style={{ color: "var(--green)", fontSize: "0.7rem", fontWeight: "600" }}>诊断就绪</span>
                </span>
              )}
            </span>
            <span className="console-header-right">
              <span className="console-log-count" style={{ color: "var(--text-dim)" }}>
                {payload ? "已生成结构化结果" : "等待数据载入"}
              </span>
              {isResultExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>

          {isResultExpanded && (
            <div className="live-console-body" style={{ background: "transparent", padding: "14px" }}>
              <div className="structured-panel-wrapper" style={{ border: "none", padding: 0, background: "transparent" }}>
                <StageResultContent
                  finalResult={selectedStage === "summary_agent" ? finalResult : null}
                  payload={stagePayloads[selectedStage]}
                  stage={selectedStage}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageDetailDrawer({
  finalResult,
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
  onClose,
}: {
  finalResult: ReviewRunResult | null;
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
  onClose: () => void;
}) {
  const meta = STAGE_META[selectedStage];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="result-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="result-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${meta.label} 节点执行结果`}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="result-drawer-close" type="button" onClick={onClose} aria-label="关闭节点详情">
          <X size={17} />
        </button>
        <ResultExplorer
          finalResult={finalResult}
          selectedStage={selectedStage}
          stagePayloads={stagePayloads}
          stageStatus={stageStatus}
          stageStreams={stageStreams}
        />
      </aside>
    </div>
  );
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
          if (line.startsWith("<!DOCTYPE") || line.startsWith("<html") || line.includes("Gateway Timeout") || line.includes("Internal Server Error")) {
            setErrorMessage("服务器网络超时或发生内部错误，诊断已被中断，请重试。");
          } else {
            setErrorMessage(`流式响应解析失败: ${line.slice(0, 100)}`);
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
          flushPendingProgressEvents();
          setFinalResult(chunk.result);
          setSelectedStage("rewrite_agent");
          setIsRunning(false);
          requestAbortControllerRef.current = null;
          onSessionChanged?.();
          continue;
        }
        flushPendingProgressEvents();
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
      setStageStatus((previous) =>
        (wasAborted ? interruptRunningStages(previous) : failRunningStages(previous)) as Record<StageName, StageStatus>,
      );
      setRunningStages([]);
      setErrorMessage(
        wasAborted
          ? "已中断诊断，可点击继续诊断从本地断点重试。"
          : error instanceof Error
            ? error.message
            : "Review request failed.",
      );
      setIsRunning(false);
      requestAbortControllerRef.current = null;
    }
  }, [
    currentRunId,
    resumeFile,
    targetRole,
    targetDescription,
    handleChunkStream,
    flushPendingProgressEvents
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
