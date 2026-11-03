import { AsyncLocalStorage } from "node:async_hooks";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { extractJsonMiddleware, extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

import type { LlmConfig } from "@/lib/llm/config";

// 每个请求携带自己的模型配置；用 AsyncLocalStorage 让深层 Agent 调用无需层层透传参数。
const llmConfigStorage = new AsyncLocalStorage<LlmConfig>();

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
      extractReasoningMiddleware({
        tagName: "think",
        separator: "\n",
      }),
      extractJsonMiddleware(),
    ],
  });
}
