# Resume Multi-Agent Review | AI 协同简历诊疗与智能重写平台

> **Bilingual Edition (中英对照版)**

`Resume Multi-Agent Review` is a high-caliber full-stack platform for multi-agent resume evaluation, diagnosis, and autonomous rewriting, built with **Next.js + TypeScript + Vercel AI SDK**. No database or login is required.

`Resume Multi-Agent Review` 是一款基于 **Next.js + TypeScript + Vercel AI SDK** 构建的多智能体（Multi-Agent）简历评测、诊断与自动重写平台，无需数据库、无需登录。

By leveraging a pipeline of specialized AI agents, the platform extracts a candidate's profile, conducts a 360° deep consultation across HR screening, technical interview depth, and career planning narrative, and automatically rebuilds a **high-density, STAR-aligned, tailored golden 2-page resume**.

系统采用创新的多智能体协同流水线架构，能够实时提取候选人画像，从 HR 筛选、技术面试官提问、职业规划师定位三个专业维度进行 360° 深度会诊，最后由终审重写专家根据修改建议和求职目标自动重构出一份**高密度、STAR 原则润色、精准切合求职意向的黄金 2 页简历**。

---

## 🌟 Key Features & Highlights | 核心特色与功能亮点

### 1. 🚀 7-Stage Collaborative Multi-Agent Pipeline | 七阶段智能协同流水线
The pipeline processes tasks asynchronously/concurrently according to dependency trees, streaming real-time stage progress and metrics to the frontend UI:

系统按照严格的依赖关系进行异步/并发流式处理，并在浏览器前端实时渲染阶段进度与流式指标：

1. 📂 **Resume Loader (简历读取器)**: Parses raw PDF and Word (.docx) files.
2. 🔍 **Resume Parser (候选人画像解析)**: Extracts personal contact info, skill matrices, and core experiences.
3. 💼 **HR Agent (招聘初筛专家)**: Critiques ATS compatibility, business metrics quantization, and role matching.
4. 💻 **Interviewer Agent (资深技术面试官)**: Evaluates technical stack depth, architectural choices, and system design credibility.
5. 🧭 **Career Master Agent (职业规划大师)**: Provides advice on unique career narratives, positioning, and market competitiveness.
6. 📊 **Summary Agent (多维度诊断汇总)**: Merges all feedback into actionable, section-by-section optimization guidelines.
7. ✨ **Resume Rewrite Agent (终审重写优化专家)**:
   - **Zero Loss Principle (零丢失原则)**: 100% preserves original experiences; no lazy truncation or summarization.
   - **STAR Methodology (STAR 深度扩写)**: Enhances thin bullets with structured Context, Action, and quantifiable Results.
   - **Target Job Alignment (精准求职对齐)**: Infuses matching industry terminology and keywords tailored to the target role.
   - **Golden 2-Page Layout (黄金 2 页控制)**: strictly optimized visual harmony within `1000 - 1400` words.

### 2. 🔑 Bring Your Own Model | 自带模型配置
- Click **模型配置** in the top-right corner, pick a protocol and fill in `base_url`, `api_key` and `model_name`.
- Supported protocols: `Responses` (`/responses`), `Messages` (Anthropic, `/messages`) and `Chat` (`/chat/completions`). `base_url` is the prefix before these paths, e.g. `https://api.example.com/v1`.
- **测试联通性** sends `hi` over all three protocols and lists each result. A failed protocol shows a `?` icon; hover it to see the full request result.
- The config is stored only in the browser's `localStorage` and sent with each request; the server never persists it. Rotate or delete the key when you are done, and click **清除** to remove it locally.

点击右上角 **模型配置**，选择协议并填写 `base_url` / `api_key` / `model_name`。测试联通性会用三种协议各发一次 `hi` 并展示全部结果。配置仅保存在浏览器本地，随请求发送，服务端不落盘；使用完毕建议更新/删除 key。

### 3. 🎨 Premium UI/UX Design | 极致奢华的现代 UI/UX 体验
- **Obsidian Glassmorphism System (黑曜石玻璃态设计)**: Dark aesthetics matched with HSL polar gradients, smooth micro-animations, and high-contrast visuals.
- **Rewrite Workbench (简历重写成果工作台)**: Markdown visualizer with direct Markdown export and high-fidelity client-side PDF export (powered by `html2pdf.js`).

---

## 🛠️ Technology Stack | 技术栈清单

- **Core**: Next.js (App Router, Turbopack) / React 19 / TypeScript / pnpm
- **AI Orchestration**: Vercel AI SDK / `@ai-sdk/openai` / `@ai-sdk/anthropic` / Structured JSON Outputs (Zod Schema)
- **Document Parsing**: `pdf-parse` / `mammoth` (Word Parser)
- **High-Fidelity PDF Export**: `html2pdf.js` / `html2canvas` / `jsPDF`
- **Icon Suite**: `lucide-react`

---

## 📂 Project Architecture | 核心目录架构

```text
src/
  app/
    api/
      llm/test/route.ts     # Connectivity test over all protocols | 多协议联通性测试
      pdf-agent/route.ts    # Agent Chat NDJSON streaming | Agent 对话流式接口
      review/route.ts       # Review NDJSON streaming | 简历诊断流式接口
    styles/                 # Page styles imported by globals.css | 分模块样式
    page.tsx                # Splash entry | 首页入口
  components/
    entry-gateway.tsx       # Splash page with "尝试一下" | 首页欢迎页
    llm-config-menu.tsx     # Protocol / base_url / api_key / model_name panel | 模型配置面板
    review-studio.tsx       # Review workspace state & streaming | 诊断工作台
    workflow-timeline.tsx   # Workflow canvas & connectors | 流程画布
    review-stage-detail.tsx # Stage result drawer & PDF export | 节点详情与导出
    pdf-agent-workbench.tsx # Agent Chat workspace | Agent 对话工作台
  lib/
    agents/
      base.ts               # Streaming agent runner | Agent 调用基座
      resume-chat.ts        # Agent Chat (resume Q&A / editing) | 简历对话 Agent
      workflow/             # Parser / reviewers / summary / rewrite agents | 评审流水线 Agent
    llm/
      config.ts             # Protocols, config schema, FormData helpers | 协议与配置校验
      model.ts              # Per-request model factory (AsyncLocalStorage) | 按请求创建模型
      storage.ts            # Browser-side config storage | 浏览器端配置存取
    resume/                 # File loading & signal extraction | 简历读取与信号提取
    review/
      pipeline.ts           # Multi-agent pipeline | 多 Agent 流水线调度
      stages.ts             # Stage order & status | 节点顺序与状态
      schemas.ts            # Zod schemas | 统一数据结构
      local-run-cache.ts    # IndexedDB checkpoint | 本地断点缓存
test/                       # All tests, mirroring src/ | 全部测试
```

---

## 🚀 Run Locally | 本地运行

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click **尝试一下**, then configure your model in the top-right **模型配置** panel.

Optional: copy `.env.template` to `.env` to tune agent timeouts (`AGENT_TOTAL_TIMEOUT_MS`, `AGENT_CHUNK_TIMEOUT_MS`).

---

## 🧪 Verification & Unit Testing | 静态校验与单元测试

Execute the built-in test suite covering multi-agent stream pipelines and UI structure validations:

```bash
# Typecheck codebase | 强类型 TypeScript 校验
pnpm typecheck

# Run unit tests in test/ | 运行 test/ 下的单元测试
pnpm test
```
