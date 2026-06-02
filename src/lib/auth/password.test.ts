import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword, verifyPassword } from "./password";

test("hashPassword stores an Argon2id hash instead of the raw password", async () => {
  const hash = await hashPassword("correct horse battery staple");

  assert.notEqual(hash, "correct horse battery staple");
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, "correct horse battery staple"), true);
  assert.equal(await verifyPassword(hash, "wrong password"), false);
});
