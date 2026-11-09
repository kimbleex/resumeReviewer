# Resume Multi-Agent Review · AI 简历评审与改写

基于 Next.js、TypeScript 和 Vercel AI SDK 的简历评审工具。上传简历、填写目标岗位，再使用自己的模型 API，从 HR、技术面试官和职业定位三个视角获取评分、修改建议与 Markdown 改写稿。无需数据库和登录。

A self-hosted resume review app built with Next.js, TypeScript and the Vercel AI SDK. Bring your own model API to get reviews from three perspectives and a rewritten resume in Markdown. No database or account required. The interface and documentation are primarily in Chinese.

## 功能

- **多视角评审**：解析简历事实，三个评审 Agent 并行工作，各自依次输出评分、优势与问题、修改建议，再汇总行动清单并改写。
- **逐步展示结果**：每次模型调用完成后更新报告，无需等待整个流程结束。综合分由代码按 HR 35%、面试官 35%、职业定位 30% 加权计算。
- **本地断点恢复**：在当前浏览器保存最近一次工作流的解析结果和已完成步骤，刷新后可继续未完成的调用。
- **改写与下载**：生成 Markdown 简历，支持下载和纯文本预览。提示词要求保留原始事实、避免编造成果数字；最终内容仍需人工核对。
- **自带模型**：支持 Responses、Messages（Anthropic）和 Chat Completions 三种 API 协议。
- **可选 Agent Chat**：默认关闭，开启后可围绕 PDF 简历进行多轮问答与修改，也可直接提问。

工作流支持 `.txt`、`.md`、`.pdf`、`.docx`；Agent Chat 的附件支持 PDF。PDF 使用文本提取，不包含 OCR，扫描件或图片型 PDF 需要先转成可复制的文字。

默认完整工作流包含 **14 次模型调用**：事实解析 1 次，三位评审各 3 次，汇总 2 次，改写 2 次。联通性测试还会对三种协议各发送一次 `hi`；这些请求可能产生模型费用。耗时和费用取决于供应商、模型与简历长度。

## 本地运行

环境要求：**Node.js 22.13+（推荐 24 LTS）**、**pnpm 11.24.0**。Docker 镜像使用 Node.js 24。

```bash
# 在仓库根目录执行；环境文件可按需修改
cp .env.template .env
pnpm install --frozen-lockfile
pnpm dev
```

若未安装 pnpm，可执行 `npm install --global pnpm@11.24.0`。

