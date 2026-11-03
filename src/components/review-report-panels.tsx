"use client";

import { useState } from "react";
import { BriefcaseBusiness, ChevronDown, ShieldAlert, TrendingUp } from "lucide-react";

import type { FinalResumeReview, ReviewerFeedback, RevisionSuggestion } from "@/lib/review/schemas";
import {
  REVIEWER_RUBRICS,
  SCORE_BANDS,
  SUMMARY_REVIEWER_WEIGHTS,
  SUMMARY_RUBRIC,
  applyRubricWeights,
  round1,
  scoreBand,
  type RubricDimension,
  type ReviewerRubricName,
} from "@/lib/review/rubrics";
import { formatPriority, formatReadyLevel, formatStageLabel, scoreLevel } from "@/components/review-studio-shared";

const PRIORITY_ORDER: Record<RevisionSuggestion["priority"], number> = { high: 0, medium: 1, low: 2 };

function sumGain(items: RevisionSuggestion[]): number {
  return items.reduce((sum, item) => sum + item.expectedGain, 0);
}

function formatSigned(value: number): string {
  const rounded = round1(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className={`score-ring ${scoreLevel(score)}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="score-ring-track" cx="50" cy="50" r={radius} />
        <circle
          className="score-ring-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
        />
      </svg>
      <span className="score-ring-label">
        <strong>{score}</strong>
        <small>/ 100</small>
      </span>
    </span>
  );
}

/** 分数段刻度：标出当前分数落在哪一档。 */
function ScoreBandScale({ score }: { score: number }) {
  const bands = [...SCORE_BANDS].reverse();
  const current = scoreBand(score);
  return (
    <div className="score-band-scale" aria-label={`当前分数段：${current.label}`}>
      <div className="score-band-track">
        {bands.map((band, index) => {
          const next = bands[index + 1]?.min ?? 101;
          return (
            <span
              key={band.label}
              className={`score-band-segment ${band.label === current.label ? "is-current" : ""}`}
              style={{ flexGrow: next - band.min }}
              title={`${band.min}-${next - 1} ${band.label}：${band.detail}`}
            >
              {band.min >= 60 ? <small>{band.min}</small> : null}
            </span>
          );
        })}
        <i className="score-band-marker" style={{ left: `${score}%` }} />
      </div>
      <p className="score-band-caption">
        <b>{current.label}</b>
        {current.detail}
      </p>
    </div>
  );
}

function RubricScoreTable({
  items,
  rubric,
  overallScore,
}: {
  items: Array<{ label: string; score: number; reason: string }>;
  rubric: RubricDimension[];
  overallScore: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { rows, dimensionScores, weightedTotal, coveredWeight } = applyRubricWeights(items, rubric);
  const missing = rubric.filter((_, index) => dimensionScores[index] === null);

  if (rows.length === 0) {
    return <RubricReference rubric={rubric} />;
  }

  return (
    <div className="rubric-table" role="table" aria-label="加权评分明细">
      <div className="rubric-table-head" role="row">
        <span role="columnheader">评分维度</span>
        <span role="columnheader">权重</span>
        <span role="columnheader">得分</span>
        <span role="columnheader">加权贡献</span>
      </div>
      {rows.map((row) => {
        const dimension = row.dimension;
        const isOpen = expanded === row.label;
        return (
          <div key={row.label} className={`rubric-table-row ${isOpen ? "is-open" : ""}`} role="row">
            <button
              type="button"
              className="rubric-table-main"
              onClick={() => setExpanded(isOpen ? null : row.label)}
              aria-expanded={isOpen}
            >
              <span className="rubric-dim-name" role="cell">
                <ChevronDown size={13} />
                {row.label}
              </span>
              <span className="rubric-dim-weight" role="cell">{row.weight === null ? "—" : `${row.weight}%`}</span>
              <span className="rubric-dim-score" role="cell">
                <span className="rubric-dim-track">
                  <i className={`rubric-dim-fill ${scoreLevel(row.score)}`} style={{ width: `${row.score}%` }} />
                </span>
                <b className={scoreLevel(row.score)}>{row.score}</b>
              </span>
              <span className="rubric-dim-contribution" role="cell">
                {row.contribution === null ? "—" : row.contribution}
                {row.weightedGap ? <small>-{row.weightedGap}</small> : null}
              </span>
            </button>
            {isOpen || row.reason ? (
              <div className="rubric-table-detail">
                {row.reason ? <p className="rubric-dim-reason">{row.reason}</p> : null}
                {isOpen && dimension ? (
                  <dl className="rubric-dim-criteria">
                    <div>
                      <dt>考察点</dt>
                      <dd>{dimension.focus}</dd>
                    </div>
                    {dimension.high ? (
                      <div>
                        <dt>高分 85+</dt>
                        <dd>{dimension.high}</dd>
                      </div>
                    ) : null}
                    {dimension.low ? (
                      <div>
                        <dt>低分 &lt;60</dt>
                        <dd>{dimension.low}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="rubric-table-foot" role="row">
        <span>
          加权合计
          {coveredWeight < 100 ? <small>（覆盖权重 {coveredWeight}%）</small> : null}
        </span>
        <span>
          {weightedTotal === null ? "—" : <b>{weightedTotal}</b>}
          {weightedTotal !== null ? (
            <small>
              模型给分 {overallScore}（{formatSigned(overallScore - weightedTotal)}）
            </small>
          ) : null}
        </span>
      </div>
      {missing.length > 0 && coveredWeight > 0 ? (
        <p className="rubric-table-note">未覆盖维度：{missing.map((dimension) => dimension.label).join("、")}</p>
      ) : null}
    </div>
  );
}

/** 未出分时展示的评分标准说明。 */
export function RubricReference({ rubric }: { rubric: RubricDimension[] }) {
  return (
    <div className="rubric-reference">
      {rubric.map((dimension) => (
        <div key={dimension.label} className="rubric-reference-item">
          <div className="rubric-reference-head">
            <strong>{dimension.label}</strong>
            <span>{dimension.weight}%</span>
          </div>
          <p>{dimension.focus}</p>
          {dimension.high || dimension.low ? (
            <ul>
              {dimension.high ? <li className="is-high">85+：{dimension.high}</li> : null}
              {dimension.low ? <li className="is-low">&lt;60：{dimension.low}</li> : null}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function SuggestionTable({ suggestions }: { suggestions: RevisionSuggestion[] }) {
  if (suggestions.length === 0) {
    return <p className="muted-copy">暂无修改建议</p>;
  }

  const sorted = [...suggestions].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.expectedGain - a.expectedGain,
  );

  return (
    <div className="revision-cards-board">
      {sorted.map((item, index) => (
        <div key={`${item.section}-${index}`} className={`revision-card priority-${item.priority}`}>
          <div className="revision-card-header">
            <div className="revision-card-section">
              <span className="revision-card-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="revision-section-icon"><BriefcaseBusiness size={14} /></span>
              <span className="revision-section-name">{item.section}</span>
            </div>
            <span className="revision-card-tags">
              {item.expectedGain > 0 ? (
                <span className="revision-gain-pill" title="完成该修改后综合分预计提升">
                  <TrendingUp size={12} />+{item.expectedGain} 分
                </span>
              ) : null}
              <span className={`revision-priority-pill ${item.priority}`}>{formatPriority(item.priority)}</span>
            </span>
          </div>

          <div className="revision-issue-row">
            <span className="revision-issue-icon"><ShieldAlert size={14} /></span>
            <span className="revision-issue-text">{item.issue}</span>
          </div>

          <div className="revision-recommendation-row">
            <span className="revision-recommendation-label">怎么改</span>
            <span className="revision-recommendation-text">{item.recommendation}</span>
          </div>

          {item.exampleRewrite && (
            <div className="revision-comparison-grid">
              <div className="revision-rewrite-block">
                <span className="revision-rewrite-label">示范写法</span>
                <pre className="revision-rewrite-content">{item.exampleRewrite}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReportStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className={`report-stat ${tone ? `tone-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SectionHeading({ title, description, aside }: { title: string; description?: string; aside?: string }) {
  return (
    <div className="clean-section-heading">
      <div>
        <h4>{title}</h4>
        {description && <p>{description}</p>}
      </div>
      {aside ? <span className="clean-section-aside">{aside}</span> : null}
    </div>
  );
}

function TextList({ items, emptyText = "暂无明确结论" }: { items: string[]; emptyText?: string }) {
  if (items.length === 0) {
    return <p className="clean-empty-copy">{emptyText}</p>;
  }
  return (
    <ul className="clean-text-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export function ReviewerResultPanel({ feedback, stage }: { feedback: ReviewerFeedback; stage: ReviewerRubricName }) {
  const rubric = REVIEWER_RUBRICS[stage];
  const { rows } = applyRubricWeights(feedback.scoreBreakdown, rubric);
  const weakest = rows
    .filter((row) => row.weightedGap !== null)
    .sort((a, b) => (b.weightedGap ?? 0) - (a.weightedGap ?? 0))[0];
  const totalGain = sumGain(feedback.suggestions);
  const highCount = feedback.suggestions.filter((item) => item.priority === "high").length;
  const projected = Math.min(100, feedback.overallScore + totalGain);

  return (
    <article className="clean-report-shell">
      <header className="clean-report-hero">
        <ScoreRing score={feedback.overallScore} />
        <div className="clean-report-title">
          <span className="clean-kicker">专家诊断 · {feedback.perspective || formatStageLabel(stage)}</span>
          <h3>{formatStageLabel(feedback.agentName || stage)} 评审结果</h3>
          <ScoreBandScale score={feedback.overallScore} />
        </div>
      </header>

      <div className="clean-insight-grid report-stat-grid">
        <ReportStat
          label="最大失分维度"
          value={weakest ? `${weakest.score} 分` : "—"}
          detail={weakest ? `${weakest.label} · 加权损失 ${weakest.weightedGap}` : "等待维度评分"}
          tone="warn"
        />
        <ReportStat
          label="修改建议"
          value={`${feedback.suggestions.length} 条`}
          detail={`高优先级 ${highCount} 条`}
        />
        <ReportStat
          label={totalGain > 0 ? "预计可达" : "评分证据"}
          value={totalGain > 0 ? `${projected} 分` : `${feedback.scoreBreakdown.length} 项`}
          detail={totalGain > 0 ? `全部完成后 +${totalGain} 分` : "各维度附简短事实依据"}
          tone="good"
        />
      </div>

      <section className="clean-detail-section">
        <SectionHeading title="核心判断" />
        <TextList items={feedback.reasoningSummary} />
      </section>

      <section className="clean-detail-section">
        <SectionHeading
          title="加权评分明细"
          description="得分 × 权重 = 加权贡献；红字为该维度距满分的加权损失。点击维度查看评分标准。"
          aside={`${rubric.length} 维 · 权重 ${rubric.map((dimension) => dimension.weight).join("/")}`}
        />
        <RubricScoreTable items={feedback.scoreBreakdown} rubric={rubric} overallScore={feedback.overallScore} />
      </section>

      <div className="clean-two-column">
        <section className="clean-detail-section tone-good">
          <SectionHeading title="优势信号" aside={`${feedback.strengths.length} 项`} />
          <TextList items={feedback.strengths} />
        </section>
        <section className="clean-detail-section tone-warn">
          <SectionHeading title="需要补强" aside={`${feedback.concerns.length} 项`} />
          <TextList items={feedback.concerns} />
        </section>
      </div>

      <section className="clean-detail-section">
        <SectionHeading
          title="修改建议"
          description="优先处理关键短板；完整改写将在后续步骤生成。"
          aside={totalGain > 0 ? `合计 +${totalGain} 分` : undefined}
        />
        <SuggestionTable suggestions={feedback.suggestions} />
      </section>
    </article>
  );
}

function ReadyLevelScale({ score }: { score: number }) {
  const levels = [
    { key: "needs_rewrite", label: "需重写", range: "<65", from: 0, to: 65 },
    { key: "promising", label: "有潜力", range: "65-79", from: 65, to: 80 },
    { key: "strong", label: "强竞争力", range: "80+", from: 80, to: 100 },
  ];
  return (
    <div className="ready-scale">
      {levels.map((level) => {
        const isCurrent = score >= level.from && (score < level.to || level.to === 100);
        return (
          <span key={level.key} className={`ready-scale-step ${isCurrent ? "is-current" : ""}`} style={{ flexGrow: level.to - level.from }}>
            <b>{level.label}</b>
            <small>{level.range}</small>
          </span>
        );
      })}
      <i className="score-band-marker" style={{ left: `${score}%` }} />
    </div>
  );
}

export function FinalReviewPanel({
  review,
  reviewers,
  fileName,
}: {
  review: FinalResumeReview;
  reviewers: Partial<Record<ReviewerRubricName, ReviewerFeedback>>;
  fileName?: string;
}) {
  const readyLevel = formatReadyLevel(review.readyLevel);
  const summaryText = review.executiveSummary || `当前简历综合评分 ${review.overallScore} 分，状态为${readyLevel}。`;
  const totalGain = sumGain(review.sectionRevisions);

  const reviewerRows = (Object.keys(SUMMARY_REVIEWER_WEIGHTS) as ReviewerRubricName[]).map((name) => {
    const feedback = reviewers[name];
    const weight = SUMMARY_REVIEWER_WEIGHTS[name];
    return { name, weight, feedback, contribution: feedback ? round1((feedback.overallScore * weight) / 100) : null };
  });
  const scored = reviewerRows.filter((row) => row.feedback);
  const scoredWeight = scored.reduce((sum, row) => sum + row.weight, 0);
  const expertWeighted =
    scoredWeight > 0 ? round1(scored.reduce((sum, row) => sum + (row.feedback?.overallScore ?? 0) * row.weight, 0) / scoredWeight) : null;
  const expertScores = scored.map((row) => row.feedback?.overallScore ?? 0);
  const spread = expertScores.length > 1 ? Math.max(...expertScores) - Math.min(...expertScores) : null;

  return (
    <article className="clean-report-shell">
      <header className="clean-report-hero">
        <ScoreRing score={review.overallScore} size={116} />
        <div className="clean-report-title">
          <span className="clean-kicker">终审结论{fileName ? ` · ${fileName}` : ""}</span>
          <h3>
            综合评分 {review.overallScore} · {readyLevel}
          </h3>
          <ReadyLevelScale score={review.overallScore} />
        </div>
      </header>

      <p className="clean-summary-lead">{summaryText}</p>

      <div className="clean-insight-grid report-stat-grid summary-metrics-inline">
        <ReportStat
          label="专家加权分"
          value={expertWeighted === null ? "—" : String(expertWeighted)}
          detail={expertWeighted === null ? "等待专家评分" : "总分按加权结果四舍五入"}
        />
        <ReportStat
          label="专家分歧"
          value={spread === null ? "—" : `${spread} 分`}
          detail={spread === null ? "专家不足 2 位" : spread > 15 ? "视角差异较大，优先关注短板" : "共识较一致"}
          tone={spread !== null && spread > 15 ? "warn" : undefined}
        />
        <ReportStat
          label={totalGain > 0 ? "预计可达" : "修改行动"}
          value={totalGain > 0 ? `${Math.min(100, review.overallScore + totalGain)} 分` : `${review.sectionRevisions.length} 项`}
          detail={totalGain > 0 ? `完成 ${review.sectionRevisions.length} 项修改 +${totalGain}` : "建议完成后陆续展示"}
          tone="good"
        />
      </div>

      <section className="clean-detail-section summary-section">
        <SectionHeading title="专家加权构成" description="综合评分 = Σ 视角分 × 权重，四舍五入取整。后续建议不改变评分。" />
        <div className="summary-agent-strip">
          {reviewerRows.map((row) => (
            <div key={row.name} className="summary-agent-item">
              <span className="summary-agent-name">{formatStageLabel(row.name)}</span>
              <span className="summary-agent-weight">权重 {row.weight}%</span>
              <div className="summary-agent-bar-bg">
                {row.feedback ? (
                  <div className={`summary-agent-bar-fill ${scoreLevel(row.feedback.overallScore)}`} style={{ width: `${row.feedback.overallScore}%` }} />
                ) : null}
              </div>
              <span className={`summary-agent-score ${row.feedback ? scoreLevel(row.feedback.overallScore) : ""}`}>{row.feedback ? `${row.feedback.overallScore} 分` : "—"}</span>
              <span className="summary-agent-contribution">{row.contribution === null ? "—" : `贡献 ${row.contribution}`}</span>
              <span className="summary-agent-note">
                {row.feedback ? row.feedback.concerns[0] || row.feedback.reasoningSummary[0] || row.feedback.perspective : "该专家尚未完成评审"}
              </span>
            </div>
          ))}
          {expertWeighted !== null ? (
            <div className="summary-agent-total">
              <span>专家加权合计</span>
              <b>{expertWeighted}</b>
              <span>→ 终审 {review.overallScore}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="clean-detail-section summary-section">
        <SectionHeading title="优先行动" description="先完成这些修改，再进入逐段润色。" aside={`${review.topPriorities.length} 项`} />
        <ol className="priority-list">
          {review.topPriorities.length > 0 ? (
            review.topPriorities.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
          ) : (
            <li>暂无优先级建议</li>
          )}
        </ol>
      </section>

      <section className="clean-detail-section summary-section">
        <SectionHeading
          title="终审维度评分"
          aside={`${SUMMARY_RUBRIC.length} 维 · 权重 ${SUMMARY_RUBRIC.map((dimension) => dimension.weight).join("/")}`}
        />
        <RubricScoreTable items={review.scoreBreakdown} rubric={SUMMARY_RUBRIC} overallScore={review.overallScore} />
      </section>

      <section className="clean-detail-section summary-section">
        <SectionHeading
          title="逐板块修改建议"
          description="按优先级排列，合并各专家的重复意见。"
          aside={totalGain > 0 ? `合计 +${totalGain} 分` : undefined}
        />
        <SuggestionTable suggestions={review.sectionRevisions} />
      </section>
    </article>
  );
}
