# Prisma Auth, Session, Guest Trial, and Admin Panel Design

## Overview

Add Prisma-backed database interaction and a production-oriented authentication layer for the resume review app. The app will support:

- Administrator login from an initial `.env.dev` account.
- Administrator-created member accounts.
- Guest trial access with one allowed review run by default.
- A full server-side session system with access tokens, refresh tokens, and database-backed session state.
- An administrator control panel for users, guests, sessions, and review runs.

The main protected resource is `POST /api/review`, because it triggers the multi-agent LLM pipeline. Frontend state will improve the user experience, but the server will enforce every access rule.

## Goals

- Add Prisma and PostgreSQL support using `DATABASE_URL`.
- Implement access token plus refresh token authentication.
- Store session state in the database so admins can revoke sessions and disable users.
- Let admins manually create, disable, enable, and reset member accounts.
- Let unauthenticated visitors claim a guest identity and run the review pipeline once.
- Let admins inspect and restrict guests.
- Redesign the main page shell around identity state: logged out, guest, member, admin, blocked.
- Keep the current multi-agent review pipeline intact.

## Non-Goals

- Public registration.
- OAuth or third-party login.
- Payment, email verification, or password reset by email.
- Perfect prevention of guest abuse across new devices and fully cleared browser storage.
- Rewriting the review pipeline internals.

## Architecture

The system will be split into three layers:

- Identity: `ADMIN`, `MEMBER`, and `GUEST`.
- Session: short-lived access token, long-lived refresh token, and a database `Session` row.
- Authorization: server-side checks for `/api/review` and `/api/admin/*`.

Access tokens prove who a request claims to be. The `Session` table and related database rows decide whether that identity is still allowed to act.

## Environment Variables

Required:

```env
DATABASE_URL=postgresql://user:password@host:5432/resume?schema=public
SESSION_SECRET=replace-with-strong-random-secret
ADMIN=admin
ADMIN_PWD=replace-with-strong-password
```

The app will not create the `resume` database automatically. PostgreSQL must already have the database available before Prisma migrations run.

## Prisma Schema

Core models:

```prisma
model User {
  id           String      @id @default(cuid())
  username     String      @unique
  passwordHash String
  role         UserRole    @default(MEMBER)
  status       UserStatus  @default(ACTIVE)
  sessions     Session[]
  reviewRuns   ReviewRun[]
  lastLoginAt  DateTime?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}

model Session {
  id               String        @id @default(cuid())
  userId           String
  user             User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokenHash String        @unique
  status           SessionStatus @default(ACTIVE)
  userAgentHash    String?
  ipHash           String?
  expiresAt        DateTime
  lastUsedAt       DateTime?
  revokedAt        DateTime?
  createdAt        DateTime      @default(now())
}

model GuestIdentity {
  id              String       @id @default(cuid())
  fingerprintHash String       @unique
  publicKeyHash   String?      @unique
  status          GuestStatus  @default(ACTIVE)
  trialUsedCount  Int          @default(0)
  maxTrialCount   Int          @default(1)
  reviewRuns      ReviewRun[]
  firstSeenAt     DateTime     @default(now())
  lastSeenAt      DateTime     @default(now())
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}

model ReviewRun {
  id           String          @id @default(cuid())
  userId       String?
  guestId      String?
  user         User?           @relation(fields: [userId], references: [id])
  guest        GuestIdentity?  @relation(fields: [guestId], references: [id])
  actorType    ActorType
  status       ReviewRunStatus @default(STARTED)
  targetRole   String
  errorMessage String?
  startedAt    DateTime        @default(now())
  completedAt  DateTime?
}

enum UserRole {
  ADMIN
  MEMBER
}

enum UserStatus {
  ACTIVE
  BLOCKED
}

enum SessionStatus {
  ACTIVE
  REVOKED
  EXPIRED
}

enum GuestStatus {
  ACTIVE
  BLOCKED
}

enum ActorType {
  USER
  GUEST
}

enum ReviewRunStatus {
  STARTED
  COMPLETED
  FAILED
}
```

Indexes required for admin views:

- `User.status`
- `Session.userId`
- `Session.expiresAt`
- `GuestIdentity.status`
- `ReviewRun.actorType`
- `ReviewRun.startedAt`

## Initial Admin

Admin bootstrap will be idempotent:

1. Read `ADMIN` and `ADMIN_PWD`.
2. If no admin user with that username exists, create one with `role = ADMIN`.
3. If the admin already exists, do not overwrite the password automatically.

This prevents a changed `.env.dev` value from unexpectedly replacing an existing administrator password. Password changes after bootstrap happen through the admin panel or a dedicated script. Resetting a user password revokes that user's existing sessions.

## Authentication Flow

Endpoints:

```text
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
```

Login:

1. Validate username and password.
2. Check `User.status = ACTIVE`.
3. Create an `ACTIVE` session row.
4. Generate a short-lived access token, around 15 minutes.
5. Generate a refresh token, around 14 days.
6. Store only a hash of the refresh token in `Session.refreshTokenHash`.
7. Set both tokens as HttpOnly cookies.

Refresh:

1. Read the refresh token cookie.
2. Hash it and find the matching `Session`.
3. Check session status, expiry, and user status.
4. Rotate the refresh token by replacing `refreshTokenHash`.
5. Issue a new access token and refresh token.
6. Update `lastUsedAt`.

Logout:

1. Read the current refresh token.
2. Mark the matching session as `REVOKED`.
3. Clear auth cookies.

