import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import test, { type TestContext } from "node:test";

const execute = promisify(execFile);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "resume-docker-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scripts"));
  await mkdir(join(directory, "bin"));
  await copyFile("scripts/docker.mjs", join(directory, "scripts/docker.mjs"));
  await writeFile(join(directory, "package.json"), JSON.stringify({ version: "0.2.0" }));
  const docker = join(directory, "bin/docker");
  await writeFile(docker, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'save') {
  process.stdout.write('fake image archive');
  if (process.env.DOCKER_TEST_FAIL_SAVE) process.exitCode = 1;
}
`);
  await chmod(docker, 0o755);
  const log = join(directory, "calls.log");
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}`, DOCKER_TEST_LOG: log };
  delete env.APP_VERSION;
  delete env.DOCKER_PLATFORM;
  delete env.APP_PORT;
  delete env.AGENT_CHAT_ENABLED;
  return { directory, log, env, run: (args: string[] = [], overrides = {}) => execute(process.execPath,
    [join(directory, "scripts/docker.mjs"), "build", ...args], { env: { ...env, ...overrides } }) };
}

test("docker build exports a gzip archive using env version and prints deployment commands", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, ".env"), 'APP_VERSION="0.3.0"\nAPP_PORT=8080\nAGENT_CHAT_ENABLED=false\n');
  const { stdout } = await f.run();
  const archive = await readFile(join(f.directory, "dist/0.3.0/resume-reviewer-0.3.0.tar.gz"));
  assert.equal(gunzipSync(archive).toString(), "fake image archive");
  const calls = (await readFile(f.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(calls[1], ["buildx", "build", "--platform", "linux/amd64", "--tag", "resume-reviewer:0.3.0", "--load", "."]);
  assert.deepEqual(calls[2], ["save", "resume-reviewer:0.3.0"]);
  for (const command of ["docker load -i resume-reviewer-0.3.0.tar.gz", "docker stop resume-reviewer", "docker rm resume-reviewer", "docker run -d", "-p 8080:3000", "AGENT_CHAT_ENABLED=false"]) {
    assert.ok(stdout.includes(command), command);
  }
});

test("docker build falls back to package version and supports ARM platform", async (t) => {
  const f = await fixture(t);
  await f.run(["--platform", "linux/arm64"]);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /linux\/arm64/);
  assert.match(calls, /resume-reviewer:0.2.0/);
  assert.ok(await readFile(join(f.directory, "dist/0.2.0/resume-reviewer-0.2.0.tar.gz")));
});

test("failed docker export removes the incomplete archive and does not print success", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run([], { DOCKER_TEST_FAIL_SAVE: "1" }), (error: unknown) => {
    const failure = error as { stdout: string; stderr: string };
    assert.doesNotMatch(failure.stdout, /构建完成|docker stop/);
    assert.match(failure.stderr, /导出镜像失败/);
    return true;
  });
  assert.deepEqual(await readdir(join(f.directory, "dist/0.2.0")), []);
});
