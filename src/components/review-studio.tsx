"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  FilePenLine,
  FileText,
  GitBranch,
  LoaderCircle,
  Pencil,
  Play,
  Upload,
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
import { REVIEW_STAGE_ORDER as STAGE_ORDER, createInitialStageStatus } from "@/lib/review/stages";
import {
  STAGE_META,
  createEmptyStageLiveState,
  formatPhaseLabel,
  isRecord,
  isStageName,
  type StageLiveState,
  type StageLogEntry,
  type StageName,
  type StageStatus,
} from "@/components/review-studio-shared";
import { PdfAgentWorkbench } from "@/components/pdf-agent-workbench";
import { WorkflowTimeline } from "@/components/workflow-timeline";
import { LlmConfigMenu } from "@/components/llm-config-menu";
import { appendLlmConfigToFormData } from "@/lib/llm/config";
import { readRequiredLlmConfig } from "@/lib/llm/storage";

// Result panels (incl. html2pdf export + heavy lucide icons) are only needed
// once a stage-detail drawer is opened, so load them in a separate chunk.
const StageDetailDrawer = dynamic(() => import("@/components/review-stage-detail"), {
  ssr: false,
});

function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getStagesToReset(startStage: StageName): StageName[] {
  const parallelReviewers: StageName[] = ["hr_agent", "interviewer_agent", "career_master_agent"];

  if (startStage === "resume_loader") {
    return [...STAGE_ORDER];
  } else if (startStage === "resume_parser") {
    return STAGE_ORDER.slice(1);
  } else if (startStage === "scoring_agent") {
    return STAGE_ORDER.slice(2);
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
    message: [event.message, ...event.details].join(" · "),
    type: "info",
    callId: event.callId,
    callLabel: event.callLabel,
  };

  const prevLogs = current.logs || [];
  let updatedLogs = [...prevLogs];
  const lastLog = prevLogs[prevLogs.length - 1];

  if (lastLog && lastLog.callId === newLog.callId && lastLog.phase === newLog.phase && lastLog.message === newLog.message) {
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
        callId: typeof log.callId === "string" ? log.callId : undefined,
        callLabel: typeof log.callLabel === "string" ? log.callLabel : undefined,
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

export function ReviewStudio() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [cachedResumeFileName, setCachedResumeFileName] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [targetRole, setTargetRole] = useState("");
  const [targetDescription, setTargetDescription] = useState("");
  const [targetRoleDraft, setTargetRoleDraft] = useState("");
  const [targetDescriptionDraft, setTargetDescriptionDraft] = useState("");
  const [isTargetJobOpen, setIsTargetJobOpen] = useState(false);
  const [inputError, setInputError] = useState<"resume" | "target" | null>(null);
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
  const phaseTimelineRef = useRef<Partial<Record<StageName, ReviewStageProgressPhase>>>({});
  const pendingProgressEventsRef = useRef<Array<{ stage: StageName; event: ReviewStageEvent }>>([]);
  const progressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const runningStagesRef = useRef<StageName[]>([]);
  const selectedStageRef = useRef<StageName>("resume_loader");
  const hasLocalCheckpoint = hasReusableReviewState(stagePayloads);
  const canResumeLocalRun = Boolean(currentRunId && hasLocalCheckpoint && !finalResult);
  const uploadLabel = resumeFile ? resumeFile.name : cachedResumeFileName || "点击选择简历文件";
  const uploadHint = resumeFile
    ? `${formatFileSize(resumeFile.size)} · 点击更换`
    : cachedResumeFileName
      ? "本地断点 · 可直接继续"
      : "PDF / DOCX / MD / TXT";
  const targetJobHint = !targetRole
    ? "必填 · 评分以此为基准"
    : targetDescription.trim()
      ? `已附 JD · ${targetDescription.trim().length} 字`
      : "未附 JD · 按岗位名称推断";
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

    void loadLocalReviewRun()
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

        const restoredStatus = interruptRunningStages(snapshot.stageStatus);

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
  }, []);

  useEffect(() => {
    if (!currentRunId) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      const snapshot: LocalReviewRunSnapshot = {
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
    resumeFile?.name,
    stagePayloads,
    stageStatus,
    stageStreams,
    targetDescription,
    targetRole,
  ]);

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
    if (isRunning) return;
    const nextRole = targetRoleDraft.trim();
    if (!nextRole) {
      setInputError("target");
      return;
    }

    if (nextRole !== targetRole || targetDescriptionDraft.trim() !== targetDescription) {
      const resetStages = getStagesToReset("scoring_agent");
      setStagePayloads((previous) => Object.fromEntries(Object.entries(previous).filter(([stage]) => !resetStages.includes(stage as StageName))));
      setStageStreams((previous) => Object.fromEntries(Object.entries(previous).filter(([stage]) => !resetStages.includes(stage as StageName))));
      setStageStatus((previous) => ({ ...previous, ...Object.fromEntries(resetStages.map((stage) => [stage, "pending"])) }));
      setFinalResult(null);
    }
    setTargetRole(nextRole);
    setTargetDescription(targetDescriptionDraft.trim());
    setIsTargetJobOpen(false);
    setInputError(null);
    setErrorMessage("");
  }, [isRunning, targetDescription, targetDescriptionDraft, targetRole, targetRoleDraft]);

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
          setStageStatus((previous) => failRunningStages(previous));
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
          continue;
        }
        receivedTerminalChunk = true;
        flushPendingProgressEvents();
        appendTerminalError(chunk.message);
        setStageStatus((previous) => failRunningStages(previous));
        setErrorMessage(chunk.message);
        setIsRunning(false);
        requestAbortControllerRef.current = null;
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

    if (event.kind === "stage_checkpoint" && stage && event.payload) {
      flushPendingProgressEvents();
      setStagePayloads((previous) => ({ ...previous, [stage]: event.payload }));
      setStageStreams((previous) => applyStageProgressEvent(previous, stage, event));
      return;
    }

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
    setStageStatus((previous) => interruptRunningStages(previous));
    setIsRunning(false);
    setErrorMessage("已中断诊断，可点击继续诊断从本地断点重试。");
  }, [flushPendingProgressEvents]);

  const executeReview = useCallback(async (opts: {
    payloads: Partial<Record<StageName, unknown>>;
    status: Record<StageName, StageStatus>;
    finalResult: ReviewRunResult | null;
    startStage: StageName;
  }) => {
    const llmConfigCheck = readRequiredLlmConfig();
    if (!llmConfigCheck.ok) {
      setErrorMessage(llmConfigCheck.message);
      return;
    }

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
    appendLlmConfigToFormData(formData, llmConfigCheck.config);
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
        wasAborted ? interruptRunningStages(previous) : failRunningStages(previous),
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

    const llmConfigCheck = readRequiredLlmConfig();
    if (!llmConfigCheck.ok) {
      setErrorMessage(llmConfigCheck.message);
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
    targetRole,
    targetDescription,
    stagePayloads,
    stageStatus,
    stageStreams,
    finalResult,
    isRunning,
    executeReview
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const isResumingLocalRun = canResumeLocalRun;

    if (!resumeFile && !isResumingLocalRun) {
      setInputError("resume");
      return;
    }
    if (!targetRole.trim()) {
      setInputError("target");
      setTargetRoleDraft(targetRole);
      setTargetDescriptionDraft(targetDescription);
      setIsTargetJobOpen(true);
      return;
    }
    setInputError(null);

    const llmConfigCheck = readRequiredLlmConfig();
    if (!llmConfigCheck.ok) {
      setErrorMessage(llmConfigCheck.message);
      return;
    }

    let startStage: StageName = "resume_loader";
    let nextPayloads = { ...stagePayloads };
    let nextStatus = { ...stageStatus };
    let nextFinalResult = finalResult;

    if (isResumingLocalRun) {
      startStage = firstActiveStage(stageStatus);
      nextStatus = interruptRunningStages(stageStatus);
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

  const hasResumeSource = Boolean(resumeFile || cachedResumeFileName);
  const isResumeMissing = inputError === "resume" && !hasResumeSource;
  const isTargetMissing = inputError === "target" && !targetRole;
  const workflowSetupNode = (
    <div className="workflow-canvas-controls flowchart-step-row full-width-row">
      <span className={`workflow-input-frame ${isInputReady ? "is-ready" : ""}`} aria-hidden="true">
        <span className="workflow-input-frame-label">
          INPUT
          <i>{isInputReady ? "配置完成" : `${Number(hasResumeSource) + Number(Boolean(targetRole))}/2 已配置`}</i>
        </span>
      </span>

      <div
        className={`workflow-setup-panel workflow-node-card workflow-input-node workflow-resume-card ${
          hasResumeSource ? "workflow-node-done" : "is-selected"
        } ${isResumeMissing ? "is-invalid" : ""}`}
      >
        <div className="workflow-setup-header">
          <span className="workflow-node-content">
            <span className="workflow-node-kicker">INPUT 01</span>
            <strong>Resume</strong>
            <span className="workflow-node-status-text">上传待诊断的简历</span>
          </span>

          <form className="workflow-start-panel" onSubmit={handleSubmit}>
            <button
              className="workflow-start-action"
              type="submit"
              disabled={isRunning}
              aria-label={primaryActionLabel}
              title={primaryActionLabel}
            >
              {isRunning ? <LoaderCircle className="spin-icon" size={16} /> : <Play size={14} />}
              <span>{primaryActionLabel}</span>
            </button>
          </form>
        </div>

        <div className="workflow-setup-form">
          <label className={`compact-upload ${hasResumeSource ? "is-filled" : ""}`} title={uploadLabel}>
            <input
              type="file"
              disabled={isRunning}
              accept=".txt,.md,.pdf,.docx"
              onChange={(event) => {
                const nextFile = event.currentTarget.files?.[0] ?? null;
                setResumeFile(nextFile);
                if (nextFile) {
                  setCachedResumeFileName(nextFile.name);
                  setCurrentRunId(null);
                  setStagePayloads({});
                  setStageStatus(createInitialStageStatus());
                  setStageStreams({});
                  setFinalResult(null);
                  setInputError(null);
                  setErrorMessage("");
                }
              }}
            />
            <span className="setup-tile-icon">
              {hasResumeSource ? <FileText size={16} /> : <Upload size={16} />}
            </span>
            <span className="setup-tile-text">
              <span className="setup-tile-value">{uploadLabel}</span>
              <span className="setup-tile-hint">{isResumeMissing ? "必填 · 尚未上传" : uploadHint}</span>
            </span>
            {hasResumeSource ? (
              <span className="target-job-icon-badge" title="已上传">
                <CheckCircle2 size={10} />
              </span>
            ) : null}
          </label>
        </div>
      </div>

      <div
        className={`workflow-setup-panel workflow-node-card workflow-target-card ${
          targetRole ? "workflow-node-done" : hasResumeSource ? "is-selected" : ""
        } ${isTargetMissing ? "is-invalid" : ""}`}
      >
        <div className="workflow-setup-header">
          <span className="workflow-node-content">
            <span className="workflow-node-kicker">INPUT 02</span>
            <strong>Target Job</strong>
            <span className="workflow-node-status-text">填写目标岗位信息</span>
          </span>
        </div>

        <div className="workflow-setup-form">
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
              <span className="setup-tile-icon">
                <BriefcaseBusiness size={16} />
              </span>
              <span className="setup-tile-text">
                <span className="target-job-label setup-tile-value">{targetRole || "填写目标岗位"}</span>
                <span className="setup-tile-hint">{isTargetMissing ? "必填 · 尚未填写" : targetJobHint}</span>
              </span>
              {targetRole ? (
                <span className="target-job-icon-badge" title="已配置">
                  <CheckCircle2 size={10} />
                </span>
              ) : (
                <Pencil className="setup-tile-action" size={13} />
              )}
            </button>

            {isTargetJobOpen ? (
              <div className="target-job-popover" role="dialog" aria-label="目标岗位配置">
                <label className={`target-job-popover-field ${isTargetMissing ? "is-invalid" : ""}`}>
                  <span>
                    岗位名称 <em className="target-job-required">*</em>
                  </span>
                  <input
                    type="text"
                    value={targetRoleDraft}
                    onChange={(event) => {
                      setTargetRoleDraft(event.currentTarget.value);
                      if (event.currentTarget.value.trim()) {
                        setInputError(null);
                      }
                    }}
                    placeholder="例如：AI Agent 平台工程师"
                    disabled={isRunning}
                    aria-invalid={isTargetMissing}
                    autoFocus
                  />
                  {isTargetMissing ? (
                    <small className="target-job-field-error">
                      <AlertCircle size={12} />
                      必须填写目标岗位，评分与改写都以它为基准
                    </small>
                  ) : null}
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

        <LlmConfigMenu />
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
              hasResume={hasResumeSource}
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
