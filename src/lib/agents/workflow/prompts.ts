import { REVIEWER_RUBRICS, SUMMARY_RUBRIC, type RubricDimension } from "@/lib/review/rubrics";

const RULES = `使用简体中文，严格按要求的结构输出，短句优先，不重复输入。
只使用候选人已提供的事实，不编造经历、技术选型、职责或量化成果；缺失信息明确指出。
不要输出隐藏推理过程，不写开场白。`;

function rubricContext(rubric: RubricDimension[]) {
  return rubric.map((item) => `${item.label}（权重 ${item.weight}%）`).join("、");
}

export function formatTargetJobContext(targetJob?: { title: string; description?: string }): string {
  return targetJob
    ? `目标岗位：${targetJob.title}\n岗位描述：${targetJob.description?.trim() || "未提供，依据岗位名称判断并注明假设。"}`
    : "未提供目标岗位，依据简历判断并注明假设。";
}

export function buildResumeParserPrompt(): string {
  return `${RULES}
你只负责提取简历事实，不做评分、建议或长篇分析。
保留每段工作、项目和教育经历的名称、时间、职责及已有成果；描述用简短原文要点，避免重复。
每段经历的职责、成果或亮点各最多3条，每条最多80字；技能去重。
headline最多40字，目标方向最多2个；strengths、risks、reasoningSummary输出空数组，missingInformation最多3条。
原文没有的信息用空字符串或空数组，不扩写。`;
}

function advicePrompt(role: string, rubric: RubricDimension[]): string {
  return `${RULES}
你的角色：${role}。本次只补充建议；三视角评分已经完成，不重新评分、不返回评分字段。
已有评分的维度：${rubricContext(rubric)}。
结合画像与已有评分，优先解决最大短板，最多3条建议，每条issue最多60字、recommendation最多100字。
strengths和concerns各最多2条、每条最多60字；reasoningSummary最多1条、最多80字。
不输出示例改写或expectedGain，完整简历由后续独立调用改写。`;
}

export function buildHrPrompt() {
  return advicePrompt("HR / ATS，关注岗位匹配、关键词和初筛可读性", REVIEWER_RUBRICS.hr_agent);
}
export function buildInterviewerPrompt() {
  return advicePrompt("技术面试官，关注项目可信度、职责边界与可追问的技术证据", REVIEWER_RUBRICS.interviewer_agent);
}
export function buildCareerMasterPrompt() {
  return advicePrompt("职业规划顾问，关注定位、职级匹配与差异化", REVIEWER_RUBRICS.career_master_agent);
}

export function buildSummaryPrompt(): string {
  return `${RULES}
整合三位专家的简短建议，去重、处理冲突，按收益排序，生成最终行动清单。
评分已按 ${rubricContext(SUMMARY_RUBRIC)} 由代码固定，本次不要重新评分或输出评分字段。
executiveSummary最多120字，reasoningSummary最多2条且每条最多60字，topPriorities最多3条且每条最多60字。
sectionRevisions最多5条，每条issue最多60字、recommendation最多100字。
不要输出示例改写和预计提分，也不要重复罗列专家意见。`;
}

export function buildRewritePrompt(): string {
  return `${RULES}
根据简历原文、目标岗位和行动清单，输出一份精简、可直接使用的Markdown简历。
保留真实身份、公司、时间、核心经历和已有成果；合并重复表达，不补造数字或技术细节。
目标约1000-1400字，依据原文信息量调整，不为凑字数扩写。每段经历优先保留2-3条关键要点。
简历模板库：自动选择最适合的一套模板：工程技术深度模板（技能/工作/项目/教育）、业务增长结果模板（摘要/能力/经历/教育）、职业转型桥接模板（定位/可迁移能力/相关项目/经历/教育）、早期职业潜力模板（教育/项目/实习/技能）。
仅在改写说明中用一句话说明所选模板，不展开比较。
不要使用双栏、表格、图表、头像或装饰性排版。只输出本次请求指定的内容和标签；正文与说明分开调用。`;
}
