"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, LoaderCircle, Settings2, Trash2, XCircle, Zap } from "lucide-react";

import type { LlmProtocolTestResult } from "@/app/api/llm/test/route";
import { LLM_PROTOCOLS, llmConnectionSchema, type LlmConfig } from "@/lib/llm/config";
import { EMPTY_LLM_CONFIG, loadStoredLlmConfig, storeLlmConfig } from "@/lib/llm/storage";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; results: LlmProtocolTestResult[] }
  | { status: "error"; message: string };

export function LlmConfigMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<LlmConfig>(EMPTY_LLM_CONFIG);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const menuRef = useRef<HTMLDivElement>(null);
  const testAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setConfig(loadStoredLlmConfig());
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => () => testAbortRef.current?.abort(), []);

  const isConfigured = Boolean(config.apiKey.trim() && config.modelName.trim());
  const triggerLabel = isConfigured ? config.modelName.trim() : "模型配置";

  function applyConfig(next: LlmConfig, resetTest: boolean) {
    setConfig(next);
    storeLlmConfig(next);
    if (resetTest) {
      testAbortRef.current?.abort();
      setTestState({ status: "idle" });
    }
  }

  // 测试结果覆盖全部协议，切换协议不影响结果；修改连接信息才需要重新测试。
  function updateField(field: "baseUrl" | "apiKey" | "modelName", value: string) {
    applyConfig({ ...config, [field]: value }, true);
  }

  async function handleTest() {
    const parsed = llmConnectionSchema.safeParse(config);
    if (!parsed.success) {
      setTestState({ status: "error", message: parsed.error.issues[0]?.message ?? "模型配置无效。" });
      return;
    }

    testAbortRef.current?.abort();
    const controller = new AbortController();
    testAbortRef.current = controller;
    setTestState({ status: "testing" });

    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      const rawBody = await response.text();
      let body: { results?: LlmProtocolTestResult[]; error?: string } = {};
      try {
        body = JSON.parse(rawBody) as typeof body;
      } catch {
        body = { error: `请求失败（${response.status}）：${rawBody.slice(0, 200)}` };
      }

      setTestState(
        body.results
          ? { status: "done", results: body.results }
          : { status: "error", message: body.error || `请求失败（${response.status}）` },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setTestState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (testAbortRef.current === controller) {
        testAbortRef.current = null;
      }
    }
  }

  return (
    <div className="topbar-config-menu" ref={menuRef}>
      <button
        className={`topbar-config-trigger ${isOpen ? "is-open" : ""}`}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="打开模型配置"
        aria-expanded={isOpen}
      >
        <Settings2 size={16} />
        <span>{triggerLabel}</span>
        <i className={`topbar-config-dot ${isConfigured ? "is-ready" : ""}`} aria-hidden="true" />
        <ChevronDown size={14} />
      </button>

      {isOpen ? (
        <div className="topbar-config-panel">
          <div className="topbar-config-header">
            <strong>模型配置</strong>
            <span>选择模型服务使用的接口协议</span>
          </div>

          <div className="topbar-config-field">
            <span>protocol</span>
            <div className="topbar-config-protocols" role="radiogroup" aria-label="接口协议">
              {LLM_PROTOCOLS.map((protocol) => (
                <button
                  key={protocol.value}
                  className={`topbar-config-protocol ${config.protocol === protocol.value ? "is-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={config.protocol === protocol.value}
                  title={protocol.endpoint}
                  onClick={() => applyConfig({ ...config, protocol: protocol.value }, false)}
                >
                  {protocol.label}
                </button>
              ))}
            </div>
          </div>

          <label className="topbar-config-field">
            <span>base_url</span>
            <input
              value={config.baseUrl}
              onChange={(event) => updateField("baseUrl", event.currentTarget.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="topbar-config-field">
            <span>api_key</span>
            <input
              value={config.apiKey}
              onChange={(event) => updateField("apiKey", event.currentTarget.value)}
              placeholder="sk-..."
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="topbar-config-field">
            <span>model_name</span>
            <input
              value={config.modelName}
              onChange={(event) => updateField("modelName", event.currentTarget.value)}
              placeholder="gpt-4o-mini"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="topbar-config-warning">
            <AlertTriangle size={14} />
            <span>配置仅保存在当前浏览器本地。使用完毕后，建议到模型服务商处更新或删除该 api_key，并点击「清除」移除本地配置。</span>
          </div>

          <button
            className="topbar-config-action is-primary"
            type="button"
            onClick={() => void handleTest()}
            disabled={testState.status === "testing"}
          >
            {testState.status === "testing" ? <LoaderCircle size={14} className="topbar-config-spin" /> : <Zap size={14} />}
            {testState.status === "testing" ? "测试中..." : "测试联通性"}
          </button>

          {testState.status === "error" ? (
            <div className="topbar-config-status is-failed">
              <XCircle size={14} />
              {testState.message}
            </div>
          ) : null}

          {testState.status === "done" ? (
            <ul className="topbar-config-results">
              {testState.results.map((result) => {
                const protocol = LLM_PROTOCOLS.find((item) => item.value === result.protocol);
                return (
                  <li
                    key={result.protocol}
                    className={`topbar-config-result ${config.protocol === result.protocol ? "is-selected" : ""}`}
                  >
                    <span className="topbar-config-result-name">{protocol?.endpoint ?? result.protocol}</span>
                    <span className={`topbar-config-status ${result.ok ? "is-success" : "is-failed"}`}>
                      {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                      {result.ok ? "成功" : "失败"}
                      <small>{result.durationMs}ms</small>
                      {result.ok ? null : (
                        <span className="topbar-config-help" tabIndex={0} aria-label="查看完整请求结果">
                          <CircleHelp size={14} />
                          <pre className="topbar-config-tooltip" role="tooltip">{result.details}</pre>
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <button className="topbar-config-action is-danger" type="button" onClick={() => applyConfig(EMPTY_LLM_CONFIG, true)}>
            <Trash2 size={14} />
            清除
          </button>
        </div>
      ) : null}
    </div>
  );
}
