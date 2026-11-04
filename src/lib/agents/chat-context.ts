import { z } from "zod";

export const chatHistorySchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1),
}));

export type ChatMessage = z.infer<typeof chatHistorySchema>[number];

// Only completed exchanges become context; failed partial answers stay in the UI.
export function buildChatHistory(turns: Array<{ prompt: string; answer: string; status: string }>): ChatMessage[] {
  return turns.flatMap((turn): ChatMessage[] => turn.status === "done" && turn.answer.trim()
    ? [{ role: "user", content: turn.prompt }, { role: "assistant", content: turn.answer }]
    : []);
}

export function parseChatHistory(value: FormDataEntryValue | null): ChatMessage[] {
  if (value === null) return [];
  try {
    if (typeof value !== "string") throw new Error("Invalid history");
    return chatHistorySchema.parse(JSON.parse(value));
  } catch {
    throw new Error("对话上下文格式无效，请清空对话后重试。");
  }
}
