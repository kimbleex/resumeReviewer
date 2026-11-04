# Resume Multi-Agent Review | AI 协同简历诊疗与智能重写平台

> **Bilingual Edition (中英对照版)**

`Resume Multi-Agent Review` is a high-caliber full-stack platform for multi-agent resume evaluation, diagnosis, and autonomous rewriting, built with **Next.js + TypeScript + Vercel AI SDK**. No database or login is required.

`Resume Multi-Agent Review` 是一款基于 **Next.js + TypeScript + Vercel AI SDK** 构建的多智能体（Multi-Agent）简历评测、诊断与自动重写平台，无需数据库、无需登录。

By leveraging a pipeline of specialized AI agents, the platform extracts a candidate's profile, conducts a 360° deep consultation across HR screening, technical interview depth, and career planning narrative, and automatically rebuilds a **high-density, STAR-aligned, tailored golden 2-page resume**.

系统采用创新的多智能体协同流水线架构，能够实时提取候选人画像，从 HR 筛选、技术面试官提问、职业规划师定位三个专业维度进行 360° 深度会诊，最后由终审重写专家根据修改建议和求职目标自动重构出一份**高密度、STAR 原则润色、精准切合求职意向的黄金 2 页简历**。

---

## 🌟 Key Features & Highlights | 核心特色与功能亮点

### 1. Progressive Results | 先评分、再建议、后改写

The workflow publishes each completed result immediately. A single scoring call evaluates three perspectives; code calculates the weighted scores. Short advice calls reuse those scores, followed by an action list and one final rewrite.

流程：**读取 → 事实解析 → 三视角评分 → 三位专家并行补充建议 → 行动清单 → 简历改写**。

- **先看评分**：一次调用输出 HR、面试官、职业定位各5个维度的分数与短证据；代码计算各视角总分及 35% / 35% / 30% 的综合分。评分完成后，评分卡片、专家卡片和报告立即可查看，无需等建议与改写完成。
- **逐步补齐建议**：每位专家最多3条建议，不再重复打分、生成示例改写或猜测提分；汇总最多5条去重后的修改行动。
- **一次完整改写**：保留真实事实，参考1000–1400字目标，说明最多3条。缺少成果数字或技术细节时不编造。
- **分步断点**：评分独立保存；刷新或中断后可继续。仅有评分的预览不标记为建议已完成，每位专家完成后单独缓存。
- **每次调用可追踪**：实时日志显示调用名称、调用ID、请求/推理/输出/校验阶段，完成时显示耗时、token用量及结束原因（用量以供应商返回为准）。不展示隐藏推理原文。

默认一次完整流程共12次模型调用（读取文件不调用模型）：事实解析、三视角评分、每位专家各2次（优势与问题→修改建议）、汇总2次（优先行动→逐板块建议）、改写2次（正文→改写说明）。三个专家各自依次执行，其间保持并行；每个小步骤完成后立即展示并保存断点。

应用不设置输出 token 上限，通过拆分业务内容、简短提示词与精简字段减少单次生成量。总耗时仍受模型推理和请求开销影响；每次调用关闭自动重试，失败后从已完成的小步骤继续。旧版缺少评分断点的任务只复用原文和画像。

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
      workflow/             # Parser / scoring / advice / summary / rewrite agents | 评审流水线 Agent
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

## Docker Deployment | 服务器 Docker 部署

可以在本地构建镜像并压缩上传，服务器无需项目源码或 Node.js 环境。
以下以 Linux x86_64 服务器为例（ARM 服务器将平台改为 `linux/arm64`）：

```bash
# 本地构建并导出
docker buildx build --platform linux/amd64 -t resume-reviewer:latest --load .
docker save resume-reviewer:latest | gzip > resume-reviewer.tar.gz

# 上传（替换服务器地址和目标目录）
scp resume-reviewer.tar.gz 用户名@服务器IP:/你的部署目录/
```

服务器进入上传目录，加载并启动：

```bash
docker load -i resume-reviewer.tar.gz
docker run -d --name resume-reviewer --restart unless-stopped --init \
  -p 3000:3000 resume-reviewer:latest
docker logs -f --tail 100 resume-reviewer
```

更新已有部署时，先加载新镜像，再停止占用 3000 端口的旧容器，使用新的容器名启动；验证正常后再删除旧容器。

也可以使用源码构建方式：服务器安装 Docker Engine 和 Compose 插件，将本仓库上传或克隆到服务器，
在项目根目录执行：

```bash
docker compose up -d --build
docker compose logs -f --tail=100 app
```

访问 `http://服务器IP:3000`（需要服务器允许访问该端口）。
模型连接仍在网页右上角配置。镜像使用 Next.js standalone，
构建阶段会安装依赖并执行一次 Next.js 构建。

Compose 默认设置单次模型调用总超时 300 秒、流式数据块等待超时 150 秒。
可在根目录 `.env` 中覆盖（Compose 自动读取此文件，镜像不包含它）：

```dotenv
APP_PORT=3000
AGENT_TOTAL_TIMEOUT_MS=300000
AGENT_CHUNK_TIMEOUT_MS=150000
```

修改环境变量后运行 `docker compose up -d`。更新代码后运行：

```bash
git pull
docker compose up -d --build
```

停止服务用 `docker compose down`。如果已有 Nginx 反向代理，
在对应 `location /` 中配置流式转发，例如：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    client_max_body_size 20m;
}
```

该示例假设 Nginx 直接运行在宿主机。域名与 HTTPS 在反向代理中配置。
应用超时无法覆盖上游模型服务自身的超时或错误。

## 🧪 Verification & Unit Testing | 静态校验与单元测试

Execute the built-in test suite covering multi-agent stream pipelines and UI structure validations:

```bash
# Typecheck codebase | 强类型 TypeScript 校验
pnpm typecheck

# Run unit tests in test/ | 运行 test/ 下的单元测试
pnpm test
```
