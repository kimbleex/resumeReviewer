"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDot,
  Cpu,
  FileText,
  LoaderCircle,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";

import {
  finalResumeReviewSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  reviewStreamChunkSchema,
  type FinalResumeReview,
  type ResumeProfile,
  type ReviewRunResult,
  type ReviewStageEvent,
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

const STAGE_META: Record<
  StageName,
  { label: string; focus: string; icon: typeof FileText }
> = {
  resume_loader: {
    label: "Resume Loader",
    focus: "读取并解析简历源",
    icon: FileText,
  },
  resume_parser: {
    label: "Resume Parser",
    focus: "抽取结构化候选人画像",
    icon: Bot,
  },
  hr_agent: {
    label: "HR Agent",
    focus: "招聘视角与 ATS 适配",
    icon: BriefcaseBusiness,
  },
  interviewer_agent: {
    label: "Interviewer Agent",
    focus: "技术深度与可追问性",
    icon: Cpu,
  },
  career_master_agent: {
    label: "Career Master",
    focus: "职业定位与行业叙事",
    icon: Sparkles,
  },
  summary_agent: {
    label: "Summary Agent",
    focus: "汇总最终修改方案",
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

function parseChunkLine(line: string) {
  return reviewStreamChunkSchema.parse(JSON.parse(line));
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <div className="section-title">
      <span>{eyebrow}</span>
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
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
            <th>维度</th>
            <th>分数</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.label}-${item.score}`}>
              <td>{item.label}</td>
              <td>{item.score}/100</td>
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
    return <p className="muted-copy">暂无 section 级修改建议</p>;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Section</th>
            <th>Priority</th>
            <th>Issue</th>
            <th>Recommendation</th>
            <th>Example Rewrite</th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((item, index) => (
            <tr key={`${item.section}-${index}`}>
              <td>{item.section}</td>
              <td>
                <span className={`priority-badge priority-${item.priority}`}>{item.priority}</span>
              </td>
              <td>{item.issue}</td>
              <td>{item.recommendation}</td>
              <td>{item.exampleRewrite || "-"}</td>
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

function StageStatusIcon({ status }: { status: StageStatus }) {
  if (status === "running") {
    return (
      <span className="status-icon status-running" aria-label="running">
        <span className="spinner-ring" />
      </span>
    );
  }

  if (status === "done") {
    return (
      <span className="status-icon status-done" aria-label="done">
        <CheckCircle2 size={18} />
      </span>
    );
  }

  return (
    <span className="status-icon status-pending" aria-label="pending">
      <CircleDot size={18} />
    </span>
  );
}

function ReviewerResultPanel({ feedback }: { feedback: ReviewerFeedback }) {
  return (
    <article className="result-panel">
      <header className="result-header">
        <div>
          <span className="eyebrow">Agent Result</span>
          <h3>{feedback.agentName}</h3>
        </div>
        <div className="score-pill">{feedback.overallScore}/100</div>
      </header>

      <MetricGrid
        rows={[
          { label: "Perspective", value: feedback.perspective },
          { label: "Strength Count", value: String(feedback.strengths.length) },
          { label: "Concern Count", value: String(feedback.concerns.length) },
        ]}
      />

      <div className="result-columns">
        <section>
          <h4>分析摘要</h4>
          <BulletList items={feedback.reasoningSummary} />
        </section>
        <section>
          <h4>亮点</h4>
          <BulletList items={feedback.strengths} />
        </section>
        <section>
          <h4>关注点</h4>
          <BulletList items={feedback.concerns} />
        </section>
      </div>

      <section className="result-section">
        <h4>评分拆解</h4>
        <ScoreTable items={feedback.scoreBreakdown} />
      </section>

      <section className="result-section">
        <h4>修改建议</h4>
        <SuggestionTable suggestions={feedback.suggestions} />
      </section>
    </article>
  );
}

function ResumeProfilePanel({ profile }: { profile: ResumeProfile }) {
  return (
    <article className="result-panel">
      <header className="result-header">
        <div>
          <span className="eyebrow">Parsed Profile</span>
          <h3>{profile.candidateName || "未识别姓名"}</h3>
        </div>
        <div className="score-pill subtle">Resume Parser</div>
      </header>

      <MetricGrid
        rows={[
          { label: "姓名", value: profile.personalInfo.name || "-" },
          { label: "年龄", value: profile.personalInfo.age || "-" },
          { label: "手机", value: profile.personalInfo.phone || "-" },
          { label: "邮箱", value: profile.personalInfo.email || "-" },
          { label: "所在地", value: profile.personalInfo.location || "-" },
          { label: "Headline", value: profile.headline || "-" },
          { label: "目标方向", value: profile.targetRoles.join(" / ") || "-" },
          { label: "经验年限", value: profile.yearsOfExperience || "-" },
        ]}
      />

      <div className="result-columns">
        <section>
          <h4>核心技能</h4>
          <BulletList items={profile.coreSkills} />
        </section>
        <section>
          <h4>链接</h4>
          <BulletList items={profile.personalInfo.links} />
        </section>
        <section>
          <h4>分析摘要</h4>
          <BulletList items={profile.reasoningSummary} />
        </section>
      </div>

      <div className="result-columns">
        <section>
          <h4>技能分类</h4>
          <BulletList items={profile.skillGroups.map((group) => `${group.category}: ${group.items.join(" / ")}`)} />
        </section>
        <section>
          <h4>工作经历</h4>
          <BulletList
            items={profile.workExperiences.map(
              (item) => `${item.company} | ${item.role} | ${item.period}`.replace(/\s+\|\s+\|\s+/g, " | "),
            )}
          />
        </section>
        <section>
          <h4>项目经历</h4>
          <BulletList
            items={profile.projects.map(
              (item) => `${item.name} | ${item.role} | ${item.period}`.replace(/\s+\|\s+\|\s+/g, " | "),
            )}
          />
        </section>
      </div>

      <div className="result-columns">
        <section>
          <h4>教育经历</h4>
          <BulletList
            items={profile.educationRecords.map(
              (item) => `${item.school} | ${item.degree} | ${item.major} | ${item.period}`.replace(
                /\s+\|\s+\|\s+/g,
                " | ",
              ),
            )}
          />
        </section>
        <section>
          <h4>亮点</h4>
          <BulletList items={profile.strengths} />
        </section>
        <section>
          <h4>风险与缺口</h4>
          <BulletList items={[...profile.risks, ...profile.missingInformation]} />
        </section>
      </div>
    </article>
  );
}

function FinalReviewPanel({ result }: { result: ReviewRunResult }) {
  const finalReview = result.finalReview;

  return (
    <section className="result-stack">
      <article className="hero-metric-band">
        <div>
          <span className="eyebrow">Final Review</span>
          <h2>{finalReview.executiveSummary || "已生成最终汇总"}</h2>
          <p>{result.document.path}</p>
        </div>
        <div className="hero-metric-tray">
          <div className="hero-metric">
            <span>Overall Score</span>
            <strong>{finalReview.overallScore}</strong>
          </div>
          <div className="hero-metric">
            <span>Ready Level</span>
            <strong>{finalReview.readyLevel}</strong>
          </div>
          <div className="hero-metric">
            <span>Reviewer Count</span>
            <strong>{result.reviewerFeedback.length}</strong>
          </div>
        </div>
      </article>

      <article className="result-panel">
        <header className="result-header">
          <div>
            <span className="eyebrow">Priority Plan</span>
            <h3>优先修改项</h3>
          </div>
        </header>
        <ol className="priority-list">
          {finalReview.topPriorities.length > 0 ? (
            finalReview.topPriorities.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
          ) : (
            <li>暂无优先级建议</li>
          )}
        </ol>
      </article>

      <article className="result-panel">
        <header className="result-header">
          <div>
            <span className="eyebrow">Score Breakdown</span>
            <h3>最终评分拆解</h3>
          </div>
        </header>
        <ScoreTable items={finalReview.scoreBreakdown} />
      </article>

      <article className="result-panel">
        <header className="result-header">
          <div>
            <span className="eyebrow">Agent Overview</span>
            <h3>各 Agent 评分概览</h3>
          </div>
        </header>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Perspective</th>
                <th>Score</th>
                <th>Top Concern</th>
              </tr>
            </thead>
            <tbody>
              {result.reviewerFeedback.map((item) => (
                <tr key={item.agentName}>
                  <td>{item.agentName}</td>
                  <td>{item.perspective}</td>
                  <td>{item.overallScore}/100</td>
                  <td>{item.concerns[0] || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="result-panel">
        <header className="result-header">
          <div>
            <span className="eyebrow">Section Rewrites</span>
            <h3>逐 section 修改建议</h3>
          </div>
        </header>
        <SuggestionTable suggestions={finalReview.sectionRevisions} />
      </article>
    </section>
  );
}

export function ReviewStudio() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [runningStages, setRunningStages] = useState<StageName[]>([]);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [stageStatus, setStageStatus] = useState<Record<StageName, StageStatus>>(createInitialStageStatus());
  const [stagePayloads, setStagePayloads] = useState<Partial<Record<StageName, unknown>>>({});
  const [finalResult, setFinalResult] = useState<ReviewRunResult | null>(null);

  const currentStageLabels = useMemo(
    () => runningStages.map((stage) => STAGE_META[stage].label),
    [runningStages],
  );

  const sortedStageResults = useMemo(
    () =>
      STAGE_ORDER.filter((stage) => stagePayloads[stage]).map((stage) => ({
        stage,
        payload: stagePayloads[stage],
      })),
    [stagePayloads],
  );

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

        const chunk = parseChunkLine(line);
        if (chunk.type === "event") {
          handleStageEvent(chunk.event);
          continue;
        }
        if (chunk.type === "result") {
          setFinalResult(chunk.result);
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
    setTimeline((previous) => [...previous, `${event.title}: ${event.message}`].slice(-12));

    if (event.kind === "stage_started" && STAGE_ORDER.includes(event.stage as StageName)) {
      setRunningStages((previous) =>
        previous.includes(event.stage as StageName) ? previous : [...previous, event.stage as StageName],
      );
      setStageStatus((previous) => ({
        ...previous,
        [event.stage]: "running",
      }));
      return;
    }

    if (event.kind === "stage_completed" && STAGE_ORDER.includes(event.stage as StageName)) {
      setRunningStages((previous) => previous.filter((stage) => stage !== event.stage));
      setStageStatus((previous) => ({
        ...previous,
        [event.stage]: "done",
      }));
      if (event.payload) {
        setStagePayloads((previous) => ({
          ...previous,
          [event.stage]: event.payload,
        }));
      }
      return;
    }

    if (event.kind === "pipeline_completed") {
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
    setStagePayloads({});
    setFinalResult(null);
    setStageStatus(createInitialStageStatus());

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
    <main className="app-shell">
      <section className="masthead">
        <div className="masthead-copy">
          <span className="eyebrow">Vercel AI SDK · Next.js · Vercel-ready</span>
          <h1>Resume Multi-Agent Review</h1>
          <p>
            上传简历之后，系统会按固定 pipeline 依次调用解析、HR、技术面试官、Career Master 和汇总 Agent，并把每一步的结构化结果实时展开给你看。
          </p>
        </div>
        <div className="masthead-meta">
          <div className="meta-chip">
            <Bot size={16} />
            <span>Structured output only</span>
          </div>
          <div className="meta-chip">
            <LoaderCircle size={16} />
            <span>Live stage streaming</span>
          </div>
          <div className="meta-chip">
            <Sparkles size={16} />
            <span>Vercel deploy target</span>
          </div>
        </div>
      </section>

      <section className="workspace-band">
        <div className="panel-header">
          <SectionTitle
            eyebrow="Review Source"
            title="上传简历文件"
            detail="整套应用统一走上传模式，和 Vercel 的部署路径保持一致。"
          />
        </div>

        <form className="source-form" onSubmit={handleSubmit}>
          <label className="upload-zone">
            <input
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={(event) => setResumeFile(event.currentTarget.files?.[0] ?? null)}
            />
            <div>
              <Upload size={24} />
              <strong>{resumeFile ? resumeFile.name : "拖入或选择简历文件"}</strong>
              <span>支持 .txt .md .pdf .docx</span>
            </div>
          </label>

          <div className="form-actions">
            <button className="primary-action" type="submit" disabled={isRunning}>
              {isRunning ? <LoaderCircle className="spin-icon" size={18} /> : <Play size={18} />}
              {isRunning ? "评审进行中" : "开始评审"}
            </button>
            <p className="muted-copy">当前版本统一通过上传文件触发评审流程。</p>
          </div>
        </form>

        {errorMessage ? (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        ) : null}
      </section>

      <section className="workspace-grid">
        <div className="status-column">
          <div className="panel-header">
            <SectionTitle
              eyebrow="Execution Board"
              title="Agent 执行状态"
              detail={
                currentStageLabels.length > 0
                  ? `当前执行: ${currentStageLabels.join(" · ")}`
                  : "尚未开始或已执行完成"
              }
            />
          </div>

          <div className="stage-grid">
            {STAGE_ORDER.map((stage) => {
              const meta = STAGE_META[stage];
              const Icon = meta.icon;
              const status = stageStatus[stage];

              return (
                <article
                  key={stage}
                  className={
                    runningStages.includes(stage)
                      ? "stage-card is-running"
                      : status === "done"
                        ? "stage-card is-done"
                        : "stage-card"
                  }
                >
                  <div className="stage-card-top">
                    <div className="stage-icon-wrap">
                      <Icon size={18} />
                    </div>
                    <StageStatusIcon status={status} />
                  </div>
                  <div className="stage-card-copy">
                    <h3>{meta.label}</h3>
                    <p>{meta.focus}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="timeline-column">
          <div className="panel-header">
            <SectionTitle eyebrow="Timeline" title="实时事件时间线" detail="每一阶段开始与完成都会在这里追加。" />
          </div>
          <div className="timeline-panel">
            {timeline.length > 0 ? (
              <ul className="timeline-list">
                {timeline.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">等待执行事件...</p>
            )}
          </div>
        </aside>
      </section>

      <section className="results-band">
        <div className="panel-header">
          <SectionTitle
            eyebrow="Stage Results"
            title="阶段结果面板"
            detail="每个 Agent 完成后，它的结构化结果会立即出现在这里。"
          />
        </div>

        <div className="result-stack">
          {sortedStageResults.map(({ stage, payload }) => {
            if (stage === "resume_parser") {
              const parsed = resumeProfileSchema.safeParse(payload);
              return parsed.success ? <ResumeProfilePanel key={stage} profile={parsed.data} /> : null;
            }

            if (stage === "hr_agent" || stage === "interviewer_agent" || stage === "career_master_agent") {
              const parsed = reviewerFeedbackSchema.safeParse(payload);
              return parsed.success ? <ReviewerResultPanel key={stage} feedback={parsed.data} /> : null;
            }

            if (stage === "summary_agent") {
              const parsed = finalResumeReviewSchema.safeParse(payload);
              return parsed.success ? (
                <article key={stage} className="result-panel">
                  <header className="result-header">
                    <div>
                      <span className="eyebrow">Summary Agent</span>
                      <h3>汇总阶段完成</h3>
                    </div>
                    <div className="score-pill">{parsed.data.overallScore}/100</div>
                  </header>
                  <MetricGrid
                    rows={[
                      { label: "Ready Level", value: parsed.data.readyLevel },
                      { label: "Top Priorities", value: String(parsed.data.topPriorities.length) },
                    ]}
                  />
                  <section className="result-section">
                    <h4>最终摘要</h4>
                    <p className="summary-copy">{parsed.data.executiveSummary || "暂无"}</p>
                  </section>
                  <section className="result-section">
                    <h4>评分拆解</h4>
                    <ScoreTable items={parsed.data.scoreBreakdown} />
                  </section>
                </article>
              ) : null;
            }

            if (stage === "resume_loader" && typeof payload === "object" && payload !== null) {
              const loaderPayload = payload as { path?: string; fileType?: string };
              return (
                <article key={stage} className="result-panel">
                  <header className="result-header">
                    <div>
                      <span className="eyebrow">Loader Result</span>
                      <h3>简历源已准备好</h3>
                    </div>
                    <div className="score-pill subtle">{loaderPayload.fileType ?? "-"}</div>
                  </header>
                  <MetricGrid
                    rows={[
                      { label: "路径", value: loaderPayload.path ?? "-" },
                      { label: "文件类型", value: loaderPayload.fileType ?? "-" },
                    ]}
                  />
                </article>
              );
            }

            return null;
          })}
        </div>
      </section>

      {finalResult ? (
        <section className="final-band">
          <div className="panel-header">
            <SectionTitle eyebrow="Final Output" title="最终简历修改建议" detail="这里展示汇总后的总分、评分拆解和逐 section 修改建议。" />
          </div>
          <FinalReviewPanel result={finalResult} />
        </section>
      ) : null}
    </main>
  );
}
