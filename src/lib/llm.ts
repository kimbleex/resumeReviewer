import { config as loadDotenv } from "dotenv";
import { createOpenAI } from "@ai-sdk/openai";
import { extractJsonMiddleware, extractReasoningMiddleware, wrapLanguageModel } from "ai";

export function createLanguageModel() {
  loadDotenv({ path: ".env.dev", override: false });

  const apiKey = process.env.API_KEY;
  const baseUrl = process.env.BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey) {
    throw new Error("API_KEY is not configured. Set it in .env.local, .env.dev, or the environment.");
  }

  if (!model) {
    throw new Error("MAIN_MODEL is not configured. Set it in .env.local, .env.dev, or the environment.");
  }

  const openai = createOpenAI({
    apiKey,
    baseURL: baseUrl,
  });

  return wrapLanguageModel({
    model: openai(model),
    middleware: [
      extractReasoningMiddleware({
        tagName: "think",
        separator: "\n",
      }),
      extractJsonMiddleware(),
    ],
  });
}
