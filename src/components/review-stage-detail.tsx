"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  FolderGit2,
  Globe,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  Sparkles,
  Terminal,
  ThumbsUp,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";

import {
  finalResumeReviewSchema,
  resumeProfileSchema,
  reviewerFeedbackSchema,
  resumeRewriteSchema,
  type ResumeProfile,
  type ReviewRunResult,
  type ReviewerFeedback,
  getReviewCallCheckpoint,
} from "@/lib/review/schemas";

import { FinalReviewPanel, ReviewerResultPanel, RubricReference } from "@/components/review-report-panels";
import { rubricForStage, type ReviewerRubricName } from "@/lib/review/rubrics";
import { getReviewDisplayPayloads } from "@/lib/review/scoring";

const REVIEWER_STAGES: ReviewerRubricName[] = ["hr_agent", "interviewer_agent", "career_master_agent"];
import {
  EMPTY_STAGE_LIVE_STATE,
  STAGE_META,
  formatPhaseLabel,
  formatWorkflowStatus,
  isRecord,
  type StageLiveState,
  type StageLogEntry,
  type StageName,
  type StageStatus,
} from "@/components/review-studio-shared";

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
                    {log.callId ? <span className="log-phase">[{log.callLabel} · {log.callId.slice(0, 8)}]</span> : null}
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

const RewriteResultPanel = memo(function RewriteResultPanel({
  payload,
  finalResult,
}: {
  payload: unknown;
  finalResult: ReviewRunResult | null;
}) {
  const rewriteData = useMemo(() => resumeRewriteSchema.safeParse(payload || finalResult?.rewrite), [payload, finalResult?.rewrite]);
  if (!rewriteData.success || !rewriteData.data.rewrittenContent) {
    return <EmptyResultPanel title="Markdown 简历生成中" detail="正文完成后即可下载，无需等待改写说明。刷新后可从本地断点继续。" />;
  }
  const { rewrittenContent, explanation } = rewriteData.data;
  const candidateName = finalResult?.profile?.candidateName || "候选人";
  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([rewrittenContent], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${candidateName}_优化后全新简历.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="result-stack summary-result-stack">
      <header className="summary-report-header">
        <div className="summary-report-title">
          <div className="summary-title-badge"><FileText size={12} /><span>Markdown 简历</span></div>
          <h2>智能协同优化重写简历</h2>
          <p className="summary-report-desc">
            正文已就绪，可直接下载。{explanation ? "改写说明已生成。" : "改写说明尚未完成，不影响下载。"}
          </p>
        </div>
        <button type="button" onClick={handleDownload} className="rewrite-markdown-download">
          <Download size={15} /><span>下载 Markdown (.md)</span>
        </button>
      </header>
      {explanation && (
        <section className="summary-executive-box">
          <h4>本次重写优化要点说明</h4>
          <p className="summary-copy">{explanation}</p>
        </section>
      )}
      <CollapsibleSection title="查看 Markdown 正文" defaultExpanded={false}>
        <textarea
          className="rewrite-markdown-preview"
          aria-label="优化后的 Markdown 简历正文"
          readOnly
          spellCheck={false}
          value={rewrittenContent}
        />
      </CollapsibleSection>
    </section>
  );
});

