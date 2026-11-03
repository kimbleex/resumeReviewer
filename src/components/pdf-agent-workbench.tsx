"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  Send,
  Upload,
} from "lucide-react";

import type { ParsedResumeMemory, ResumeAgentEvent } from "@/lib/agents/resume-chat";
import { appendLlmConfigToFormData } from "@/lib/llm/config";
import { readRequiredLlmConfig } from "@/lib/llm/storage";

type TraceStepStatus = "running" | "done" | "failed";

type TraceStep = {
  id: string;
  tag: "agent" | "model";
  title: string;
  detail?: string;
  status: TraceStepStatus;
};

type AgentTurnStatus = "running" | "done" | "failed";

type AgentTurn = {
  id: string;
  prompt: string;
  createdAt: string;
  steps: TraceStep[];
  answer: string;
  citation: string;
  status: AgentTurnStatus;
  error: string;
};


function formatTime(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const TRACE_TAG_LABEL: Record<TraceStep["tag"], string> = {
  agent: "agent",
  model: "model",
};

const AgentTraceStep = memo(function AgentTraceStep({ step }: { step: TraceStep }) {
  const isRunningToolCall = step.status === "running" && step.id.startsWith("tool-");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const runningToolDetail =
    step.id === "tool-read-resume-pdf" ? `正在解析 PDF，已运行 ${elapsedSeconds} 秒` : `已运行 ${elapsedSeconds} 秒`;
  const detailText = isRunningToolCall ? runningToolDetail : step.detail;

  useEffect(() => {
    if (!isRunningToolCall) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunningToolCall, step.id]);

  return (
    <div className={`agent-trace-step is-${step.status}`}>
      <span className="agent-trace-icon" aria-hidden="true">
        {step.status === "running" ? (
          <LoaderCircle className="agent-stage-spinner" size={15} />
        ) : step.status === "failed" ? (
          <AlertCircle size={15} />
        ) : (
          <CheckCircle2 size={15} />
        )}
      </span>
      <div className="agent-trace-body">
        <div className="agent-trace-line">
          <span className={`agent-trace-tag tag-${step.tag}`}>{TRACE_TAG_LABEL[step.tag]}</span>
          <strong className="agent-trace-title">{step.title}</strong>
        </div>
        {detailText ? <code className="agent-trace-detail">{detailText}</code> : null}
      </div>
    </div>
  );
});

const AgentTurnView = memo(function AgentTurnView({ turn }: { turn: AgentTurn }) {
  const showAnswer = turn.answer.length > 0 || turn.status === "done";

  return (
    <div className="agent-turn">
      <div className="agent-chat-message agent-chat-message-user">
        <span>xjl · {turn.createdAt}</span>
        <p>{turn.prompt}</p>
      </div>

      {turn.steps.map((step) => (
        <AgentTraceStep key={step.id} step={step} />
      ))}

      {turn.error ? (
        <div className="pdf-agent-error" role="alert">
          <AlertCircle size={15} />
          {turn.error}
        </div>
      ) : null}

      {showAnswer ? (
        <div className="agent-answer">
          <div className="agent-answer-head">
            <span className="agent-answer-avatar">RA</span>
            {turn.citation ? <span className="agent-answer-citation">{turn.citation}</span> : null}
          </div>
          <div className="agent-answer-body">
            <p>{turn.answer || (turn.status === "running" ? "正在生成回答…" : "")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
});

export function PdfAgentWorkbench() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [pdfPreviewVersion, setPdfPreviewVersion] = useState(0);
  const [pdfFrameKey, setPdfFrameKey] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [parsedResumeCache, setParsedResumeCache] = useState<ParsedResumeMemory | null>(null);
  const objectUrlRef = useRef("");
  const isMountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const resizePromptTextarea = useCallback(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 82);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 82 ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    resizePromptTextarea();
  }, [prompt, resizePromptTextarea]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [turns]);

  const downloadName = useMemo(() => {
    if (!pdfFile) {
      return "resume-agent-version.pdf";
    }
    const baseName = pdfFile.name.replace(/\.pdf$/i, "");
    return `${baseName}-agent-v${Math.max(pdfPreviewVersion, 1)}.pdf`;
  }, [pdfFile, pdfPreviewVersion]);

  const updateTurn = useCallback((turnId: string, updater: (turn: AgentTurn) => AgentTurn) => {
    setTurns((current) => current.map((turn) => (turn.id === turnId ? updater(turn) : turn)));
  }, []);

  const promptPlaceholder = useMemo(() => {
    if (!isAgentRunning) {
      return "输入简历修改要求";
    }

    const latestTurn = turns[turns.length - 1];
    const runningStep = latestTurn?.steps.find((step) => step.status === "running");
    if (runningStep?.id === "tool-read-resume-pdf") {
      return "正在解析 PDF...";
    }
    if (runningStep?.id === "generating") {
      return "正在汇总最终输出...";
    }
    return "Agent 正在处理...";
  }, [isAgentRunning, turns]);

  const handlePdfUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    const isPdf = nextFile.type === "application/pdf" || nextFile.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setAgentError("请上传 PDF 文件。");
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const nextUrl = URL.createObjectURL(nextFile);
    objectUrlRef.current = nextUrl;
    setPdfFile(nextFile);
    setPdfPreviewUrl(nextUrl);
    setPdfPreviewVersion(1);
    setPdfFrameKey((current) => current + 1);
    setLastUpdatedAt(formatTime());
    setAgentError("");
    setParsedResumeCache(null);
    setTurns([]);
  }, []);

  const handleRefreshPreview = useCallback(() => {
    if (!pdfPreviewUrl) {
      setAgentError("请先上传 PDF。");
      return;
    }
    setPdfFrameKey((current) => current + 1);
    setLastUpdatedAt(formatTime());
    setAgentError("");
  }, [pdfPreviewUrl]);

  const handleClearAgent = useCallback(() => {
    if (isAgentRunning) {
      return;
    }

    setAgentError("");
    setPrompt("");
    setTurns([]);
    requestAnimationFrame(resizePromptTextarea);
  }, [isAgentRunning, resizePromptTextarea]);

  const handleSendPrompt = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmedPrompt = prompt.trim();
      if (!pdfPreviewUrl || !pdfFile) {
        setAgentError("请先上传 PDF 文件。");
        return;
      }
      if (!trimmedPrompt) {
        setAgentError("请输入你希望 Agent 修改的内容。");
        return;
      }
      if (isAgentRunning) {
        return;
      }
      const llmConfigCheck = readRequiredLlmConfig();
      if (!llmConfigCheck.ok) {
        setAgentError(llmConfigCheck.message);
        return;
      }

      setAgentError("");
      setIsAgentRunning(true);
      setPrompt("");

      const turnId = makeId();
      setTurns((current) => [
        ...current,
        {
          id: turnId,
          prompt: trimmedPrompt,
          createdAt: formatTime(),
          steps: [
            {
              id: "reading",
              tag: "agent",
              title: "模型提取用户问题",
              status: "running",
            },
          ],
          answer: "",
          citation: "",
          status: "running",
          error: "",
        },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      const applyEvent = (eventPayload: ResumeAgentEvent) => {
        if (!isMountedRef.current) {
          return;
        }
        if (eventPayload.type === "resume-cache") {
          setParsedResumeCache(eventPayload.parsedResume);
          return;
        }

        updateTurn(turnId, (turn) => {
          switch (eventPayload.type) {
            case "step": {
              const nextStep: TraceStep = {
                id: eventPayload.id,
                tag: eventPayload.tag,
                title: eventPayload.title,
                detail: eventPayload.detail,
                status: eventPayload.status,
              };
              const existingIndex = turn.steps.findIndex((step) => step.id === eventPayload.id);
              const steps =
                existingIndex >= 0
                  ? turn.steps.map((step, index) =>
                      index === existingIndex && !(step.status === "done" && nextStep.status === "running")
                        ? nextStep
                        : step,
                    )
                  : [...turn.steps, nextStep];
              return { ...turn, steps };
            }
            case "answer-delta":
              return { ...turn, answer: turn.answer + eventPayload.text };
            case "done":
              return {
                ...turn,
                citation: eventPayload.citation,
                status: "done",
                steps: turn.steps.map((step) =>
                  step.status === "running" ? { ...step, status: "done" } : step,
                ),
              };
            case "error":
              return {
                ...turn,
                status: "failed",
                error: eventPayload.message,
                steps: turn.steps.map((step) =>
                  step.status === "running" ? { ...step, status: "failed" } : step,
                ),
              };
            default:
              return turn;
          }
        });
      };

      try {
        const formData = new FormData();
        formData.append("prompt", trimmedPrompt);
        appendLlmConfigToFormData(formData, llmConfigCheck.config);
        if (parsedResumeCache && parsedResumeCache.fileName === pdfFile.name) {
          formData.append("parsedResumeFileName", parsedResumeCache.fileName);
          formData.append("parsedResumeCharCount", String(parsedResumeCache.charCount));
          formData.append("parsedResumeContent", parsedResumeCache.content);
        } else {
          formData.append("pdfFile", pdfFile);
        }

        const response = await fetch("/api/pdf-agent", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`请求失败（${response.status}）`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) {
              try {
                applyEvent(JSON.parse(line) as ResumeAgentEvent);
              } catch {
                // 跳过无法解析的行，保持流式继续。
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (isMountedRef.current) {
          updateTurn(turnId, (turn) => (turn.status === "running" ? { ...turn, status: "done" } : turn));
        }
      } catch (error) {
        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Agent 执行失败，请稍后重试。";
        updateTurn(turnId, (turn) => ({ ...turn, status: "failed", error: message }));
        setAgentError(message);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (isMountedRef.current) {
          setIsAgentRunning(false);
        }
      }
    },
    [isAgentRunning, parsedResumeCache, pdfFile, pdfPreviewUrl, prompt, updateTurn],
  );

  return (
    <section className="pdf-agent-workbench" aria-label="Agent 改简历工作台">
      <section className="pdf-preview-panel">
        <div className="pdf-preview-header">
          <div>
            <span className="panel-kicker">LIVE PDF PREVIEW</span>
            <h2>浏览器实时预览</h2>
          </div>
          <label className="pdf-upload-button">
            <input type="file" accept="application/pdf,.pdf" onChange={handlePdfUpload} />
            <Upload size={16} />
            <span>上传 PDF</span>
          </label>
        </div>

        <div className="pdf-preview-surface">
          {pdfPreviewUrl ? (
            <iframe
              key={pdfFrameKey}
              className="pdf-preview-frame"
              src={pdfPreviewUrl}
              title={pdfFile?.name ?? "PDF 预览"}
            />
          ) : (
            <div className="pdf-empty-state">
              <FileText size={26} />
              <strong>上传 PDF 后立即在这里预览</strong>
            </div>
          )}
        </div>

        <footer className="pdf-preview-toolbar">
          <div className="pdf-version-meta">
            <strong>{pdfFile?.name ?? "尚未选择文件"}</strong>
            <span>
              v{Math.max(pdfPreviewVersion, 1)} {lastUpdatedAt ? `· 更新于 ${lastUpdatedAt}` : "· 等待上传"}
            </span>
          </div>
          <div className="pdf-preview-actions">
            <button type="button" onClick={handleRefreshPreview} disabled={!pdfPreviewUrl}>
              <RefreshCw size={15} />
              <span>刷新预览</span>
            </button>
            <a
              className={!pdfPreviewUrl ? "is-disabled" : ""}
              href={pdfPreviewUrl || undefined}
              download={downloadName}
              aria-disabled={!pdfPreviewUrl}
            >
              <Download size={15} />
              <span>下载 PDF</span>
            </a>
          </div>
        </footer>
      </section>

      <aside className="pdf-agent-panel">
        <div className="pdf-agent-header">
          <div>
            <div className="pdf-agent-title-row">
              <h2>RA</h2>
              <span className={`agent-run-state ${isAgentRunning ? "is-running" : ""}`}>
                {isAgentRunning ? <LoaderCircle className="agent-stage-spinner" size={14} /> : <Bot size={14} />}
                {isAgentRunning ? "运行中" : "就绪"}
              </span>
            </div>
            <p>Resume Assistant Agent</p>
          </div>
          <button type="button" className="agent-clear-button" onClick={handleClearAgent} disabled={isAgentRunning}>
            清空
          </button>
        </div>

        <div className="agent-conversation-scroll" ref={scrollRef} aria-label="Agent 对话和执行过程">
          {agentError && turns.length === 0 ? (
            <div className="pdf-agent-error" role="alert">
              <AlertCircle size={15} />
              {agentError}
            </div>
          ) : null}

          {turns.length === 0 && !agentError ? (
            <div className="agent-empty-hint">
              <Bot size={26} />
              <strong>告诉 RA 你想怎么改这份简历</strong>
            </div>
          ) : null}

          {turns.map((turn) => (
            <AgentTurnView key={turn.id} turn={turn} />
          ))}
        </div>

        <form className="agent-prompt-form" onSubmit={handleSendPrompt}>
          <div className="agent-prompt-shell">
            <textarea
              ref={promptTextareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              aria-label="输入简历修改要求"
              placeholder={promptPlaceholder}
              rows={1}
              disabled={isAgentRunning}
            />
            <button type="submit" className="agent-send-button" disabled={isAgentRunning}>
              {isAgentRunning ? <LoaderCircle className="agent-stage-spinner" size={16} /> : <Send size={16} />}
              发送
            </button>
          </div>
        </form>
      </aside>
    </section>
  );
}
