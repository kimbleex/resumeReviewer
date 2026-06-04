"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  Send,
  Upload,
  Wand2,
} from "lucide-react";

type AgentStageStatus = "idle" | "running" | "done" | "failed";

type AgentToolCall = {
  id: string;
  name: string;
  status: AgentStageStatus;
  result: string;
  details: string[];
};

type AgentStage = {
  id: string;
  label: string;
  description: string;
  status: AgentStageStatus;
  summary: string;
  toolCalls: AgentToolCall[];
};

type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

const PDF_AGENT_STAGES = [
  {
    id: "read_pdf",
    label: "读取 PDF",
    description: "确认文件、版本和浏览器预览状态",
  },
  {
    id: "understand_intent",
    label: "理解修改意图",
    description: "提取用户目标并规划简历修改范围",
  },
  {
    id: "tool_calling",
    label: "调用工具",
    description: "调用文本抽取、结构规划与重写工具",
  },
  {
    id: "rewrite_content",
    label: "修改内容",
    description: "按岗位目标压缩、强化或重写内容",
  },
  {
    id: "adjust_style",
    label: "调整样式",
    description: "校准版式密度、标题层级和可读性",
  },
  {
    id: "render_pdf",
    label: "生成 PDF",
    description: "生成新版本并准备替换预览",
  },
  {
    id: "refresh_preview",
    label: "刷新预览",
    description: "更新左侧浏览器 PDF 预览",
  },
] as const;

