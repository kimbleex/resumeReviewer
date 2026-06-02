import assert from "node:assert/strict";
import test from "node:test";

import { canUseGuestTrial, createFingerprintHash } from "./guest";

test("canUseGuestTrial accepts only active guests below their quota", () => {
  assert.deepEqual(canUseGuestTrial({ status: "ACTIVE", trialUsedCount: 0, maxTrialCount: 1 }), {
    ok: true,
  });

  assert.deepEqual(canUseGuestTrial({ status: "ACTIVE", trialUsedCount: 1, maxTrialCount: 1 }), {
    ok: false,
    reason: "GUEST_TRIAL_EXHAUSTED",
  });

  assert.deepEqual(canUseGuestTrial({ status: "BLOCKED", trialUsedCount: 0, maxTrialCount: 1 }), {
    ok: false,
    reason: "GUEST_BLOCKED",
  });
});

test("createFingerprintHash normalizes noisy browser signals", () => {
  const first = createFingerprintHash({
    userAgent: " Mozilla/5.0 ",
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    platform: "Win32",
  });
  const second = createFingerprintHash({
    userAgent: "mozilla/5.0",
    language: " zh-cn ",
    timezone: "asia/shanghai",
    platform: "win32",
  });

  assert.equal(first, second);
  assert.equal(first.length, 64);
});
