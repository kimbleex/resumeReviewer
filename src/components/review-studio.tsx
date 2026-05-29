"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
} from "@/lib/review/schemas";

type StageStatus = "pending" | "running" | "done";

const STAGE_ORDER = [
  "resume_loader",
  "resume_parser",
  "hr_agent",
  "interviewer_agent",
  "career_master_agent",
  "summary_agent",
] as const;

type StageName = (typeof STAGE_ORDER)[number];

type StageLogEntry = {
  timestamp: string;
  phase: ReviewStageProgressPhase | null;
  message: string;
  snippet?: string;
  type?: "info" | "thinking" | "output" | "success" | "error";
};

type StageLiveState = {
  phase: ReviewStageProgressPhase | null;
  latestMessage: string;
  details: string[];
  logs?: StageLogEntry[];
  reasoning?: string;
  output?: string;
};

const STAGE_META: Record<
  StageName,
  { label: string; focus: string; icon: typeof FileText }
> = {
  resume_loader: {
    label: "Resume Loader",
    focus: "读取并解析原始简历数据源",
    icon: FileText,
  },
  resume_parser: {
    label: "Resume Parser",
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
    label: "Career Master",
    focus: "全局职业定位评估与高阶行业叙事",
    icon: Sparkles,
  },
  summary_agent: {
    label: "Summary Agent",
    focus: "多 Agent 意见整合并产出修改指导",
    icon: CheckCircle2,
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
  };
}

