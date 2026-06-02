import assert from "node:assert/strict";
import test from "node:test";

import { createAccessToken, createRefreshToken, hashRefreshToken, verifyAccessToken } from "./tokens";

test("access tokens round-trip the user identity and token family", async () => {
  const token = await createAccessToken({
    userId: "user_1",
    sessionId: "session_1",
    role: "ADMIN",
    secret: "test-secret-at-least-32-characters",
    expiresIn: "15m",
  });

  const payload = await verifyAccessToken(token, "test-secret-at-least-32-characters");

  assert.equal(payload.userId, "user_1");
  assert.equal(payload.sessionId, "session_1");
  assert.equal(payload.role, "ADMIN");
});

test("refresh tokens are opaque and hashable for database storage", () => {
  const refreshToken = createRefreshToken();
  const hash = hashRefreshToken(refreshToken);

  assert.notEqual(refreshToken, hash);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[a-f0-9]+$/);
});
