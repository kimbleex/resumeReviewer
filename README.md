# Resume Multi-Agent Review | AI 协同简历诊疗与智能重写平台

> **Bilingual Edition (中英对照版)**

`Resume Multi-Agent Review` is a high-caliber full-stack platform for multi-agent resume evaluation, diagnosis, and autonomous rewriting, built with **Next.js + TypeScript + Vercel AI SDK + Prisma + PostgreSQL**.

`Resume Multi-Agent Review` 是一款基于 **Next.js + TypeScript + Vercel AI SDK + Prisma + PostgreSQL** 构建的高水准多智能体（Multi-Agent）简历评测、诊断、自动重写与安全鉴权一体化的 Full-stack 平台。

By leveraging a pipeline of specialized AI agents, the platform extracts a candidate's profile, conducts a 360° deep consultation across HR screening, technical interview depth, and career planning narrative, and automatically rebuilds a **high-density, STAR-aligned, tailored golden 2-page resume**. It now features standard relational database persistence, session security controls, guest trial challenge engines, and a unified administrator control dashboard.

系统采用创新的多智能体协同流水线架构，能够实时提取候选人画像，从 HR 筛选、技术面试官提问、职业规划师定位三个专业维度进行 360° 深度会诊，最后由终审重写专家根据修改建议和求职目标自动重构出一份**高密度、STAR 原则润色、精准切合求职意向的黄金 2 页简历**。全新版本融入了标准关系数据库持久化、会话安全管控、游客设备指纹与挑战答题流控，以及功能齐备的专属管理员看板。

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

### 2. 🛡️ Advanced Identity, Authentication & Sessions [NEW!] | 完备的用户身份认证与会话管理
- **High-Security Cryptography (高强度加解密)**: Uses `Argon2id` for hashing credentials, protecting passwords against GPU-accelerated brute force attacks.
- **HttpOnly JWT Session Control (安全会话管理)**: Access tokens stored in strict HttpOnly cookies, coupled with database-tracked opaque sliding refresh token rotations.
- **Fingerprinted Guest Trial Engine (防刷游客试用引擎)**: Renders a unique cryptographic challenge to verify visitor browser fingerprints, tracking trial counts dynamically to prevent abuse.
- **Identity-Aware UI & API Guards (全链路鉴权网关)**: Review route handler verifies session tokens, mapping logs directly to registered accounts or verified guests.

### 3. 🖥️ Interactive Administrator Control Panel [NEW!] | 极光暗黑管理员管理后台
- **Live Monitoring (实时看板)**: Admin dashboard at `/admin` (session-protected) monitors system status, active review runs, and registered users.
- **Account Control (账户审计控制)**: Revoke session families dynamically, reset member passwords instantly, and change account statuses (`Active` / `Blocked`).
- **Trial & Spammer Management (游客与防刷限制)**: Monitor visitor device fingerprints and dynamically adjust guest trial limits or ban anomalous fingerprints.

### 4. 🎨 Premium UI/UX Design | 极致奢华的现代 UI/UX 体验
- **Obsidian Glassmorphism System (黑曜石玻璃态设计)**: Dark aesthetics matched with HSL polar gradients, smooth micro-animations, and high-contrast visuals.
- **Rewrite Workbench (简历重写成果工作台)**: Markdown visualizer with direct Markdown export and high-fidelity client-side PDF export (powered by `html2pdf.js`).

---

## 🛠️ Technology Stack | 技术栈清单

- **Core**: Next.js (App Router, Turbopack) / React 19 / TypeScript
- **Database & Persistence**: Prisma ORM / PostgreSQL / Connection Pooling
- **Security & Session**: jose (JWT signing) / `@node-rs/argon2` (Argon2id hashing)
- **AI Orchestration**: Vercel AI SDK / `@ai-sdk/openai` / Structured JSON Outputs (Zod Schema)
- **Document Parsing**: `pdf-parse` / `mammoth` (Word Parser)
- **High-Fidelity PDF Export**: `html2pdf.js` / `html2canvas` / `jsPDF`
- **Icon Suite**: `lucide-react`

---

## 📂 Project Architecture | 核心目录架构

