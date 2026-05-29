# Next.js Web Migration Design

## Goal

Replace the current Python + Rich prototype with a Vercel-friendly `Next.js + TypeScript` full-stack application that:

- accepts a resume file upload or a local absolute path for development
- parses the resume into a structured profile
- runs fixed reviewer agents for HR, interviewer, and career strategy
- streams stage progress and stage results to a browser UI
- returns a final, structured resume revision report

## Architecture

This migration keeps the existing fixed pipeline and structured-output philosophy, but moves both orchestration and UI into a single JavaScript/TypeScript codebase.

### Runtime split

- `src/app/*`: Next.js App Router pages and route handlers
- `src/components/*`: interactive client-side UI
- `src/lib/review/*`: shared schemas, stream envelopes, orchestration
- `src/lib/agents/*`: LangChain JS agent wrappers and prompts
- `src/lib/resume/*`: resume loading and deterministic signal extraction

### Request flow

1. User uploads a resume or enters an absolute path in local development.
2. `POST /api/review` receives `FormData`.
3. Server loads resume content and emits a `resume_loader` stage event.
4. Resume parser agent returns a structured `ResumeProfile`.
5. Reviewer agents run in fixed order and emit structured `ReviewerFeedback`.
6. Summary agent merges reviewer feedback into `FinalResumeReview`.
7. Route streams newline-delimited JSON chunks back to the client.
8. Browser UI updates stage cards, timeline, result panels, and final score tables live.

## Data contracts

We keep the existing backend concepts, translated to Zod-backed TypeScript types:

- `ResumeDocument`
- `PersonalInfo`
- `SkillGroup`
- `WorkExperience`
- `ProjectExperience`
- `EducationRecord`
- `ResumeProfile`
- `ReviewerFeedback`
- `FinalResumeReview`
- `ReviewRunResult`
- `ReviewStageEvent`
- `ReviewStreamChunk`

The UI must render only structured data. No Markdown list rendering for final output.

## UI design

The new UI is a single focused review workspace:

- hero-less app shell with strong first-screen signal
- source mode toggle: upload vs. local absolute path
- stage strip showing waiting / running / done states
- live timeline of stage messages
- result panels that appear immediately when each agent completes
- final review area with:
  - executive summary
  - per-agent score overview
  - score breakdown table
  - prioritized action list
  - section-by-section revision table

The running agent uses an animated ring spinner. Completed agents show a success marker and their structured result below the live board.

## Error handling

- missing file or unreadable file -> loader error
- unsupported suffix -> loader error
- missing `API_KEY` or `MAIN_MODEL` -> configuration error
- structured output parse failure -> stage error with friendly message
- route-level exceptions -> streamed `error` chunk

## Testing scope

For this migration pass, cover the most important shared logic:

- schema normalization and score coercion
- deterministic resume signal extraction
- review pipeline stage ordering with stub agents

## Assumptions

- `Next.js App Router` is the primary framework
- deployment target is Vercel
- LLM credentials remain server-side only
- local absolute path support is for development and same-machine usage, not browser-to-cloud production
