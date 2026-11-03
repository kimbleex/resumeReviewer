import { z } from "zod";

// 支持的模型接口协议；value 同时作为表单字段值与本地存储值。
export const LLM_PROTOCOLS = [
  { value: "responses", label: "Responses", endpoint: "/responses" },
  { value: "messages", label: "Messages", endpoint: "/messages" },
  { value: "chat", label: "Chat", endpoint: "/chat/completions" },
] as const;

export type LlmProtocol = (typeof LLM_PROTOCOLS)[number]["value"];

const protocolValues = LLM_PROTOCOLS.map((protocol) => protocol.value) as [LlmProtocol, ...LlmProtocol[]];

// 连接信息（不含协议）：联通性测试会用同一份连接信息逐个尝试所有协议。
export const llmConnectionSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => !value || /^https?:\/\//i.test(value), "base_url 必须以 http:// 或 https:// 开头。"),
  apiKey: z.string().trim().min(1, "请先配置 api_key。").max(500),
  modelName: z.string().trim().min(1, "请先配置 model_name。").max(200),
});

// 用户在页面上自行配置的模型信息，随每次请求通过 FormData 传给服务端，服务端不落盘。
export const llmConfigSchema = llmConnectionSchema.extend({
  protocol: z.enum(protocolValues),
});

export type LlmConnection = z.infer<typeof llmConnectionSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;

const LLM_CONFIG_FORM_FIELDS = {
  protocol: "llmProtocol",
  baseUrl: "llmBaseUrl",
  apiKey: "llmApiKey",
  modelName: "llmModelName",
} as const satisfies Record<keyof LlmConfig, string>;

export function parseLlmConfigFromFormData(formData: FormData): LlmConfig {
  const result = llmConfigSchema.safeParse({
    protocol: String(formData.get(LLM_CONFIG_FORM_FIELDS.protocol) ?? ""),
    baseUrl: String(formData.get(LLM_CONFIG_FORM_FIELDS.baseUrl) ?? ""),
    apiKey: String(formData.get(LLM_CONFIG_FORM_FIELDS.apiKey) ?? ""),
    modelName: String(formData.get(LLM_CONFIG_FORM_FIELDS.modelName) ?? ""),
  });

  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "模型配置无效。");
  }

  return result.data;
}

export function appendLlmConfigToFormData(formData: FormData, config: LlmConfig) {
  for (const key of Object.keys(LLM_CONFIG_FORM_FIELDS) as Array<keyof LlmConfig>) {
    formData.append(LLM_CONFIG_FORM_FIELDS[key], config[key]);
  }
}