```text
prisma/
  migrations/             # Database relational migration scripts | 数据库结构关系迁移脚本
  schema.prisma           # Prisma database schemas modeling | Prisma 数据模型定义
src/
  app/
    admin/
      page.tsx            # Administrator console UI panel | 极光暗黑管理员看板主页
    login/
      page.tsx            # Login route portal | 登录入口页面
    api/
      admin/              # Admin CRUD APIs (Users, Guests, Sessions) | 管理端用户、游客及会话控制接口
      auth/               # Token-based auth endpoints (Login, Logout, Refresh) | 用户会话鉴权接口
      guest/              # Visitor fingerprint challenge & registration | 游客防刷挑战与注册接口
      review/
        route.ts          # Protected NDJSON review streaming | 经过鉴权保护的简历诊断流式接口
    globals.css           # Glassmorphism & dark visual styling | 玻璃态与极光暗色调全局样式
    page.tsx              # Workspace dashboard & Gateway entry | 主工作台调度与身份网关入口
  components/
    admin-panel.tsx       # Admin workbench interactive interface | 管理端后台控制面板
    auth-gateway.tsx      # Multi-identity check (User / Guest / Admin) | 多身份感知决策网关
    login-page.tsx        # Standard user & administrator login form | 用户与管理员登录表单
    review-studio.tsx     # Review studio dashboard & PDF export | 核心诊断工作台与 PDF 模块
  lib/
    admin/
      service.ts          # Admin business orchestration service | 管理员后台业务编排服务
    auth/
      actors.ts           # Actor context parser (User vs Guest) | 用户与游客上下文解析决策
      bootstrap.ts        # Bootstrap system admin generator | 默认超级管理员引导生成
      cookies.ts          # Strict HttpOnly Cookie helpers | HttpOnly Cookie 会话配置器
      guest.ts            # Guest fingerprint crypt-challenge logic | 游客指纹答题限流防刷算法
      password.ts         # Argon2id password hashing helpers | Argon2id 密码哈希助手
      sessions.ts         # User session lifecycle (Creation & Rotation) | 会话周期管理与滑动刷新
      tokens.ts           # Access token encryption & Refresh tokens | JWT 生成与 refresh token 哈希
    db/
      prisma.ts           # Prisma client singleton container | Prisma 客户端单例容器
    env.ts                # Multilevel environment bootstrap config | 环境变量多级读取装载
    review/
      pipeline.ts         # Multi-agent concurrent pipeline | 多 Agent 流水线调度
      schemas.ts          # Unified Zod schemas verification | 统一 Zod 数据结构规范与校验
```

---

## 💾 Relational Data Modeling | 数据模型设计

The application uses a standard relational model with **4 key tables**:

| Table Name | Description | Key Fields | Indexes / Features |
| :--- | :--- | :--- | :--- |
| **`User`** | Registered members & admins | `id`, `username`, `passwordHash`, `role`, `status`, `lastLoginAt` | Unique usernames, index on status. Supports `MEMBER` & `ADMIN`. |
| **`Session`** | User active login session | `id`, `userId`, `refreshTokenHash`, `status`, `ipHash`, `expiresAt` | Foreign key to `User`, Cascade on delete. Supports family revocation. |
| **`GuestIdentity`** | Visitor hardware fingerprint trace | `id`, `fingerprintHash`, `publicKeyHash`, `trialUsedCount`, `maxTrialCount` | Enforces client cryptographic answer challenge verification to protect endpoints. |
| **`ReviewRun`** | Audit log for every pipeline run | `id`, `userId`, `guestId`, `actorType`, `status`, `targetRole` | Fully tracked audit logs mapping to either `User` or `GuestIdentity`. |

---

## ⚙️ Environment Variables | 环境变量配置

Create a `.env` (or `.env.local`) file at the root path:

在项目根目录创建 `.env` (或 `.env.local`) 填入以下配置：

```bash
# OpenAI-compatible LLM Settings | LLM 接入配置
API_KEY=your_llm_api_key
BASE_URL=https://your-compatible-endpoint.example.com/v1
MAIN_MODEL=your-model-name

# PostgreSQL Connection | 关系型数据库连接
DATABASE_URL="postgresql://postgres:password@localhost:5432/resumedb?schema=public"

# Auth Session Configuration | 安全会话与鉴权配置
SESSION_SECRET="your-32-character-jwt-signing-secret"

# Default Super Admin Account (Bootstrapped on init) | 默认超级管理员账户（首次启动自动引导）
ADMIN="admin"
ADMIN_PWD="YourSecureSuperPassword123"
```

---

## 🚀 Run Locally & DB Migration | 本地运行与数据库迁移

### 1. **Install Dependencies | 安装依赖**
```bash
npm install
```

### 2. **Apply Database Schema | 同步数据库结构**
Generate the Prisma Client and migrate your PostgreSQL schema:
```bash
# Apply schemas directly in dev environment | 直接应用数据库结构到本地开发环境
npx prisma db push

# Generate Prisma types | 生成 Prisma 类型声明
npx prisma generate
```

### 3. **Start Dev Server | 启动本地开发服务器**
When starting, the system will automatically parse `ADMIN` and `ADMIN_PWD` from env variables and bootstrap the default super administrator account if no admin exists in the database.
```bash
npm run dev
```

### 4. **Open App | 访问平台**
Navigate to [http://localhost:3000](http://localhost:3000).
- Normal User / Visitor: Access the workspace directly. Visitors can claim a guest trial through fingerprint verification.
- Administrator Panel: Log in using your admin credentials, then access [http://localhost:3000/admin](http://localhost:3000/admin).

---

## 🧪 Verification & Unit Testing | 静态校验与单元测试

Execute the built-in test suite covering multi-agent stream pipelines, Argon2 hashing strength, JWT sessions, and UI structure validations:

```bash
# Typecheck codebase | 强类型 TypeScript 校验
npm run typecheck

# Run 26 high-coverage unit tests | 极速运行 26 个高覆盖率单元测试用例
npm test
```