打开 [http://localhost:3000](http://localhost:3000)，点击「尝试一下」，在右上角「模型配置」中填写：

| 字段 | 说明 |
| --- | --- |
| 协议 | `Responses`、`Messages` 或 `Chat`，按供应商支持情况选择 |
| `base_url` | 接口前缀，例如 `https://api.example.com/v1`，不包含 `/responses`、`/messages` 或 `/chat/completions`；具体前缀以供应商文档为准 |
| `api_key` | 你自己的模型服务密钥 |
| `model_name` | 供应商实际支持的模型 ID |

点击「测试联通性」查看各协议结果，再上传简历、填写目标岗位并开始评审。兼容接口的结构化输出、工具调用和流式行为可能不同，测试成功不代表完整工作流一定兼容。

生产模式运行：

```bash
pnpm build
pnpm start
```

## 数据与隐私

模型请求经过 **浏览器 → 本应用服务端 → 你配置的模型供应商**。API Key 会随请求发送给应用服务端，再用于调用模型接口；简历文本、岗位信息和相关对话也会发送给模型供应商。请使用你信任的部署和模型服务，并在上传前按需去除手机号、住址等信息。

| 数据 | 应用中的保存方式 |
| --- | --- |
| 模型配置及 API Key | 当前浏览器的 `localStorage`，以明文保存；点击模型配置中的「清除」可移除 |
| 最近一次工作流的简历文本、岗位和评审结果 | 当前浏览器的 IndexedDB，并在 `localStorage` 保存恢复副本，用于刷新恢复 |
| Agent Chat 对话 | 当前页面内存；切换工作台保留，刷新页面后不恢复 |
| 上传文件与请求数据 | 服务端在请求处理中读取，当前应用代码不主动写入数据库或文件；部署平台、反向代理与模型供应商的日志和保留策略需另行确认 |

工作流缓存不会随关闭标签页自动删除。需要完整移除本地数据时，请在浏览器中清除此站点的网站数据（包括 `localStorage` 和 IndexedDB）；仅清除模型配置不会删除简历断点。共用设备上尤其需要注意这一点。

Agent Chat 的「清空」会停止当前回答并移除对话上下文，但保留已上传的简历参考资料；更换 PDF 会开始新会话。

## 环境变量

从 [`.env.template`](.env.template) 创建 `.env`，不要提交真实密钥或个人简历。

| 变量 | 用途 | 模板值 |
| --- | --- | --- |
| `APP_VERSION` | Docker 镜像标签；打包脚本未配置时使用 `package.json` 的版本 | `0.2.1` |
| `APP_PORT` | Docker 宿主机映射端口，本地 Next.js 可用 `pnpm dev --port 端口号` 指定 | `3000` |
| `DOCKER_PLATFORM` | 打包脚本的目标平台 | `linux/amd64` |
| `AGENT_TOTAL_TIMEOUT_MS` | 单次 Agent 模型调用的总超时，毫秒 | `270000` |
| `AGENT_CHUNK_TIMEOUT_MS` | 单次流式调用等待数据块的超时，毫秒 | `120000` |
| `AGENT_CHAT_ENABLED` | 仅显式设为 `true` 时开启 Agent Chat 页面入口和接口 | `false` |

未配置超时时，应用代码使用 270 / 120 秒，Compose 和打包脚本的部署命令使用 300 / 150 秒；复制模板后均以 `.env` 的值为准。应用超时无法覆盖模型供应商或部署平台的请求时限。以上超时针对单次调用，完整工作流可能更久。

Agent Chat 开关由服务端在运行时读取。本地修改 `.env` 后重启服务；Compose 部署修改后执行 `docker compose up -d`。模型连接信息在网页配置，不通过这些环境变量设置。

## Docker 部署

### 使用源码部署

安装 Docker Engine 和 Compose 插件，在仓库根目录执行：

```bash
cp .env.template .env
docker compose up -d --build
docker compose logs -f --tail=100 app
```

访问 `http://服务器IP:3000`，端口可通过 `.env` 的 `APP_PORT` 修改。Compose 自动读取 `.env`，镜像构建会排除本地环境文件。

更新部署：

```bash
git pull
docker compose up -d --build
```

发布版本时同步更新 `package.json`、`.env.template`、Compose 默认镜像标签，以及部署机器 `.env` 中的 `APP_VERSION`。停止服务使用 `docker compose down`。

### 本地打包后上传

本机启动 Docker 后执行：

```bash
pnpm docker build
# ARM 服务器使用：
pnpm docker build --platform linux/arm64
```

脚本读取环境变量或 `.env` 中的 `APP_VERSION`，未配置时使用 `package.json` 的版本。默认构建 Linux x86_64 镜像，输出 `dist/<版本号>/resume-reviewer-<版本号>.tar.gz`，并打印上传、加载镜像和启动容器的命令。服务器无需 Node.js 或项目源码。脚本只在本地构建和导出，服务器命令需自行执行。

### 访问范围与反向代理

当前应用适合本地运行或受信任的自托管环境：**没有内置登录、请求限流、上传大小限制或模型地址白名单**。模型地址由请求提供，服务端会向该地址发起请求；直接向不受信任的用户开放接口，会带来服务端请求伪造（SSRF）及资源滥用风险。对外提供服务前，需要补充访问控制、请求/文件大小和并发限制，以及模型地址与服务端出站网络限制。

Compose 默认将应用端口发布到宿主机所有网卡。若由同机 Nginx 提供访问，可将 `ports` 改为 `"127.0.0.1:${APP_PORT:-3000}:3000"`，并通过反向代理配置 HTTPS 和访问控制。直接使用 `docker run` 时同样可用 `-p 127.0.0.1:3000:3000`。

Nginx 流式转发示例（假设 Nginx 运行在宿主机）：

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

`20m` 是此代理示例的请求体限制，并非应用内置限制。域名、证书和访问控制需在部署环境中配置。

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
# 检查锁文件中生产依赖的已知安全公告
pnpm audit --prod
```

测试覆盖模型配置、Agent 调用、工作流断点恢复、评分与结果结构、组件结构和 Docker 打包脚本。测试通过不代表所有模型供应商均兼容。

主要技术：Next.js App Router、React 19、TypeScript、Vercel AI SDK、Zod、`pdf-parse`、`mammoth`、`lucide-react`。

```text
src/app/api/llm/test/      # 三协议联通性测试
src/app/api/review/        # 简历评审 NDJSON 流式接口
src/app/api/pdf-agent/     # 可选 Agent Chat 流式接口
src/components/           # 配置面板、工作台、工作流与报告
src/lib/agents/           # 调用基座、对话及评审 Agent
src/lib/llm/              # 模型配置、协议适配、浏览器配置存储
src/lib/resume/           # 文档读取与信息提取
src/lib/review/           # 流水线、评分、数据结构与本地断点
test/                     # 自动化测试
scripts/docker.mjs        # 镜像构建与导出
```

反馈问题时请附运行方式、Node.js / pnpm 版本、协议与模型名称，以及脱敏后的报错。

## 使用限制与许可证

模型输出可能包含事实错误，评分和建议仅供个人修改简历时参考。改写长度由模型和原始信息决定；Markdown 下载不保证固定排版或两页 PDF。请在投递前核实经历、成果和技能。
