# Resume Multi-Agent Review | AI 协同简历诊疗与智能重写平台
> **Bilingual Edition (中英对照版)**

`Resume Multi-Agent Review` is a high-caliber full-stack platform for multi-agent resume evaluation, diagnosis, and autonomous rewriting, built with **Next.js + TypeScript + Vercel AI SDK**.

`Resume Multi-Agent Review` 是一款基于 **Next.js + TypeScript + Vercel AI SDK** 构建的高水准多智能体（Multi-Agent）简历评测、诊断与自动重写重构的 Full-stack 平台。

By leveraging a pipeline of specialized AI agents, the platform extracts a candidate's profile, conducts a 360° deep consultation across HR screening, technical interview depth, and career planning narrative, and automatically rebuilds a **high-density, STAR-aligned, tailored golden 2-page resume**.

系统采用创新的多智能体协同流水线架构，能够实时提取候选人画像，从 HR 筛选、技术面试官提问、职业规划师定位三个专业维度进行 360° 深度会诊，最后由终审重写专家根据修改建议和求职目标自动重构出一份**高密度、STAR 法则润色、精准切合求职意向的黄金 2 页简历**。

---

## 🌟 Key Features & Highlights | 核心特色与功能亮点

### 1. 🚀 7-Stage Collaborative Multi-Agent Pipeline | 七阶段智能协同流水线
The pipeline processes tasks asynchronously/concurrently according to dependency trees, streaming real-time stage progress and metrics to the frontend UI:

系统按照严格的依赖关系进行异步/并发流式处理，并在浏览器前端实时渲染阶段进度与流式指标：

1. 📂 **Resume Loader (简历读取器)**: Parses raw PDF and Word (.docx) files.
   
   解析 PDF, Word (docx) 原始文件。
2. 🔍 **Resume Parser (候选人画像解析)**: Extracts personal contact info, skill matrices, and core experiences.
   
   提取基础属性、个人信息、技能矩阵与核心经历。
3. 💼 **HR Agent (招聘初筛专家)**: Critiques ATS compatibility, business metrics quantization, and role matching.
   
   从招聘匹配度、业务量化结果、ATS 友好度进行评审。
4. 💻 **Interviewer Agent (资深技术面试官)**: Evaluates technical stack depth, architectural choices, and system design credibility.
   
   从技术栈深度、工程设计、架构选型、追问可信度进行硬核考核。
5. 🧭 **Career Master Agent (职业规划大师)**: Provides advice on unique career narratives, positioning, and market competitiveness.
   
   从差异化职业叙事、定位清晰度及核心竞争力给出包装指导。
6. 📊 **Summary Agent (多维度诊断汇总)**: Merges all feedback into actionable, section-by-section optimization guidelines.
   
   合并各 Agent 的诊断意见，收敛生成多版块的具体落地修改指南。
7. ✨ **Resume Rewrite Agent (终审重写优化专家) [NEW!]**:
   - **Zero Loss Principle (零丢失原则)**: 100% preserves original project backgrounds and roles; no lazy truncation or summarization.
     
     100% 完整保留原有项目和工作核心背景，绝不敷衍裁剪。
   - **STAR Methodology Technical Expansion (STAR 深度扩写)**: Enhances thin bullets with structured Context, Action, and quantifiable Results (latency reduction, cost efficiency).
     
     围绕目标岗位，用 STAR 原则扩充技术决策、工程架构选型及量化业务指标。
   - **Target Job Alignment (精准求职对齐)**: Infuses matching industry terminology and keywords tailored to the target role.
     
     全局融入目标行业的关键词和“黑话”。
   - **Golden 2-Page Layout (黄金 2 页篇幅控制)**: Word count strictly optimized between `1000 - 1400` words for maximum high-density visual harmony.
     
     排版文字量精准控制在 `1000 - 1400` 字的黄金版面，内容饱满，排版洗练。

### 2. 🎨 Premium UI/UX Design | 极致奢华的现代 UI/UX 体验
- **Obsidian Glassmorphism System (黑曜石玻璃态设计)**: Dark aesthetics matched with HSL polar gradients, smooth micro-animations, and high-contrast visuals.
  
  高水准暗色调视觉体系，搭配 HSL 极光渐变、极富现代感的呼吸微动效和高对比度色彩搭配。
