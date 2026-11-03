// 评分标准的唯一来源：Prompt 由它生成，界面用它展示维度、权重与加权贡献。

export type RubricDimension = {
  label: string;
  /** 卡片上展示的短名 */
  short: string;
  weight: number;
  focus: string;
  high?: string;
  low?: string;
};

export type ReviewerRubricName = "hr_agent" | "interviewer_agent" | "career_master_agent";

export const SCORE_BANDS = [
  { min: 90, label: "行业标杆", detail: "可直接进终面，几乎挑不出硬伤" },
  { min: 80, label: "强", detail: "明显优于平均，仅有少量可优化项" },
  { min: 70, label: "良好", detail: "基本胜任，量化 / 叙事 / 匹配度有可感知短板" },
  { min: 60, label: "及格", detail: "表达空泛、缺量化，初筛容易被刷" },
  { min: 45, label: "偏弱", detail: "存在明显硬伤，需大幅重写" },
  { min: 0, label: "不具竞争力", detail: "与目标岗位严重不符或信息严重不足" },
] as const;

export function scoreBand(score: number) {
  return SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export const REVIEWER_RUBRICS: Record<ReviewerRubricName, RubricDimension[]> = {
  hr_agent: [
    {
      label: "岗位匹配度与关键词覆盖",
      short: "岗位匹配",
      weight: 30,
      focus: "工作 / 项目经历与目标岗位职责的吻合度、ATS 硬技能与关键词的覆盖率。",
      high: "核心职责与岗位 JD 高度对应，关键词自然密集，\"对口\"一目了然。",
      low: "方向漂移、关键词大面积缺失、需要 HR 脑补才能与岗位挂钩。",
    },
    {
      label: "业务价值与量化成果",
      short: "量化成果",
      weight: 25,
      focus: "是否用数字证明影响力（营收、效率、规模、用户量、成本等）。",
      high: "多数经历有可信量化结果，能看出实际业务贡献。",
      low: "通篇\"负责 / 参与 / 协助\"，零量化，无法判断真实产出。",
    },
    {
      label: "经历清晰度与初筛可读性",
      short: "初筛可读",
      weight: 20,
      focus: "6 秒初筛内能否抓住亮点；结构、信息密度、亮点前置程度。",
      high: "标题 / 亮点前置、逻辑清晰，HR 一眼能定位价值。",
      low: "流水账、职责堆砌、重点被淹没。",
    },
    {
      label: "履历稳定性与风险信号",
      short: "履历稳定",
      weight: 15,
      focus: "跳槽频率、空窗期、职级 / 行业跳跃、与岗位不符的硬伤。",
      high: "履历连贯，无明显减分项。",
      low: "频繁短期跳槽 / 长空窗 / 无法解释的断层。",
    },
    {
      label: "信息完整度与 ATS 友好度",
      short: "ATS 友好",
      weight: 10,
      focus: "联系方式、目标方向、可被系统解析的结构是否齐全。",
    },
  ],
  interviewer_agent: [
    {
      label: "技术栈深度与岗位匹配",
      short: "技术深度",
      weight: 30,
      focus: "核心技术栈与目标岗位要求的吻合度、深度（是否停留在\"会用\"还是触及原理 / 调优 / 源码）。",
      high: "技术栈对口且有纵深，能看出体系化掌握。",
      low: "技能罗列堆砌、与岗位错配、只见名词不见深度。",
    },
    {
      label: "项目复杂度与职责边界",
      short: "项目复杂度",
      weight: 25,
      focus: "是否交代系统规模、难点、技术决策与个人职责边界——即\"能否据此追问出真实贡献\"。",
      high: "清楚交代复杂度 / 难点 / 个人决策，追问点丰富。",
      low: "职责模糊、团队成果与个人贡献混为一谈、无法定位 ta 到底做了什么。",
    },
    {
      label: "工程能力信号",
      short: "工程能力",
      weight: 20,
      focus: "ownership、排障、性能优化、架构设计、稳定性 / 质量建设等可验证的工程信号。",
      high: "有明确的工程主导动作与可量化效果。",
      low: "只有功能开发描述，缺乏深度工程信号。",
    },
    {
      label: "成果可信度与叙事一致性",
      short: "成果可信",
      weight: 15,
      focus: "量化数据是否经得起追问，技能-项目-职责三者是否自洽，有无注水 / 夸大迹象。",
      high: "数据合理、前后自洽、可被追问验证。",
      low: "数字浮夸或孤立、技能与项目对不上、疑似包装注水（请直接点名并扣分）。",
    },
    {
      label: "技术广度与成长曲线",
      short: "技术广度",
      weight: 10,
      focus: "技术视野、跨领域能力与持续成长的迹象。",
    },
  ],
  career_master_agent: [
    {
      label: "职业定位清晰度与赛道连贯性",
      short: "职业定位",
      weight: 30,
      focus: "技能组合、过往经历与目标岗位是否构成一条连贯、可信的职业主线。",
      high: "定位清晰，经历层层递进，赛道逻辑自洽。",
      low: "方向摇摆、经历拼盘、看不出一条主线。",
    },
    {
      label: "职级 / 赛道匹配度",
      short: "职级匹配",
      weight: 25,
      focus: "seniority、职责量级、影响力范围是否与目标岗位的层级预期对齐。",
      high: "职责量级与目标职级匹配甚至略有溢出。",
      low: "明显低配（够不上目标职级）或高开低走。",
    },
    {
      label: "差异化叙事与记忆点",
      short: "差异化",
      weight: 20,
      focus: "是否有区别于同类候选人的标签、故事线或独特优势。",
      high: "有让人记住的差异化标签与叙事钩子。",
      low: "高度同质化、千人一面、毫无记忆点。",
    },
    {
      label: "长期竞争力与成长性",
      short: "长期竞争力",
      weight: 15,
      focus: "技能组合的复利效应、行业卡位与可持续成长迹象。",
      high: "技能与经历形成壁垒，成长性强。",
      low: "技能易被替代、缺乏纵深与卡位。",
    },
    {
      label: "面试可讲性与叙事张力",
      short: "面试可讲",
      weight: 10,
      focus: "经历是否便于在面试中展开成有张力的故事。",
    },
  ],
};

// 终审维度与三位专家一一对应：Summary 的维度分就是对专家结论的再校准。
export const SUMMARY_RUBRIC: RubricDimension[] = [
  { label: "招聘初筛竞争力", short: "初筛竞争力", weight: 35, focus: "对应 HR Agent：岗位匹配、量化成果、初筛可读性与履历风险。" },
  { label: "技术面试可信度", short: "面试可信度", weight: 35, focus: "对应 Interviewer Agent：技术深度、项目复杂度、工程信号与成果可信度。" },
  { label: "职业定位与差异化", short: "定位差异化", weight: 30, focus: "对应 Career Master Agent：赛道连贯性、职级匹配与差异化叙事。" },
];

export const SUMMARY_REVIEWER_WEIGHTS: Record<ReviewerRubricName, number> = {
  hr_agent: 35,
  interviewer_agent: 35,
  career_master_agent: 30,
};

export function rubricForStage(stage: string): RubricDimension[] | null {
  if (stage === "summary_agent") {
    return SUMMARY_RUBRIC;
  }
  return stage in REVIEWER_RUBRICS ? REVIEWER_RUBRICS[stage as ReviewerRubricName] : null;
}

/** 把 Prompt 用的评分维度渲染成编号文本。 */
export function formatRubricForPrompt(rubric: RubricDimension[]): string {
  return rubric
    .map((dimension, index) => {
      const lines = [`${index + 1}. ${dimension.label}（权重 ${dimension.weight}%）：${dimension.focus}`];
      if (dimension.high) {
        lines.push(`   · 高分（85+）：${dimension.high}`);
      }
      if (dimension.low) {
        lines.push(`   · 低分（<60）：${dimension.low}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function normalizeLabel(label: string): string {
  return label.replace(/[\s/／、与和&·（）()]/g, "").toLowerCase();
}

export type WeightedScore = {
  label: string;
  score: number;
  reason: string;
  dimension: RubricDimension | null;
  weight: number | null;
  /** 加权贡献分 = score × weight / 100 */
  contribution: number | null;
  /** 该维度距离满分的加权损失 */
  weightedGap: number | null;
};

/** 把模型给出的维度分与标准维度按名称（失败时按顺序）对齐，计算加权贡献。 */
export function applyRubricWeights(
  items: Array<{ label: string; score: number; reason: string }>,
  rubric: RubricDimension[] | null,
): {
  rows: WeightedScore[];
  /** 与 rubric 顺序对齐的维度分，未覆盖的维度为 null */
  dimensionScores: Array<number | null>;
  weightedTotal: number | null;
  coveredWeight: number;
} {
  if (!rubric) {
    return {
      rows: items.map((item) => ({ ...item, dimension: null, weight: null, contribution: null, weightedGap: null })),
      dimensionScores: [],
      weightedTotal: null,
      coveredWeight: 0,
    };
  }

  const dimensionScores: Array<number | null> = rubric.map(() => null);

  const used = new Set<number>();
  const findDimension = (label: string, index: number): number => {
    const target = normalizeLabel(label);
    const byName = rubric.findIndex((dimension, dimensionIndex) => {
      if (used.has(dimensionIndex)) {
        return false;
      }
      const candidate = normalizeLabel(dimension.label);
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
    if (byName >= 0) {
      return byName;
    }
    return items.length === rubric.length && !used.has(index) ? index : -1;
  };

  const rows = items.map((item, index) => {
    const dimensionIndex = findDimension(item.label, index);
    if (dimensionIndex < 0) {
      return { ...item, dimension: null, weight: null, contribution: null, weightedGap: null };
    }
    used.add(dimensionIndex);
    dimensionScores[dimensionIndex] = item.score;
    const weight = rubric[dimensionIndex].weight;
    return {
      ...item,
      dimension: rubric[dimensionIndex],
      weight,
      contribution: round1((item.score * weight) / 100),
      weightedGap: round1(((100 - item.score) * weight) / 100),
    };
  });

  const weighted = rows.filter((row) => row.weight !== null);
  const coveredWeight = weighted.reduce((sum, row) => sum + (row.weight ?? 0), 0);
  const weightedTotal =
    coveredWeight > 0
      ? round1(weighted.reduce((sum, row) => sum + row.score * (row.weight ?? 0), 0) / coveredWeight)
      : null;

  return { rows, dimensionScores, weightedTotal, coveredWeight };
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