Access tokens are useful for efficient identity checks, but database session state remains the final source of truth for whether a request is allowed.

## Passwords and Tokens

- Passwords will be hashed with Argon2id.
- Refresh tokens will be random opaque values, not JWTs.
- Refresh tokens will be stored only as server-side hashes.
- Access tokens will be signed JWTs.
- Auth cookies will be `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Guest Trial Flow

Endpoints:

```text
POST /api/guest/claim
POST /api/guest/challenge
GET  /api/guest/me
```

Guest identity:

1. Browser generates a WebCrypto key pair.
2. Browser requests a one-time signed challenge from `POST /api/guest/challenge`.
3. Browser signs the challenge with the private key.
4. Browser submits the public key, signature, and fingerprint payload to `POST /api/guest/claim`.
5. Server verifies the signature and stores `publicKeyHash`.
6. Server also computes a low-sensitivity `fingerprintHash`.
7. Server creates or reuses a `GuestIdentity`.
8. Server sets a guest identity cookie.

Trial enforcement happens in `POST /api/review`:

1. Guest must be `ACTIVE`.
2. `trialUsedCount` must be less than `maxTrialCount`.
3. Starting a review run reserves one trial use.
4. The run is marked `COMPLETED` or `FAILED` when the stream finishes.

Guest anti-abuse is layered:

- Browser key pair helps detect the same browser after simple cookie changes.
- `fingerprintHash` helps connect repeated attempts from the same browser environment.
- `ipHash` and `userAgentHash` support admin review and risk signals.
- `ReviewRun` records actual resource use.

This cannot guarantee one trial per human across new devices, different browsers, VPNs, or fully cleared storage. It raises the cost of casual repeated trials and gives admins tools to inspect and block suspicious identities.

## Authorization Rules

`POST /api/review` accepts:

- Active admin with active session.
- Active member with active session.
- Active guest whose trial quota is still available.

`/api/admin/*` accepts:

- Active user.
- Active session.
- `role = ADMIN`.

Blocked users and blocked guests cannot start review runs. Revoked sessions cannot access protected user APIs. Password reset revokes all existing sessions for the affected user.

## Admin Panel

Route:

```text
/admin
```

Admin APIs:

```text
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users/:id
POST   /api/admin/users/:id/reset-password
POST   /api/admin/users/:id/revoke-sessions

GET    /api/admin/guests
PATCH  /api/admin/guests/:id

GET    /api/admin/review-runs
GET    /api/admin/sessions
PATCH  /api/admin/sessions/:id
```

Views:

- Members: username, role, status, last login, created date, enable, disable, reset password.
- Guests: guest ID, status, trial usage, max quota, first seen, last seen, enable, disable, quota edit.
- Sessions: user, status, device summary, hashed IP summary, expiry, last used, revoke.
- Review runs: actor type, user or guest, target role, run status, start time, completion time.

## Main Page Redesign

Routes:

```text
/       main entry and review workspace
/login  admin and member login
/admin  admin control panel
```

The root page will load current identity from `/api/auth/me` and `/api/guest/me`.

States:

- Logged out: show login action and guest trial action.
- Guest: show workspace with remaining trial count.
- Member: show workspace.
- Admin: show workspace and admin panel entry.
- Blocked: show blocked state and disable review action.
- Guest used up: show workspace disabled state and prompt to login or contact admin.

The current `ReviewStudio` is large, so implementation should split the page into smaller components while preserving the current review workflow:

- `ReviewStudioShell`
- `ReviewTopbar`
- `TargetJobPopover`
- `WorkflowTimeline`
- `LoginPage`
- `AdminPanel`

## Review API Changes

`POST /api/review` will:

1. Resolve the current actor from access token/session or guest cookie.
2. Authorize the actor.
3. For guests, reserve one trial before running the pipeline.
4. Create a `ReviewRun` before calling `runReviewPipeline`.
5. Stream current NDJSON events as before.
6. Mark `ReviewRun` as `COMPLETED` or `FAILED`.
7. Return authorization errors as NDJSON-compatible error chunks.

The existing pipeline output schema and frontend streaming parser should not need a behavioral rewrite.

## Error Handling

- Invalid credentials: return a generic login error without revealing whether the username exists.
- Blocked user: return a clear blocked-account message.
- Revoked or expired session: clear cookies and report that login is required.
- Guest quota exhausted: return a clear trial-used message.
- Admin-only API access by non-admin: return forbidden.
- Review pipeline failure: mark `ReviewRun` as `FAILED` and preserve the stream error behavior.

## Testing

Unit and route-level tests should cover:

- Password hashing and verification.
- Session creation, refresh rotation, logout, and revocation.
- Admin-only permission checks.
- Blocked member cannot call review.
- Guest can call review once.
- Guest cannot call review after quota is exhausted.
- Admin can create users and update user status.
- Admin can update guest status and quota.
- Review runs are recorded with expected statuses.

Existing schema and pipeline tests should remain valid.

## Acceptance Criteria

- Prisma is configured and can generate a client from the new schema.
- Initial admin can be bootstrapped from `.env.dev`.
- Admin and member login produce server-managed sessions.
- Refresh token rotation works.
- Admin can create and disable members.
- Admin can revoke sessions.
- Guest users can claim trial access.
- Each guest can run the review pipeline once by default.
- Admin can disable guests or adjust guest quota.
- Disabled users and guests cannot call `/api/review`.
- The redesigned root page clearly shows identity, access state, and remaining guest quota.
- The current multi-agent review pipeline still streams progress and final results.
