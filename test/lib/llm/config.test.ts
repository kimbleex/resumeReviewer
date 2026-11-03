import { test } from "node:test";
import assert from "node:assert/strict";

import { LLM_PROTOCOLS, appendLlmConfigToFormData, parseLlmConfigFromFormData, type LlmConfig } from "@/lib/llm/config";
import { createLanguageModel } from "@/lib/llm/model";

const config: LlmConfig = {
  protocol: "messages",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  modelName: "test-model",
};

test("llm config round-trips through FormData", () => {
  const formData = new FormData();
  appendLlmConfigToFormData(formData, config);
  assert.deepEqual(parseLlmConfigFromFormData(formData), config);
});

test("llm config rejects missing api key and unknown protocols", () => {
  const missingKey = new FormData();
  appendLlmConfigToFormData(missingKey, { ...config, apiKey: " " });
  assert.throws(() => parseLlmConfigFromFormData(missingKey), /api_key/);

  const badProtocol = new FormData();
  appendLlmConfigToFormData(badProtocol, { ...config, protocol: "unknown" as LlmConfig["protocol"] });
  assert.throws(() => parseLlmConfigFromFormData(badProtocol));
});

test("each protocol maps to its own provider endpoint", () => {
  assert.deepEqual(
    LLM_PROTOCOLS.map((protocol) => protocol.endpoint),
    ["/responses", "/messages", "/chat/completions"],
  );

  const providers = LLM_PROTOCOLS.map(({ value }) => {
    const model = createLanguageModel({ ...config, protocol: value });
    return typeof model === "string" ? model : model.provider;
  });
  assert.deepEqual(providers, ["openai.responses", "anthropic.messages", "openai.chat"]);
});

test("createLanguageModel requires a request-scoped config", () => {
  assert.throws(() => createLanguageModel(), /模型配置/);
});