- **Dynamic Interactive Timeline (动态交互时间线)**: Interactive steps streaming progress, scores, and expandable detail boxes.
  
  流式展示各阶段 Agent 运作情况、诊断评分与细分维度折叠详情。
- **Rewrite Workbench (简历重写成果工作台)**:
   - Integrated dark-themed syntax preview container.
     
     集成精美黑暗风格的代码块预览框。
   - 💼 **Markdown Export (.md)**: One-click raw file saving.
     
     一键下载标准 Markdown 文件。
   - ✨ **Direct PDF Download (.pdf) [NEW!]**:
     - **Silent High-Fidelity Export (静默超清下载)**: Dynamic `html2pdf.js` dynamic compilation captures ultra-high definition A4 PDF vectors directly in the client **without opening the browser's native print menu**.
       
       引入 `html2pdf.js`，点击后直接在客户端捕捉 HTML 并打包输出超清 A4 矢量 PDF，**无需调用浏览器打印界面**。
     - **Dynamic Loading State (动态加载防抖状态)**: Renders spinning Loader and `"Generating PDF..."` state while running, avoiding double-clicking and improving responsiveness.
       
       点击生成时展示旋转 Loader 和 `正在生成 PDF 简历...` 的友好置灰状态，多操作防重复，交互体验极佳。

---

## 🛠️ Technology Stack | 技术栈清单

- **Core**: Next.js (App Router, Turbopack) / React 19 / TypeScript
- **AI Orchestration**: Vercel AI SDK / `@ai-sdk/openai` / Structured JSON Outputs (Zod Schema)
- **Document Parsing**: `pdf-parse` / `mammoth` (Word Parser)
- **High-Fidelity PDF Export**: `html2pdf.js` / `html2canvas` / `jsPDF`
- **Icon Suite**: `lucide-react`

---

## 📂 Project Architecture | 核心目录架构

```text
src/
  app/
    api/review/route.ts   # Multi-agent streaming backend (NDJSON Stream) | 多 Agent 流水线流式接口
    globals.css           # Glassmorphism & polar dark styling | 玻璃态与极光暗色调全局样式
    layout.tsx
    page.tsx              # Workspace dashboard entry | 简历上传与主工作台调度入口
  components/
    review-studio.tsx     # Review studio dashboard, stages & PDF export | 核心诊断工作台与 PDF 模块
  lib/
    agents/
      base.ts             # Agent runtime base class | 智能体运行基类
      prompts.ts          # Multi-agent role prompts | 多智能体角色扮演系统级 Prompts
      resume-parser.ts
      hr.ts
      interviewer.ts
      career-master.ts
      summary.ts
      rewrite.ts          # [NEW!] Rewrite Agent implementation | 智能重写优化 Agent 实现
    resume/
      loader.ts           # Doc file parsing loader | 文档数据读取引擎
      signals.ts
    review/
      pipeline.ts         # Multi-agent concurrent pipeline pipeline | 多 Agent 流水线编排
      schemas.ts          # Zod schema definitions | Zod 强类型数据 schema 校验
```

---

## ⚙️ Environment Variables | 环境变量配置

Create a `.env.local` file at the root to bind with any OpenAI-compatible API endpoint:

在项目根目录创建 `.env.local` 即可接入任意 OpenAI 兼容的 API 端点：

```bash
API_KEY=your_api_key
BASE_URL=https://your-compatible-endpoint.example.com/v1
MAIN_MODEL=your-model-name
```

---

## 🚀 Run Locally | 本地极速运行

1. **Install Dependencies | 安装依赖**:
   ```bash
   npm install
   ```
2. **Start Dev Server | 启动本地开发服务器**:
   ```bash
   npm run dev
   ```
3. **Open App | 访问平台**:
   Navigate to [http://localhost:3000](http://localhost:3000).

---

## 🧪 Verification & Static Checks | 静态校验与测试

```bash
npm run typecheck   # Typecheck codebase | 强类型 TypeScript 校验
npm test            # Run unit tests | 单元测试运行
```