const StageResultContent = memo(function StageResultContent({
  finalResult,
  payload,
  reviewers,
  stage,
}: {
  finalResult: ReviewRunResult | null;
  payload: unknown;
  reviewers: Partial<Record<ReviewerRubricName, ReviewerFeedback>>;
  stage: StageName;
}) {
  if (!payload && !((stage === "summary_agent" || stage === "rewrite_agent") && finalResult)) {
    const rubric = rubricForStage(stage);
    return (
      <>
        <EmptyResultPanel
          title={`${STAGE_META[stage].label} 结果装载中`}
          detail="节点完成后，这里会展示结构化诊断结果。"
        />
        {rubric ? (
          <section className="clean-detail-section rubric-preview-section">
            <div className="clean-section-heading">
              <div>
                <h4>评分标准</h4>
                <p>该 Agent 将按以下维度与权重打分，综合分 ≈ Σ 维度分 × 权重。</p>
              </div>
            </div>
            <RubricReference rubric={rubric} />
          </section>
        ) : null}
      </>
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
      <ReviewerResultPanel feedback={parsed.data} stage={stage} />
    ) : (
      <EmptyResultPanel title="专家诊断分析不可用" detail="诊断响应格式损坏，建议您检查模型环境或重新触发分析流程。" />
    );
  }

  if (stage === "summary_agent") {
    if (finalResult) {
      const fromResult = Object.fromEntries(
        REVIEWER_STAGES.flatMap((name, index) => (finalResult.reviewerFeedback[index] ? [[name, finalResult.reviewerFeedback[index]]] : [])),
      );
      return (
        <FinalReviewPanel
          review={finalResult.finalReview}
          reviewers={{ ...fromResult, ...reviewers }}
          fileName={finalResult.document.path?.split(/[\\/]/).pop()}
        />
      );
    }
    const parsed = finalResumeReviewSchema.safeParse(payload);
    return parsed.success ? (
      <FinalReviewPanel review={parsed.data} reviewers={reviewers} />
    ) : (
      <EmptyResultPanel title="汇总结果暂不可用" detail="Summary Agent 完成后会展示最终评分、专家加权构成和优先建议。" />
    );
  }

  if (stage === "rewrite_agent") {
    return <RewriteResultPanel payload={payload} finalResult={finalResult} />;
  }

  return null;
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
  const displayPayloads = useMemo(() => getReviewDisplayPayloads(stagePayloads), [stagePayloads]);
  const payload = displayPayloads[selectedStage] ?? (selectedStage === "rewrite_agent" ? finalResult?.rewrite : undefined);
  const hasPartialResult = Boolean(getReviewCallCheckpoint(stagePayloads[selectedStage]));
  const [activeDetailTab, setActiveDetailTab] = useState<"logs" | "report">(payload ? "report" : "logs");
  const logCount = liveState.logs?.length ?? 0;
  const { hr_agent: hrPayload, interviewer_agent: interviewerPayload, career_master_agent: careerPayload } = displayPayloads;
  const reviewers = useMemo(() => {
    const entries = REVIEWER_STAGES.map((name, index) => [name, [hrPayload, interviewerPayload, careerPayload][index]] as const);
    return Object.fromEntries(
      entries.flatMap(([name, item]) => {
        const parsed = reviewerFeedbackSchema.safeParse(item);
        return item && parsed.success ? [[name, parsed.data]] : [];
      }),
    ) as Partial<Record<ReviewerRubricName, ReviewerFeedback>>;
  }, [hrPayload, interviewerPayload, careerPayload]);

  return (
    <div className="node-result-layout" key={selectedStage}>
      <header className="node-result-header">
        <div className="node-result-title">
          <span className="node-result-icon">
            <Icon size={18} />
          </span>
          <div>
            <h2>{meta.label} 诊断台</h2>
          </div>
        </div>
        <div className="node-result-status-wrap">
          <span className={`workflow-status-pill workflow-status-${status}`}>
            {formatWorkflowStatus(status, liveState.phase)}
          </span>
        </div>
      </header>

      <div className="result-viewer">
        <div className="node-detail-tabs" role="tablist" aria-label="节点详情视图">
          <button
            type="button"
            role="tab"
            aria-selected={activeDetailTab === "logs"}
            className={`node-detail-tab ${activeDetailTab === "logs" ? "is-active" : ""}`}
            onClick={() => setActiveDetailTab("logs")}
          >
            <Terminal size={14} />
            <span>实时日志</span>
            <span className="node-detail-tab-count">{logCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeDetailTab === "report"}
            className={`node-detail-tab ${activeDetailTab === "report" ? "is-active" : ""}`}
            onClick={() => setActiveDetailTab("report")}
          >
            <FileText size={14} />
            <span>诊断报告</span>
            <span className={`node-detail-tab-status ${payload ? "is-ready" : ""}`}>
              {payload ? (hasPartialResult ? "部分已生成" : "已生成") : "等待中"}
            </span>
          </button>
        </div>

        <div className={`node-detail-tab-panel node-detail-tab-panel-${activeDetailTab}`} role="tabpanel">
          {activeDetailTab === "logs" ? (
            <LiveConsole stage={selectedStage} liveState={liveState} status={status} />
          ) : (
            <div className={`live-console-box node-report-box ${status === "done" ? "is-done" : ""}`}>
              <div className="live-console-header node-report-panel-header">
                <span className={`console-header-left ${payload ? "is-ready" : ""}`}>
                  <FileText size={15} />
                  <strong>{meta.label} 诊断分析报告 & 优化结果</strong>
                  {status === "done" && (
                    <span className="report-ready-pill">
                      <span className="phase-indicator-dot" />
                      <span>诊断就绪</span>
                    </span>
                  )}
                </span>
                <span className="console-header-right">
                  <span className="console-log-count">
                    {payload ? (hasPartialResult ? "已展示当前结果，后续内容继续生成" : "已生成结构化结果") : "等待数据载入"}
                  </span>
                </span>
              </div>

              <div className="live-console-body node-report-body">
                <div className="structured-panel-wrapper node-report-structured-wrapper">
                  <StageResultContent
                    finalResult={selectedStage === "summary_agent" || selectedStage === "rewrite_agent" ? finalResult : null}
                    payload={payload}
                    reviewers={reviewers}
                    stage={selectedStage}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StageDetailDrawer({
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
