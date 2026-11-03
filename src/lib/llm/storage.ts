import { LLM_PROTOCOLS, llmConfigSchema, type LlmConfig, type LlmProtocol } from "@/lib/llm/config";

// 浏览器端模型配置存取；仅在客户端组件中调用。
const LLM_CONFIG_STORAGE_KEY = "resume_llm_config_v1";

export const EMPTY_LLM_CONFIG: LlmConfig = { protocol: "responses", baseUrl: "", apiKey: "", modelName: "" };

function isProtocol(value: unknown): value is LlmProtocol {
  return LLM_PROTOCOLS.some((protocol) => protocol.value === value);
}

export function loadStoredLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
    if (!raw) {
      return EMPTY_LLM_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<Record<keyof LlmConfig, unknown>>;
    return {
      protocol: isProtocol(parsed.protocol) ? parsed.protocol : EMPTY_LLM_CONFIG.protocol,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      modelName: typeof parsed.modelName === "string" ? parsed.modelName : "",
    };
  } catch {
    return EMPTY_LLM_CONFIG;
  }
}

export function storeLlmConfig(config: LlmConfig) {
  try {
    if (!config.baseUrl && !config.apiKey && !config.modelName) {
      localStorage.removeItem(LLM_CONFIG_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 浏览器禁用存储时仅保留在内存中。
  }
}

/** 读取并校验本地模型配置；不完整时返回错误提示，供发起请求前使用。 */
export function readRequiredLlmConfig(): { ok: true; config: LlmConfig } | { ok: false; message: string } {
  const result = llmConfigSchema.safeParse(loadStoredLlmConfig());
  if (!result.success) {
    return { ok: false, message: `${result.error.issues[0]?.message ?? "模型配置无效。"}请在右上角「模型配置」中完成配置。` };
  }
  return { ok: true, config: result.data };
}
