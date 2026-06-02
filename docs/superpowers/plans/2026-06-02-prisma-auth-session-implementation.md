# Prisma Auth Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Prisma-backed users, sessions, guest trial limits, admin controls, and identity-aware pages around the existing resume review pipeline.

**Architecture:** Keep `/api/review` as the protected resource and add focused auth, session, guest, and admin modules under `src/lib`. Use Prisma as the state source, HttpOnly cookies for tokens, and route handlers for auth/admin APIs.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, PostgreSQL, jose, Argon2id, Node test runner.

---

### Task 1: Dependencies and Prisma

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `prisma/schema.prisma`
- Create: `src/lib/db/prisma.ts`

- [ ] Install `prisma`, `@prisma/client`, `jose`, and `@node-rs/argon2`.
- [ ] Add Prisma schema for users, sessions, guests, review runs, and required indexes.
- [ ] Add a singleton Prisma client.
- [ ] Run `npx prisma generate`.

### Task 2: Auth Core

**Files:**
- Create: `src/lib/auth/password.ts`
- Create: `src/lib/auth/tokens.ts`
- Create: `src/lib/auth/cookies.ts`
- Create: `src/lib/auth/sessions.ts`
- Create: `src/lib/auth/bootstrap.ts`
- Test: `src/lib/auth/*.test.ts`

- [ ] Write failing tests for password hashing, token expiry, and session access decisions.
- [ ] Implement Argon2id password helpers.
- [ ] Implement access JWT and opaque refresh token helpers.
- [ ] Implement session creation, refresh rotation, logout revocation, and admin bootstrap helpers.
- [ ] Run focused auth tests.

### Task 3: Guest Trial Core

**Files:**
- Create: `src/lib/auth/guest.ts`
- Test: `src/lib/auth/guest.test.ts`

- [ ] Write failing tests for guest quota decisions.
- [ ] Implement guest fingerprint hashing, challenge payloads, quota checks, and trial reservation helpers.
- [ ] Run focused guest tests.

### Task 4: Auth and Guest Routes

**Files:**
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/refresh/route.ts`
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/app/api/guest/challenge/route.ts`
- Create: `src/app/api/guest/claim/route.ts`
- Create: `src/app/api/guest/me/route.ts`

- [ ] Add route handlers that call auth and guest core modules.
- [ ] Return generic login errors and clear cookies for expired sessions.

### Task 5: Protect Review API

**Files:**
- Modify: `src/app/api/review/route.ts`
- Create: `src/lib/auth/actors.ts`

- [ ] Resolve current actor from user session or guest identity.
- [ ] Enforce active user/session or active guest quota.
- [ ] Create and update `ReviewRun` records.
- [ ] Preserve NDJSON streaming behavior.

### Task 6: Admin APIs

**Files:**
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`
- Create: `src/app/api/admin/users/[id]/reset-password/route.ts`
- Create: `src/app/api/admin/users/[id]/revoke-sessions/route.ts`
- Create: `src/app/api/admin/guests/route.ts`
- Create: `src/app/api/admin/guests/[id]/route.ts`
- Create: `src/app/api/admin/sessions/route.ts`
- Create: `src/app/api/admin/sessions/[id]/route.ts`
- Create: `src/app/api/admin/review-runs/route.ts`
- Create: `src/lib/admin/service.ts`

- [ ] Require admin session for every admin route.
- [ ] Implement member creation, status changes, password reset, guest quota/status updates, session revocation, and list APIs.

### Task 7: UI Integration

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/app/admin/page.tsx`
- Modify: `src/components/review-studio.tsx`
- Create: `src/components/auth-gateway.tsx`
- Create: `src/components/login-page.tsx`
- Create: `src/components/admin-panel.tsx`
- Modify: `src/app/globals.css`

- [ ] Add login page and identity gateway.
- [ ] Add guest claim flow before guest review use.
- [ ] Add admin panel lists and actions.
- [ ] Add identity-aware topbar and disabled states to review studio.

### Task 8: Verification

**Files:**
- Modify tests as needed.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx prisma validate`.
- [ ] Fix failures and rerun until checks pass.
