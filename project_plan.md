# Resume Multi-Agent Web Project Plan

## 1. Goal

Build a Vercel-ready `Next.js + TypeScript` web application that accepts a resume, runs a fixed Vercel AI SDK multi-agent review pipeline, and returns structured resume revision guidance through a live browser UI.

## 2. Current Scope

Included now:

- Web UI for upload
- Node.js route handler for review execution
- Vercel AI SDK structured-output agents
- Deterministic pipeline orchestration
- Live streamed stage events
- Structured result rendering for each agent

Not included yet:

- Authentication
- Database persistence
- Background job queue
- Review history
- Human approval workflow
- Parallel reviewer execution

## 3. Architecture

Use a single full-stack Next.js codebase.

### Request flow

1. Browser sends `FormData` to `POST /api/review`
2. Server loads resume content from upload
3. Resume parser produces a structured `ResumeProfile`
4. Reviewer agents score from:
   - HR / ATS
   - technical interviewer
   - career strategy
5. Summary agent merges reviewer outputs into `FinalResumeReview`
6. Route streams NDJSON chunks to the browser
7. Browser updates stage states, timeline, agent panels, and final report

## 4. Directory Plan

```text
src/
  app/
    api/review/route.ts
    globals.css
    layout.tsx
    page.tsx
  components/
    review-studio.tsx
  lib/
    agents/
      base.ts
      prompts.ts
      resume-parser.ts
      hr.ts
      interviewer.ts
      career-master.ts
      summary.ts
    resume/
      loader.ts
      signals.ts
    review/
      pipeline.ts
      schemas.ts
```

## 5. Agent Responsibilities

### Resume Parser

- extract personal info
- group skills
- list work / project / education records
- summarize strengths, risks, and missing information

### HR Agent

- assess recruiter readability
- assess ATS fit
- flag vague bullets and missing business value

### Interviewer Agent

- assess technical depth
- assess project credibility
- flag missing ownership, tradeoffs, and complexity

### Career Master Agent

- sharpen positioning
- improve narrative and differentiation
- align the resume with target track and seniority

### Summary Agent

- merge overlapping feedback
- rank the highest-ROI edits
- produce final section-by-section revisions

## 6. Data Contracts

Core shared contracts:

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

## 7. UI Plan

The first screen is the actual review workspace, not a landing page.

It should provide:

- upload input as the production path
- animated running state for the current agent
- timeline of stage events
- immediate result panel after each stage completes
- final score breakdown and revision tables

## 8. Next Milestones

1. parallelize reviewer agents
2. add report export
3. persist review runs
4. add prompt versioning
5. add LangSmith traces
6. deploy to Vercel
