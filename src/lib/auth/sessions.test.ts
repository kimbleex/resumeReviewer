import assert from "node:assert/strict";
import test from "node:test";

import { canUseUserSession } from "./sessions";

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);

function reasonFor(decision: ReturnType<typeof canUseUserSession>) {
  assert.equal(decision.ok, false);
  return decision.reason;
}

test("canUseUserSession accepts only active users with active unexpired sessions", () => {
  assert.equal(
    canUseUserSession({
      userStatus: "ACTIVE",
      sessionStatus: "ACTIVE",
      expiresAt: future,
      now: new Date(),
    }).ok,
    true,
  );

  assert.equal(
    reasonFor(canUseUserSession({
      userStatus: "BLOCKED",
      sessionStatus: "ACTIVE",
      expiresAt: future,
      now: new Date(),
    })),
    "USER_BLOCKED",
  );

  assert.equal(
    reasonFor(canUseUserSession({
      userStatus: "ACTIVE",
      sessionStatus: "REVOKED",
      expiresAt: future,
      now: new Date(),
    })),
    "SESSION_REVOKED",
  );

  assert.equal(
    reasonFor(canUseUserSession({
      userStatus: "ACTIVE",
      sessionStatus: "ACTIVE",
      expiresAt: past,
      now: new Date(),
    })),
    "SESSION_EXPIRED",
  );
});
