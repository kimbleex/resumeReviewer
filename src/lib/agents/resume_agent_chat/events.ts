export type ParsedResumeMemory = {
  fileName: string;
  charCount: number;
  content: string;
};

export type ResumeAgentEvent =
  | {
      type: "step";
      id: string;
      tag: "agent" | "model";
      title: string;
      detail?: string;
      status: "running" | "done" | "failed";
    }
  | { type: "answer-delta"; text: string }
  | { type: "resume-cache"; parsedResume: ParsedResumeMemory }
  | { type: "done"; citation: string }
  | { type: "error"; message: string };
