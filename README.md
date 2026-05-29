# Resume Multi-Agent Review

`Resume Multi-Agent Review` is now a `Next.js + TypeScript` full-stack application for multi-agent resume evaluation.

The app accepts a resume file upload and runs a fixed Vercel AI SDK pipeline:

1. `Resume Loader`
2. `Resume Parser`
3. `HR Agent`
4. `Interviewer Agent`
5. `Career Master Agent`
6. `Summary Agent`

The browser UI streams stage progress live and renders each agent's structured result as soon as it completes.

## Stack

- Next.js App Router
- React
- TypeScript
- Vercel AI SDK
- `@ai-sdk/openai`
- Zod
- `pdf-parse`
- `mammoth`

## Directory

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

## Environment

Create `.env.local` or reuse `.env.dev` with:

```bash
API_KEY=your_api_key
BASE_URL=https://your-compatible-endpoint.example.com/v1
MAIN_MODEL=your-model-name
```

Only the server reads these values.

## Run locally

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Tests

```bash
npm test
npm run typecheck
```

## Notes

- Upload mode is the recommended production path for Vercel deployment.
- The UI intentionally shows structured stage summaries, not hidden chain-of-thought.
