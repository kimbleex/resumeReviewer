import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readEnvFile() {
  let content;
  try {
    content = await readFile(join(root, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    const quoted = raw.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
    values[key] = quoted ? quoted[2] : raw.replace(/\s*#.*$/, "").trim();
  }
  return values;
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${label}失败：${error.message}`)));
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label}失败（${signal || `退出码 ${code}`}）。`));
    });
  });
}

async function runDocker(args, label) {
  await waitForExit(spawn("docker", args, { cwd: root, stdio: "inherit" }), label);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "build" || (args.length && (args.length !== 2 || args[0] !== "--platform"))) {
    throw new Error("用法：pnpm docker build [--platform linux/amd64|linux/arm64]");
  }
  const fileEnv = await readEnvFile();
  const setting = (name, fallback) => process.env[name] || fileEnv[name] || fallback;
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = setting("APP_VERSION", pkg.version);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(version)) {
    throw new Error("APP_VERSION 必须是有效的 Docker 版本标签，例如 0.2.0。");
  }
  const platform = args[1] || setting("DOCKER_PLATFORM", "linux/amd64");
  if (!["linux/amd64", "linux/arm64"].includes(platform)) {
    throw new Error("DOCKER_PLATFORM 仅支持 linux/amd64 或 linux/arm64。");
  }
  const port = setting("APP_PORT", "3000");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("APP_PORT 必须是 1–65535 的端口号。");
  }
  const image = `resume-reviewer:${version}`;
  const archiveName = `resume-reviewer-${version}.tar.gz`;
  const outputDirectory = join(root, "dist", version);
  const archivePath = join(outputDirectory, archiveName);
  const temporaryPath = `${archivePath}.${process.pid}.tmp`;

  console.log(`\n构建镜像：${image}\n目标平台：${platform}`);
  try {
    await runDocker(["info", "--format", "{{.ServerVersion}}"], "连接 Docker 服务");
  } catch {
    throw new Error("Docker 服务不可用，请先启动 Docker Desktop 或 Docker daemon，再运行 pnpm docker build。");
  }
  await runDocker(["buildx", "build", "--platform", platform, "--tag", image, "--load", "."], "构建镜像");
  await mkdir(outputDirectory, { recursive: true });
  console.log(`\n导出压缩包：dist/${version}/${archiveName}`);
  const save = spawn("docker", ["save", image], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  try {
    await Promise.all([
      waitForExit(save, "导出镜像"),
      pipeline(save.stdout, createGzip(), createWriteStream(temporaryPath)),
    ]);
    await rename(temporaryPath, archivePath);
  } catch (error) {
    save.kill();
    await rm(temporaryPath, { force: true });
    throw error;
  }

  console.log(`
构建完成：${archivePath}

后续服务器操作（目标平台 ${platform}，请替换服务器地址和上传目录）：

1. 在本机上传压缩包：
   scp dist/${version}/${archiveName} 用户名@服务器IP:/你的部署目录/

2. 登录服务器，进入上传目录并加载镜像：
   cd /你的部署目录
   docker load -i ${archiveName}

3. 查看、停止并删除当前容器（首次部署可跳过 stop 和 rm；容器名不同时请替换）：
   docker ps -a --filter name=resume-reviewer
   docker stop resume-reviewer
   docker rm resume-reviewer

4. 启动新版本：
   docker run -d --name resume-reviewer --restart unless-stopped --init \\
     -p ${port}:3000 \\
     -e AGENT_CHAT_ENABLED=${setting("AGENT_CHAT_ENABLED", "false") === "true" ? "true" : "false"} \\
     -e AGENT_TOTAL_TIMEOUT_MS=${/^\d+$/.test(setting("AGENT_TOTAL_TIMEOUT_MS", "300000")) ? setting("AGENT_TOTAL_TIMEOUT_MS", "300000") : "300000"} \\
     -e AGENT_CHUNK_TIMEOUT_MS=${/^\d+$/.test(setting("AGENT_CHUNK_TIMEOUT_MS", "150000")) ? setting("AGENT_CHUNK_TIMEOUT_MS", "150000") : "150000"} \\
     ${image}

5. 查看日志和服务状态：
   docker logs -f --tail 100 resume-reviewer
   docker ps --filter name=resume-reviewer
   访问 http://服务器IP:${port}
`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