function createInitialAgentStages(): AgentStage[] {
  return PDF_AGENT_STAGES.map((stage) => ({
    ...stage,
    status: "idle",
    summary: "等待执行",
    toolCalls: [],
  }));
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function makeMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createToolCall(stageId: string, prompt: string): AgentToolCall | null {
  const shortPrompt = prompt.length > 42 ? `${prompt.slice(0, 42)}...` : prompt;

  if (stageId === "tool_calling") {
    return {
      id: "extract_resume_text",
      name: "extract_resume_text",
      status: "done",
      result: "已抽取关键段落，准备结构化修改。",
      details: ["识别到教育、项目、经历和技能区块。", "仅保留精简摘要，避免在前端保存大段原文。"],
    };
  }

  if (stageId === "rewrite_content") {
    return {
      id: "rewrite_resume_section",
      name: "rewrite_resume_section",
      status: "done",
      result: `围绕“${shortPrompt}”生成修改草案。`,
      details: ["突出可量化成果和岗位关键词。", "默认保持 PDF 当前版式，等待后端渲染接口接入。"],
    };
  }

  if (stageId === "render_pdf") {
    return {
      id: "render_pdf",
      name: "render_pdf",
      status: "done",
      result: "PDF 渲染接口已预留，当前版本复用本地预览。",
      details: ["后端返回新 PDF Blob 后会替换当前预览地址。", "下载按钮始终指向当前最新预览。"],
    };
  }

  return null;
}

function stageDoneSummary(stageId: string) {
  switch (stageId) {
    case "read_pdf":
      return "PDF 已载入，预览可用。";
    case "understand_intent":
      return "已拆解修改目标和影响范围。";
    case "tool_calling":
      return "工具调用完成。";
    case "rewrite_content":
      return "内容修改草案已生成。";
    case "adjust_style":
      return "样式调整策略已确认。";
    case "render_pdf":
      return "新版本生成步骤完成。";
    case "refresh_preview":
      return "预览已刷新。";
    default:
      return "阶段完成。";
  }
}

const AgentStageRow = memo(function AgentStageRow({ stage }: { stage: AgentStage }) {
  const isRunning = stage.status === "running";
  const isDone = stage.status === "done";
  const isFailed = stage.status === "failed";

  return (
    <article className={`agent-stage-row agent-stage-${stage.status}`}>
      <div className="agent-stage-marker" aria-hidden="true">
        {isRunning ? (
          <LoaderCircle className="agent-stage-spinner" size={15} />
        ) : isDone ? (
          <CheckCircle2 size={15} />
        ) : isFailed ? (
          <AlertCircle size={15} />
        ) : (
          <ChevronRight size={15} />
        )}
      </div>
      <div className="agent-stage-body">
        <div className="agent-stage-heading">
          <strong>{stage.label}</strong>
          <span>{stage.description}</span>
        </div>
        <p>{stage.summary}</p>
        {stage.toolCalls.length > 0 ? (
          <div className="agent-tool-list">
            {stage.toolCalls.map((tool) => (
              <details className="agent-tool-call" key={tool.id}>
                <summary>
                  <span>{tool.name}</span>
                  <em>{tool.result}</em>
                </summary>
                <div className="agent-tool-result">
                  <strong>精简结果</strong>
                  {tool.details.map((detail) => (
                    <span key={detail}>{detail}</span>
                  ))}
                </div>
              </details>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
});

export function PdfAgentWorkbench() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");
  const [pdfPreviewVersion, setPdfPreviewVersion] = useState(0);
  const [pdfFrameKey, setPdfFrameKey] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "上传 PDF 后，可以直接告诉我想改内容、风格、密度或岗位匹配方向。",
      createdAt: formatTime(),
    },
  ]);
  const [agentStages, setAgentStages] = useState<AgentStage[]>(createInitialAgentStages);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState("");
  const objectUrlRef = useRef("");
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      timersRef.current.forEach((timer) => clearTimeout(timer));
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const wait = useCallback(
    (duration: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timersRef.current = timersRef.current.filter((item) => item !== timer);
          resolve();
        }, duration);
        timersRef.current.push(timer);
      }),
    [],
  );

  const downloadName = useMemo(() => {
    if (!pdfFile) {
      return "resume-agent-version.pdf";
    }
    const baseName = pdfFile.name.replace(/\.pdf$/i, "");
    return `${baseName}-agent-v${Math.max(pdfPreviewVersion, 1)}.pdf`;
  }, [pdfFile, pdfPreviewVersion]);

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
    setAgentStages(createInitialAgentStages());
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

  const updateStage = useCallback((stageId: string, patch: Partial<AgentStage>) => {
    setAgentStages((currentStages) =>
      currentStages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage)),
    );
  }, []);

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

      clearTimers();
      setAgentError("");
      setIsAgentRunning(true);
      setPrompt("");
      setAgentStages(createInitialAgentStages());
      setAgentMessages((messages) => [
        ...messages,
        {
          id: makeMessageId(),
          role: "user",
          text: trimmedPrompt,
          createdAt: formatTime(),
        },
      ]);

      try {
        for (const stage of PDF_AGENT_STAGES) {
          if (!isMountedRef.current) {
            return;
          }
          updateStage(stage.id, {
            status: "running",
            summary: "正在执行...",
            toolCalls: [],
          });
          await wait(280);
          const toolCall = createToolCall(stage.id, trimmedPrompt);
          updateStage(stage.id, {
            status: "done",
            summary: stageDoneSummary(stage.id),
            toolCalls: toolCall ? [toolCall] : [],
          });
        }

        if (!isMountedRef.current) {
          return;
        }

        setPdfPreviewVersion((version) => version + 1);
        setPdfFrameKey((current) => current + 1);
        setLastUpdatedAt(formatTime());
        setAgentMessages((messages) => [
          ...messages,
          {
            id: makeMessageId(),
            role: "assistant",
            text: "已完成本轮修改流程。当前版本仍使用本地 PDF 预览，后端生成接口接入后会自动替换为新文件。",
            createdAt: formatTime(),
          },
        ]);
      } catch {
        updateStage(PDF_AGENT_STAGES[0].id, {
          status: "failed",
          summary: "执行失败，请重试。",
        });
        setAgentError("Agent 执行失败，请稍后重试。");
      } finally {
        if (isMountedRef.current) {
          setIsAgentRunning(false);
        }
      }
    },
    [clearTimers, isAgentRunning, pdfFile, pdfPreviewUrl, prompt, updateStage, wait],
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
              <FileText size={36} />
              <strong>上传 PDF 后立即在这里预览</strong>
              <span>左侧使用浏览器原生 PDF 查看器，刷新和下载都会指向当前版本。</span>
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
            <span className="panel-kicker">AGENT CONSOLE</span>
            <h2>对话修改</h2>
          </div>
          <span className={`agent-run-state ${isAgentRunning ? "is-running" : ""}`}>
            {isAgentRunning ? <LoaderCircle className="agent-stage-spinner" size={14} /> : <Bot size={14} />}
            {isAgentRunning ? "执行中" : "就绪"}
          </span>
        </div>

        {agentError ? (
          <div className="pdf-agent-error" role="alert">
            <AlertCircle size={15} />
            {agentError}
          </div>
        ) : null}

        <div className="agent-message-list" aria-label="Agent 对话记录">
          {agentMessages.map((message) => (
            <div className={`agent-message agent-message-${message.role}`} key={message.id}>
              <span>{message.role === "user" ? "你" : "Agent"} · {message.createdAt}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>

        <div className="agent-stage-list" aria-label="Agent 执行阶段">
          {agentStages.map((stage) => (
            <AgentStageRow key={stage.id} stage={stage} />
          ))}
        </div>

        <form className="agent-prompt-form" onSubmit={handleSendPrompt}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            placeholder="例如：把项目经历改得更偏后端架构，并压缩成更适合两页的表达。"
            rows={3}
            disabled={isAgentRunning}
          />
          <button type="submit" disabled={isAgentRunning}>
            {isAgentRunning ? <LoaderCircle className="agent-stage-spinner" size={16} /> : <Send size={16} />}
            发送
          </button>
        </form>

        <div className="agent-runtime-note">
          <Wand2 size={14} />
          <span>当前为前端执行流，真实 PDF 生成接口接入后会自动替换预览文件。</span>
        </div>
      </aside>
    </section>
  );
}
