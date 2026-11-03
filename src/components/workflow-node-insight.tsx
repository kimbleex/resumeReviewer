import {
  finalResumeReviewSchema,
  resumeDocumentSchema,
  resumeProfileSchema,
  resumeRewriteSchema,
  reviewerFeedbackSchema,
} from "@/lib/review/schemas";
import { REVIEWER_RUBRICS, SUMMARY_RUBRIC, applyRubricWeights, scoreBand, type RubricDimension } from "@/lib/review/rubrics";
import { formatReadyLevel, scoreLevel, type StageName } from "@/components/review-studio-shared";
import { reviewScoringSchema } from "@/lib/review/scoring";

type Stat = { label: string; value: string };

function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <span className="workflow-node-stats">
      {stats.map((stat) => (
        <span key={stat.label} className="workflow-node-stat">
          <b>{stat.value}</b>
          <small>{stat.label}</small>
        </span>
      ))}
    </span>
  );
}

/** 按权重分段的评分条：段宽 = 权重，段内填充 = 维度分。未出分时只显示权重分布。 */
function RubricBar({ rubric, scores }: { rubric: RubricDimension[]; scores: Array<number | null> | null }) {
  return (
    <span className="workflow-node-rubric-bar" aria-hidden="true">
      {rubric.map((dimension, index) => {
        const score = scores?.[index] ?? null;
        return (
          <span
            key={dimension.label}
            className="workflow-node-rubric-segment"
            style={{ flexGrow: dimension.weight }}
            title={`${dimension.label} · 权重 ${dimension.weight}%${score === null ? "" : ` · ${score} 分`}`}
          >
            {score !== null ? (
              <i className={`workflow-node-rubric-fill ${scoreLevel(score)}`} style={{ width: `${score}%` }} />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

function ScoreLine({ score, note }: { score: number; note: string }) {
  return (
    <span className="workflow-node-score-line">
      <span className={`workflow-node-score ${scoreLevel(score)}`}>
        {score}
        <small>/100</small>
      </span>
      <span className="workflow-node-score-note">{note}</span>
    </span>
  );
}

function RubricDimensionList({ rubric, scores }: { rubric: RubricDimension[]; scores: Array<number | null> }) {
  return (
    <span className="workflow-node-dims">
      {rubric.map((dimension, index) => {
        const score = scores[index] ?? null;
        return (
          <span key={dimension.label} className="workflow-node-dim" title={`${dimension.label} · 权重 ${dimension.weight}%`}>
            <span className="workflow-node-dim-label">{dimension.short}</span>
            <span className="workflow-node-dim-weight">{dimension.weight}%</span>
            <span className="workflow-node-dim-track">
              {score !== null ? (
                <i className={`workflow-node-rubric-fill ${scoreLevel(score)}`} style={{ width: `${score}%` }} />
              ) : null}
            </span>
            <span className={`workflow-node-dim-score ${score === null ? "" : scoreLevel(score)}`}>{score ?? "--"}</span>
          </span>
        );
      })}
    </span>
  );
}

function RubricPreview({ rubric, withDimensions = false }: { rubric: RubricDimension[]; withDimensions?: boolean }) {
  return (
    <span className="workflow-node-insight">
      <span className="workflow-node-score-line is-muted">
        <span className="workflow-node-score">
          --
          <small>/100</small>
        </span>
        <span className="workflow-node-score-note">{rubric.length} 维加权评分</span>
      </span>
      <RubricBar rubric={rubric} scores={null} />
      {withDimensions ? <RubricDimensionList rubric={rubric} scores={rubric.map(() => null)} /> : null}
    </span>
  );
}

function ReviewerInsight({ stage, payload }: { stage: keyof typeof REVIEWER_RUBRICS; payload: unknown }) {
  const rubric = REVIEWER_RUBRICS[stage];
  const parsed = reviewerFeedbackSchema.safeParse(payload);
  if (!payload || !parsed.success) {
    return <RubricPreview rubric={rubric} withDimensions />;
  }

  const feedback = parsed.data;
  const { dimensionScores } = applyRubricWeights(feedback.scoreBreakdown, rubric);
  const potentialGain = feedback.suggestions.reduce((sum, item) => sum + item.expectedGain, 0);
  const note = [scoreBand(feedback.overallScore).label, potentialGain > 0 ? `可提升 +${potentialGain}` : `${feedback.suggestions.length} 条建议`].join(" · ");

  return (
    <span className="workflow-node-insight">
      <ScoreLine score={feedback.overallScore} note={note} />
      <RubricBar rubric={rubric} scores={dimensionScores} />
      <RubricDimensionList rubric={rubric} scores={dimensionScores} />
    </span>
  );
}

export function WorkflowNodeInsight({ stage, payload }: { stage: StageName; payload: unknown }) {
  if (stage === "scoring_agent") {
    const parsed = reviewScoringSchema.safeParse(payload);
    return parsed.success ? (
      <span className="workflow-node-insight" aria-live="polite">
        <ScoreLine score={parsed.data.review.overallScore} note="评分已就绪 · 建议陆续生成" />
        <StatRow stats={[
          { label: "HR · 35%", value: String(parsed.data.reviewers.hr_agent.overallScore) },
          { label: "面试 · 35%", value: String(parsed.data.reviewers.interviewer_agent.overallScore) },
          { label: "定位 · 30%", value: String(parsed.data.reviewers.career_master_agent.overallScore) },
        ]} />
      </span>
    ) : <Caption>先出三视角评分，再逐步补充建议</Caption>;
  }
  if (stage === "hr_agent" || stage === "interviewer_agent" || stage === "career_master_agent") {
    return <ReviewerInsight stage={stage} payload={payload} />;
  }

  if (stage === "summary_agent") {
    const parsed = finalResumeReviewSchema.safeParse(payload);
    if (!payload || !parsed.success) {
      return <RubricPreview rubric={SUMMARY_RUBRIC} />;
    }
    const review = parsed.data;
    const potentialGain = review.sectionRevisions.reduce((sum, item) => sum + item.expectedGain, 0);
    return (
      <span className="workflow-node-insight">
        <ScoreLine score={review.overallScore} note={formatReadyLevel(review.readyLevel)} />
        <StatRow
          stats={[
            { label: "优先事项", value: String(review.topPriorities.length) },
            { label: "板块建议", value: String(review.sectionRevisions.length) },
            { label: "预计提升", value: potentialGain > 0 ? `+${potentialGain}` : "-" },
          ]}
        />
      </span>
    );
  }

  if (stage === "resume_loader") {
    return <LoaderInsight payload={payload} />;
  }
  if (stage === "resume_parser") {
    return <ParserInsight payload={payload} />;
  }
  if (stage === "rewrite_agent") {
    return <RewriteInsight payload={payload} />;
  }
  return null;
}

function Chips({
  items,
  muted = false,
  single = false,
  extra = 0,
}: {
  items: string[];
  muted?: boolean;
  single?: boolean;
  extra?: number;
}) {
  return (
    <span className={`workflow-node-chips ${muted ? "is-muted" : ""} ${single ? "is-single" : ""}`}>
      {items.map((item) => (
        <span key={item} className="workflow-node-chip">
          {item}
        </span>
      ))}
      {extra > 0 ? <span className="workflow-node-chip is-more">+{extra}</span> : null}
    </span>
  );
}

function Caption({ children }: { children: string }) {
  return (
    <span className="workflow-node-insight">
      <span className="workflow-node-caption">{children}</span>
    </span>
  );
}

const SUPPORTED_FORMATS = ["PDF", "DOCX", "MD", "TXT"];
const PARSER_FIELDS = ["个人信息", "技能", "工作经历", "项目", "教育", "风险缺口"];
const REWRITE_TEMPLATES = ["工程技术", "业务增长", "职业转型", "早期潜力"];
const REWRITE_TARGET = { min: 1000, max: 1400 };

function LoaderInsight({ payload }: { payload: unknown }) {
  const parsed = resumeDocumentSchema.safeParse(payload);
  if (!payload || !parsed.success) {
    return (
      <>
        <Chips items={SUPPORTED_FORMATS} muted />
        <Caption>输出：简历全文 → Parser</Caption>
      </>
    );
  }

  const { path, fileType, content } = parsed.data;
  const fileName = path.split(/[\\/]/).pop() || path;
  const lineCount = content.split("\n").filter((line) => line.trim()).length;
  return (
    <>
      <span className="workflow-node-file" title={fileName}>
        <b>{fileType.toUpperCase()}</b>
        <span>{fileName}</span>
      </span>
      <span className="workflow-node-insight">
        <StatRow
          stats={[
            { label: "字符", value: content.length.toLocaleString("zh-CN") },
            { label: "有效行", value: lineCount.toLocaleString("zh-CN") },
          ]}
        />
      </span>
    </>
  );
}

function ParserInsight({ payload }: { payload: unknown }) {
  const parsed = resumeProfileSchema.safeParse(payload);
  if (!payload || !parsed.success) {
    return (
      <>
        <Chips items={PARSER_FIELDS} muted />
        <Caption>输出：结构化画像 → 3 位专家</Caption>
      </>
    );
  }

  const profile = parsed.data;
  const skills = profile.coreSkills.slice(0, 3);
  return (
    <>
      {skills.length > 0 ? <Chips items={skills} extra={profile.coreSkills.length - skills.length} single /> : null}
      <span className="workflow-node-insight">
        <StatRow
          stats={[
            { label: "经历", value: String(profile.workExperiences.length) },
            { label: "项目", value: String(profile.projects.length) },
            { label: "技能", value: String(profile.coreSkills.length) },
            { label: "缺口", value: String(profile.risks.length + profile.missingInformation.length) },
          ]}
        />
      </span>
    </>
  );
}

function RewriteInsight({ payload }: { payload: unknown }) {
  const parsed = resumeRewriteSchema.safeParse(payload);
  if (!payload || !parsed.success || !parsed.data.rewrittenContent) {
    return (
      <>
        <Chips items={REWRITE_TEMPLATES} muted />
        <Caption>{`自动选模板 · 目标 ${REWRITE_TARGET.min}-${REWRITE_TARGET.max} 字`}</Caption>
      </>
    );
  }

  const wordCount = parsed.data.rewrittenContent.replace(/\s/g, "").length;
  const changeCount = parsed.data.explanation.split("\n").filter((line) => line.trim()).length;
  const fit = wordCount < REWRITE_TARGET.min ? "偏短" : wordCount > REWRITE_TARGET.max ? "偏长" : "达标";
  return (
    <span className="workflow-node-insight">
      <StatRow
        stats={[
          { label: "字数", value: wordCount.toLocaleString("zh-CN") },
          { label: "改动点", value: String(changeCount) },
          { label: `${REWRITE_TARGET.min}-${REWRITE_TARGET.max}字`, value: fit },
        ]}
      />
    </span>
  );
}
