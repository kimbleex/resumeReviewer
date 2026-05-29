import { generateObject } from "ai";
import type { z } from "zod";

import { createLanguageModel } from "@/lib/llm";

export function dumpJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function invokeStructuredAgent<TResponseFormat extends z.ZodTypeAny, TResult>(options: {
  name: string;
  systemPrompt: string;
  responseFormat: TResponseFormat;
  userContent: string;
  normalize: (value: z.infer<TResponseFormat>) => TResult;
}): Promise<TResult> {
  const { object } = await generateObject({
    model: createLanguageModel(),
    system: options.systemPrompt,
    prompt: options.userContent,
    schemaName: options.name,
    schema: options.responseFormat,
  });

  return options.normalize(object as z.infer<TResponseFormat>);
}
