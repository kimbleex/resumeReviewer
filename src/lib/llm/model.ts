import { AsyncLocalStorage } from "node:async_hooks";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { extractJsonMiddleware, extractReasoningMiddleware, wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

import type { LlmConfig } from "@/lib/llm/config";

// 每个请求携带自己的模型配置；用 AsyncLocalStorage 让深层 Agent 调用无需层层透传参数。
const llmConfigStorage = new AsyncLocalStorage<LlmConfig>();

// Messages-compatible thinking models may reject the forced JSON tool that
// the Anthropic adapter generates for Output.object(). Keep SDK validation,
// but request JSON as text instead of forcing a tool on the provider.
const messagesJsonMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    if (params.responseFormat?.type !== "json") return params;
    return {
      ...params,
      responseFormat: { type: "text" },
      prompt: [
        ...params.prompt,
        {
          role: "system",
          content: `Return your final answer as a single JSON object, without markdown fences or commentary. It must conform to this JSON Schema:\n${JSON.stringify(params.responseFormat.schema ?? {})}`,
        },
      ],
    };
  },
};

export function runWithLlmConfig<T>(config: LlmConfig, fn: () => T): T {
  return llmConfigStorage.run(config, fn);
}

function createProtocolModel(config: LlmConfig) {
  const baseURL = config.baseUrl || undefined;

  switch (config.protocol) {
    case "messages":
      return createAnthropic({ apiKey: config.apiKey, baseURL })(config.modelName);
    case "chat":
      return createOpenAI({ apiKey: config.apiKey, baseURL }).chat(config.modelName);
    case "responses":
      return createOpenAI({ apiKey: config.apiKey, baseURL }).responses(config.modelName);
  }
}

export function createLanguageModel(config: LlmConfig | undefined = llmConfigStorage.getStore()): LanguageModel {
  if (!config) {
    throw new Error("未配置模型连接信息，请先在右上角「模型配置」中完成配置。");
  }

  return wrapLanguageModel({
    model: createProtocolModel(config),
    middleware: [
      ...(config.protocol === "messages" ? [messagesJsonMiddleware] : []),
      extractReasoningMiddleware({
        tagName: "think",
        separator: "\n",
      }),
      extractJsonMiddleware(),
    ],
  });
}
