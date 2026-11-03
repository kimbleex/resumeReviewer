import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  finalResumeReviewResponseFormatSchema,
  resumeProfileResponseFormatSchema,
  reviewerFeedbackResponseFormatSchema,
} from "@/lib/review/schemas";

test("response format schemas can be converted to JSON Schema", () => {
  assert.doesNotThrow(() => z.toJSONSchema(resumeProfileResponseFormatSchema));
  assert.doesNotThrow(() => z.toJSONSchema(reviewerFeedbackResponseFormatSchema));
  assert.doesNotThrow(() => z.toJSONSchema(finalResumeReviewResponseFormatSchema));
});
