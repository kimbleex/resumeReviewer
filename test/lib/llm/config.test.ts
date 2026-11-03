import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText, Output } from "ai";
import { z } from "zod";

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

test("messages structured output avoids forced tools and still validates JSON", async (t) => {
  let responseText = '{"name":"Ada"}';
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.tool_choice, undefined);
    assert.ok(!body.tools?.length);
    assert.match(JSON.stringify(body.system), /single JSON object/);
    assert.match(body.system.map((part: { text: string }) => part.text).join("\n"), /"name"/);
    return new Response(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: responseText }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { headers: { "content-type": "application/json" } });
  });

  const call = () => generateText({
    model: createLanguageModel(config),
    prompt: "Parse the resume",
    output: Output.object({ schema: z.object({ name: z.string() }) }),
    maxRetries: 0,
  });
  assert.deepEqual((await call()).output, { name: "Ada" });
  responseText = '{"name":123}';
  await assert.rejects(async () => (await call()).output);
});
