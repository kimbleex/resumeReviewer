import {
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  Cpu,
  Edit,
  FileText,
  Sparkles,
} from "lucide-react";

import type {
  ReviewRunResult,
  ReviewStageProgressPhase,
  RevisionSuggestion,
} from "@/lib/review/schemas";
import { REVIEW_STAGE_ORDER, type ReviewStageName, type ReviewStageStatus } from "@/lib/review/stages";

export type StageName = ReviewStageName;
export type StageStatus = ReviewStageStatus;

export type StageLogEntry = {
  timestamp: string;
  phase: ReviewStageProgressPhase | null;
  message: string;
  type?: "info" | "success" | "error";
  callId?: string;
  callLabel?: string;
};

export type StageLiveState = {
  phase: ReviewStageProgressPhase | null;
  latestMessage: string;
  details: string[];
  logs?: StageLogEntry[];
};

export const STAGE_META: Record<
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
  scoring_agent: {
    label: "评分",
    focus: "一次完成三视角评分，立即展示加权结果",
    icon: CheckCircle2,
  },
  hr_agent: {
    label: "HR Agent",
    focus: "基于已出评分，补充招聘与 ATS 建议",
    icon: BriefcaseBusiness,
  },
  interviewer_agent: {
    label: "Interviewer Agent",
    focus: "基于已出评分，补充技术证据与面试建议",
    icon: Cpu,
  },
  career_master_agent: {
    label: "Career Master Agent",
    focus: "基于已出评分，补充定位与差异化建议",
    icon: Sparkles,
  },
  summary_agent: {
    label: "Summary",
    focus: "去重整合，输出最多5项修改行动",
    icon: CheckCircle2,
  },
  rewrite_agent: {
    label: "Rewrite",
    focus: "智能简历全方位深度改写",
    icon: Edit,
  },
};

export function createEmptyStageLiveState(): StageLiveState {
  return {
    phase: null,
    latestMessage: "",
    details: [],
    logs: [],
  };
}

export const EMPTY_STAGE_LIVE_STATE: StageLiveState = createEmptyStageLiveState();

export function isStageName(value: string): value is StageName {
  return REVIEW_STAGE_ORDER.includes(value as StageName);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatStageLabel(value: string): string {
  return isStageName(value) ? STAGE_META[value].label : value.replace(/_/g, " ");
}

/** 与 readyLevel 一致的分数档位：80+ 强、65-79 有潜力、<65 需重写。 */
export function scoreLevel(score: number): "high" | "mid" | "low" {
  return score >= 80 ? "high" : score >= 65 ? "mid" : "low";
}

export function formatReadyLevel(value: ReviewRunResult["finalReview"]["readyLevel"]): string {
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

export function formatPriority(value: RevisionSuggestion["priority"]): string {
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

export function formatPhaseLabel(phase: ReviewStageProgressPhase | null): string {
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

export function formatWorkflowStatus(status: StageStatus, phase: ReviewStageProgressPhase | null): string {
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