function createEmptyStageLiveState(): StageLiveState {
  return {
    phase: null,
    latestMessage: "",
    details: [],
    logs: [],
    reasoning: "",
    output: "",
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
  const payload = event.payload as Record<string, unknown> | null;
  const streamType = payload?.streamType;

  let updatedReasoning = current.reasoning || "";
  let updatedOutput = current.output || "";

  if (streamType === "reasoning" && event.snippet) {
    updatedReasoning += event.snippet;
  } else if ((streamType === "output_text" || streamType === "partial_object") && event.snippet) {
    updatedOutput += event.snippet;
  }

  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const newLog: StageLogEntry = {
    timestamp,
    phase: nextPhase,
    message: event.message,
    snippet: event.snippet || undefined,
    type:
      streamType === "reasoning"
        ? "thinking"
        : streamType === "output_text" || streamType === "partial_object"
          ? "output"
          : "info",
  };

  const prevLogs = current.logs || [];
  let updatedLogs = [...prevLogs];
  const lastLog = prevLogs[prevLogs.length - 1];

  if (
    lastLog &&
    lastLog.phase === newLog.phase &&
    lastLog.type === newLog.type &&
    (newLog.type === "thinking" || newLog.type === "output")
  ) {
    updatedLogs[updatedLogs.length - 1] = {
      ...lastLog,
      message: newLog.message,
      snippet: (lastLog.snippet || "") + (newLog.snippet || ""),
    };
  } else {
    updatedLogs.push(newLog);
  }

  const shouldRefreshWorkflowText =
    !event.snippet || nextPhase !== current.phase || !current.latestMessage;

  return {
    ...previous,
    [stage]: {
      phase: nextPhase,
      latestMessage: shouldRefreshWorkflowText ? event.message || current.latestMessage : current.latestMessage,
      details: event.details.length > 0 && shouldRefreshWorkflowText ? event.details : current.details,
      reasoning: updatedReasoning,
      output: updatedOutput,
      logs: updatedLogs.slice(-80),
    },
  };
}

function isStageName(value: string): value is StageName {
  return STAGE_ORDER.includes(value as StageName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>评估维度</th>
            <th>百分制得分</th>
            <th>维度评估解析</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.label}-${item.score}`}>
              <td className="font-semibold">{item.label}</td>
              <td className="font-bold table-score-highlight">{item.score} 分</td>
              <td>{item.reason || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuggestionTable({ suggestions }: { suggestions: RevisionSuggestion[] }) {
  if (suggestions.length === 0) {
    return <p className="muted-copy">暂无修改建议</p>;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: "120px" }}>对应板块</th>
            <th style={{ width: "120px" }}>紧迫程度</th>
            <th>发现的核心瑕疵 / 缺口</th>
            <th>具体的优化手段建议</th>
            <th>优化示范样例</th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((item, index) => (
            <tr key={`${item.section}-${index}`}>
              <td className="font-semibold">{item.section}</td>
              <td>
                <span className={`priority-badge priority-${item.priority}`}>{formatPriority(item.priority)}</span>
              </td>
              <td className="text-red-dim font-medium">{item.issue}</td>
              <td>{item.recommendation}</td>
              <td className="pre-wrap-column font-mono text-sm-custom">{item.exampleRewrite || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const path = "M14 0V44";
  
  return (
    <div className="flowchart-arrow-container">
      <svg width="28" height="48" viewBox="0 0 28 48" fill="none">
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
  const readyClass = isParserDone ? "flow-line-ready" : "flow-line-idle";
  const pendingMarker = isParserDone ? "url(#arrow-cyan)" : "url(#arrow-gray)";
  const getBranchClass = (status: StageStatus) =>
    status === "done" ? "flow-line-done" : status === "running" ? "flow-line-active" : readyClass;
  const getBranchMarker = (status: StageStatus) =>
    status === "done" ? "url(#arrow-green)" : status === "running" ? "url(#arrow-cyan)" : pendingMarker;

  const leftClass = getBranchClass(hrStatus);
  const midClass = getBranchClass(interviewerStatus);
  const rightClass = getBranchClass(careerStatus);

  const leftMarker = getBranchMarker(hrStatus);
  const midMarker = getBranchMarker(interviewerStatus);
  const rightMarker = getBranchMarker(careerStatus);
  const leftPath = "M 170 0 V 14 Q 170 20 164 20 H 62 Q 56 20 56 26 V 54";
  const midPath = "M 170 0 V 54";
  const rightPath = "M 170 0 V 14 Q 170 20 176 20 H 278 Q 284 20 284 26 V 54";

  return (
    <div className="flowchart-branch-container">
      <svg width="100%" height="58" viewBox="0 0 340 58" preserveAspectRatio="none" fill="none">
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

        {/* Faint static pipeline background paths */}
        <path d={leftPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />

        {/* Active glowing dynamic flow overlays */}
        <path 
          d={leftPath} 
          className={leftClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={leftMarker}
        />
        <path 
          d={midPath} 
          className={midClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={midMarker}
        />
        <path 
          d={rightPath} 
          className={rightClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={rightMarker}
        />
        <FlowRunnerPath path={leftPath} lineClass={leftClass} duration="2.15s" delay="-0.35s" />
        <FlowRunnerPath path={midPath} lineClass={midClass} duration="1.65s" delay="-0.1s" />
        <FlowRunnerPath path={rightPath} lineClass={rightClass} duration="2.15s" delay="-0.75s" />
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
  const allReviewersDone = hrStatus === "done" && interviewerStatus === "done" && careerStatus === "done";
  const readyToSummarize = allReviewersDone && summaryStatus === "pending";
  const pendingClass = readyToSummarize ? "flow-line-ready" : "flow-line-idle";
  const pendingMarker = readyToSummarize ? "url(#arrow-cyan)" : "url(#arrow-gray)";
  const getMergeClass = (status: StageStatus) =>
    summaryStatus === "done"
      ? "flow-line-done"
      : summaryStatus === "running"
        ? "flow-line-active"
        : status === "done"
          ? "flow-line-done"
          : pendingClass;
  const getMergeMarker = (status: StageStatus) =>
    summaryStatus === "done"
      ? "url(#arrow-green)"
      : summaryStatus === "running"
        ? "url(#arrow-cyan)"
        : status === "done"
          ? "url(#arrow-green)"
          : pendingMarker;

  const leftClass = getMergeClass(hrStatus);
  const midClass = getMergeClass(interviewerStatus);
  const rightClass = getMergeClass(careerStatus);

  const leftMarker = getMergeMarker(hrStatus);
  const midMarker = getMergeMarker(interviewerStatus);
  const rightMarker = getMergeMarker(careerStatus);
  const leftPath = "M 56 0 V 12 Q 56 20 64 20 H 164 Q 170 20 170 28 V 54";
  const midPath = "M 170 0 V 54";
  const rightPath = "M 284 0 V 12 Q 284 20 276 20 H 176 Q 170 20 170 28 V 54";

  return (
    <div className="flowchart-merge-container">
      <svg width="100%" height="58" viewBox="0 0 340 58" preserveAspectRatio="none" fill="none">
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
          <marker id="arrow-gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="rgba(0, 242, 254, 0.38)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
        </defs>

        {/* Faint static pipeline background paths */}
        <path d={leftPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={midPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={rightPath} stroke="rgba(255, 255, 255, 0.05)" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />

        {/* Active glowing dynamic flow overlays */}
        <path 
          d={leftPath} 
          className={leftClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={leftMarker}
        />
        <path 
          d={midPath} 
          className={midClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={midMarker}
        />
        <path 
          d={rightPath} 
          className={rightClass}
          fill="none"
          vectorEffect="non-scaling-stroke"
          markerEnd={rightMarker}
        />
        <FlowRunnerPath path={leftPath} lineClass={leftClass} duration="2.15s" delay="-0.2s" />
        <FlowRunnerPath path={midPath} lineClass={midClass} duration="1.65s" delay="-0.55s" />
        <FlowRunnerPath path={rightPath} lineClass={rightClass} duration="2.15s" delay="-0.9s" />
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
  onSelectStage,
}: {
  stage: StageName;
  index: number;
  isSelected: boolean;
  hasResult: boolean;
  status: StageStatus;
  liveState: StageLiveState;
  onSelectStage: (stage: StageName) => void;
}) {
  const meta = STAGE_META[stage];
  const Icon = meta.icon;

  return (
    <button
      className={`workflow-node-card workflow-node-${status} ${isSelected ? "is-selected" : ""} ${hasResult ? "has-result" : ""}`}
      type="button"
      onClick={() => onSelectStage(stage)}
    >
      <span className="workflow-node-icon">
        {status === "running" ? (
          <LoaderCircle className="spinner-ring-inner spin-icon" size={16} />
        ) : (
          <Icon size={16} />
        )}
      </span>
      <span className="workflow-node-copy">
        <span className="workflow-step-num">STEP 0{index + 1}</span>
        <strong>{meta.label}</strong>
        <span className="workflow-node-status-text">
          {liveState.latestMessage || meta.focus}
        </span>
      </span>
      <span className="workflow-node-state">
        {status === "running" ? (
          <span className="running-badge">
            <span className="pulse-indicator-small" />
            {formatWorkflowStatus(status, liveState.phase)}
          </span>
        ) : (
          formatWorkflowStatus(status, liveState.phase)
        )}
      </span>
    </button>
  );
});

type WorkflowTimelineProps = {
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
  onSelectStage: (stage: StageName) => void;
};

const WorkflowTimeline = memo(function WorkflowTimeline({
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
  onSelectStage,
}: WorkflowTimelineProps) {
  const getLiveState = (stage: StageName) => stageStreams[stage] ?? EMPTY_STAGE_LIVE_STATE;
  const getStatus = (stage: StageName) => stageStatus[stage];
  const hasResult = (stage: StageName) => Boolean(stagePayloads[stage]);

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
          onSelectStage={onSelectStage}
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
          onSelectStage={onSelectStage}
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
          onSelectStage={onSelectStage}
        />
        <StageWorkflowCard
          stage="interviewer_agent"
          index={3}
          isSelected={selectedStage === "interviewer_agent"}
          hasResult={hasResult("interviewer_agent")}
          status={getStatus("interviewer_agent")}
          liveState={getLiveState("interviewer_agent")}
          onSelectStage={onSelectStage}
        />
        <StageWorkflowCard
          stage="career_master_agent"
          index={4}
          isSelected={selectedStage === "career_master_agent"}
          hasResult={hasResult("career_master_agent")}
          status={getStatus("career_master_agent")}
          liveState={getLiveState("career_master_agent")}
          onSelectStage={onSelectStage}
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
          onSelectStage={onSelectStage}
        />
      </div>
    </div>
  );
}, areWorkflowTimelinePropsEqual);

function areWorkflowTimelinePropsEqual(previous: WorkflowTimelineProps, next: WorkflowTimelineProps) {
  if (previous.selectedStage !== next.selectedStage || previous.onSelectStage !== next.onSelectStage) {
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
  }, [logs.length, liveState.reasoning, liveState.output]);
  
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
          <span className="console-log-count">{logs.length} 条实时事件</span>
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
              <p className="console-placeholder-text">等待评审任务启动，此终端将输出 Agent 的流式决策、模型思考与分析数据...</p>
            ) : (
              <div className="console-logs-list">
                {logs.map((log, index) => (
                  <div key={index} className={`console-log-line log-type-${log.type || "info"}`}>
                    <span className="log-time">[{log.timestamp}]</span>
                    <span className="log-phase">[{formatPhaseLabel(log.phase)}]</span>
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))}
                
                {/* Reasoning Box */}
                {liveState.reasoning && (
                  <div className="console-stream-section reasoning-section">
                    <div className="stream-section-title">
                      <span className="stream-section-dot pulsing" />
                      <span>AI 深度协同思考链条轨迹 (Chain of Thought Trail)</span>
                    </div>
                    <pre className="stream-content">{liveState.reasoning}</pre>
                  </div>
                )}

                {/* Stream Chunks output */}
                {liveState.output && (
                  <div className="console-stream-section output-section">
                    <div className="stream-section-title">
                      <span className="stream-section-dot" />
                      <span>流式结构化输出段 (Model Raw Output Snippets)</span>
                    </div>
                    <pre className="stream-content">{liveState.output}</pre>
                  </div>
                )}
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

      <CollapsibleSection title="维度能力分解评分" defaultExpanded={false}>
        <ScoreTable items={feedback.scoreBreakdown} />
      </CollapsibleSection>

      <CollapsibleSection title="针对性逐项修改路线方案" defaultExpanded={true}>
        <SuggestionTable suggestions={feedback.suggestions} />
      </CollapsibleSection>
    </article>
  );
}

function ResumeProfilePanel({ profile }: { profile: ResumeProfile }) {
  return (
    <article className="result-panel">
      <header className="result-header">
        <div>
          <span className="eyebrow">PARSED PROFILE</span>
          <h3>{profile.candidateName || "未识别姓名"} 的解析画像</h3>
        </div>
        <div className="score-pill subtle">简历结构化抽取完成</div>
      </header>

      <MetricGrid
        rows={[
          { label: "候选人姓名", value: profile.personalInfo.name || "-" },
          { label: "年龄情况", value: profile.personalInfo.age || "-" },
          { label: "联络手机", value: profile.personalInfo.phone || "-" },
          { label: "电子邮箱", value: profile.personalInfo.email || "-" },
          { label: "意向所在地", value: profile.personalInfo.location || "-" },
          { label: "核心头衔 (Headline)", value: profile.headline || "-" },
          { label: "目标求职岗位", value: profile.targetRoles.join(" / ") || "-" },
          { label: "工作经验年限", value: profile.yearsOfExperience || "-" },
        ]}
      />

      <div className="result-columns-collapsible">
        <CollapsibleSection title="核心关键技能" defaultExpanded={true}>
          <BulletList items={profile.coreSkills} />
        </CollapsibleSection>
        <CollapsibleSection title="候选人背景摘要" defaultExpanded={true}>
          <BulletList items={profile.reasoningSummary} />
        </CollapsibleSection>
        <CollapsibleSection title="履历闪光优势" defaultExpanded={true}>
          <BulletList items={profile.strengths} />
        </CollapsibleSection>
      </div>

      <div className="result-columns-collapsible">
        <CollapsibleSection title="分类技能清单" defaultExpanded={false}>
          <BulletList items={profile.skillGroups.map((group) => `${group.category}: ${group.items.join(" / ")}`)} />
        </CollapsibleSection>
        <CollapsibleSection title="历任工作经历" defaultExpanded={true}>
          <BulletList
            items={profile.workExperiences.map(
              (item) => `${item.company} | ${item.role} | ${item.period}`.replace(/\s+\|\s+\|\s+/g, " | "),
            )}
          />
        </CollapsibleSection>
        <CollapsibleSection title="主持/参与项目经验" defaultExpanded={true}>
          <BulletList
            items={profile.projects.map(
              (item) => `${item.name} | ${item.role} | ${item.period}`.replace(/\s+\|\s+\|\s+/g, " | "),
            )}
          />
        </CollapsibleSection>
      </div>

      <div className="result-columns-collapsible">
        <CollapsibleSection title="受教育经历" defaultExpanded={false}>
          <BulletList
            items={profile.educationRecords.map(
              (item) => `${item.school} | ${item.degree} | ${item.major} | ${item.period}`.replace(
                /\s+\|\s+\|\s+/g,
                " | ",
              ),
            )}
          />
        </CollapsibleSection>
        <CollapsibleSection title="信息缺失点 / 简历漏洞" defaultExpanded={true}>
          <BulletList items={[...profile.risks, ...profile.missingInformation]} />
        </CollapsibleSection>
        <CollapsibleSection title="社交链接及作品集" defaultExpanded={false}>
          <BulletList items={profile.personalInfo.links} />
        </CollapsibleSection>
      </div>
    </article>
  );
}

function FinalReviewPanel({ result }: { result: ReviewRunResult }) {
  const finalReview = result.finalReview;

  return (
    <section className="result-stack">
      <article className="hero-metric-band">
        <div className="hero-left">
          <span className="eyebrow font-bold">EXECUTIVE SUMMARY</span>
          <h2>{finalReview.executiveSummary || "已生成全局汇总方案"}</h2>
          <p className="document-path-indicator">文件解析源: {result.document.path}</p>
        </div>
        <div className="hero-metric-tray">
          <div className="hero-metric">
            <span>综合评审得分</span>
            <strong>{finalReview.overallScore}</strong>
          </div>
          <div className="hero-metric">
            <span>简历就绪等级</span>
            <strong>{formatReadyLevel(finalReview.readyLevel)}</strong>
          </div>
          <div className="hero-metric">
            <span>协作专家数</span>
            <strong>{result.reviewerFeedback.length}</strong>
          </div>
        </div>
      </article>

      <CollapsibleSection title="最高优先级修改路线图" defaultExpanded={true}>
        <ol className="priority-list">
          {finalReview.topPriorities.length > 0 ? (
            finalReview.topPriorities.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
          ) : (
            <li>暂无优先级建议</li>
          )}
        </ol>
      </CollapsibleSection>

      <CollapsibleSection title="评分细分核心矩阵" defaultExpanded={false}>
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
      
      <CollapsibleSection title="百分制细分维度诊断表" defaultExpanded={false}>
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

  return <SummaryResultPanel payload={payload} />;
});

function ResultExplorer({
  finalResult,
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
  isSwitching,
}: {
  finalResult: ReviewRunResult | null;
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
  isSwitching: boolean;
}) {
  const meta = STAGE_META[selectedStage];
  const Icon = meta.icon;
  const liveState = stageStreams[selectedStage] ?? EMPTY_STAGE_LIVE_STATE;
  const status = stageStatus[selectedStage];

  return (
    <div className={`node-result-layout ${isSwitching ? "is-switching" : ""}`}>
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
        {/* Real-time Streaming logs & terminal console */}
        <LiveConsole 
          stage={selectedStage} 
          liveState={liveState} 
          status={status} 
        />
        
        {/* Render actual results container */}
        <div className="structured-panel-wrapper">
          {STAGE_ORDER.map((stageName) => (
            <div
              key={stageName}
              className={`stage-result-slot ${stageName === selectedStage ? "is-active" : ""}`}
              aria-hidden={stageName !== selectedStage}
            >
              <StageResultContent
                finalResult={stageName === "summary_agent" ? finalResult : null}
                payload={stagePayloads[stageName]}
                stage={stageName}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReviewStudio() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [runningStages, setRunningStages] = useState<StageName[]>([]);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [stageStatus, setStageStatus] = useState<Record<StageName, StageStatus>>(createInitialStageStatus());
  const [stageStreams, setStageStreams] = useState<Partial<Record<StageName, StageLiveState>>>({});
  const [stagePayloads, setStagePayloads] = useState<Partial<Record<StageName, unknown>>>({});
  const [finalResult, setFinalResult] = useState<ReviewRunResult | null>(null);
  const [selectedStage, setSelectedStage] = useState<StageName>("resume_loader");
  const deferredSelectedStage = useDeferredValue(selectedStage);
  const phaseTimelineRef = useRef<Partial<Record<StageName, ReviewStageProgressPhase>>>({});
  const pendingProgressEventsRef = useRef<Array<{ stage: StageName; event: ReviewStageEvent }>>([]);
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    },
    [],
  );

  const currentStageLabels = useMemo(
    () => runningStages.map((stage) => STAGE_META[stage].label),
    [runningStages],
  );
  const handleSelectStage = useCallback((stage: StageName) => {
    setSelectedStage(stage);
  }, []);

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
          setErrorMessage("流式响应解析失败，请检查模型输出格式。");
          setIsRunning(false);
          continue;
        }
        if (chunk.type === "event") {
          handleStageEvent(chunk.event);
          continue;
        }
        if (chunk.type === "result") {
          flushPendingProgressEvents();
          setFinalResult(chunk.result);
          setSelectedStage("summary_agent");
          setIsRunning(false);
          continue;
        }
        setErrorMessage(chunk.message);
        setIsRunning(false);
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
      setStageStreams((previous) => ({
        ...previous,
        [stage]: {
          ...(previous[stage] ?? createEmptyStageLiveState()),
          latestMessage: event.message,
          details: event.details,
          phase: null,
          logs: [
            {
              timestamp,
              phase: null,
              message: event.message,
              type: "info"
            }
          ]
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
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!resumeFile) {
      setErrorMessage("请先上传简历文件。");
      return;
    }

    setErrorMessage("");
    setIsRunning(true);
    setRunningStages([]);
    setTimeline([]);
    setStageStreams({});
    setStagePayloads({});
    setFinalResult(null);
    setStageStatus(createInitialStageStatus());
    setSelectedStage("resume_loader");
    phaseTimelineRef.current = {};
    pendingProgressEventsRef.current = [];
    if (progressFlushTimerRef.current) {
      clearTimeout(progressFlushTimerRef.current);
      progressFlushTimerRef.current = null;
    }

    const formData = new FormData();
    formData.append("resumeFile", resumeFile);

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        body: formData,
      });
      await handleChunkStream(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Review request failed.");
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell review-console-shell animate-fade-in">
      <header className="compact-topbar">
        <div className="topbar-brand">
          <span className="eyebrow">RESUME DIAGNOSTIC CORE</span>
          <h1>多 Agent 智能简历评审工作台</h1>
        </div>

        <form className="topbar-actions" onSubmit={handleSubmit}>
          <label className="compact-upload">
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={(event) => setResumeFile(event.currentTarget.files?.[0] ?? null)}
            />
            <Upload size={17} />
            <span>{resumeFile ? resumeFile.name : "选择简历源文件"}</span>
          </label>

          <button className="primary-action" type="submit" disabled={isRunning}>
            {isRunning ? <LoaderCircle className="spin-icon" size={17} /> : <Play size={17} />}
            {isRunning ? "专家团诊断中..." : "启动简历诊断"}
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
          <div className="pane-header">
            <div>
              <span className="eyebrow">PIPELINE WORKFLOW</span>
              <h2>评审链路流程</h2>
            </div>
            {currentStageLabels.length > 0 && (
              <span className="current-status-pulse">
                <span className="pulse-indicator" />
                正在运行: {currentStageLabels[0]}
              </span>
            )}
          </div>

          <WorkflowTimeline
            selectedStage={selectedStage}
            stagePayloads={stagePayloads}
            stageStatus={stageStatus}
            stageStreams={stageStreams}
            onSelectStage={handleSelectStage}
          />
        </aside>

        <section className="result-pane">
          <ResultExplorer
            finalResult={finalResult}
            selectedStage={deferredSelectedStage}
            stagePayloads={stagePayloads}
            stageStatus={stageStatus}
            stageStreams={stageStreams}
            isSwitching={deferredSelectedStage !== selectedStage}
          />
        </section>
      </section>
    </main>
  );
}
