# PDF Agent Workbench Frontend Design

## Scope

Build a PC-first frontend upgrade for the resume product:

- Add a top navigation bar that switches between the existing workflow diagnosis page and a new PDF Agent editing page.
- Keep identity controls available to every logged-in or guest user, with the admin panel link shown only to admins.
- Refine the existing workflow page so upload, target role, target description, and start controls feel integrated into the main command surface.
- Add a new PDF Agent workbench where users upload a PDF, preview it immediately in the browser, chat with an Agent, watch concise execution stages, and refresh or download the current PDF.

Mobile layout is intentionally out of scope for this iteration.

## Product Model

The application becomes a two-mode authenticated workspace:

1. Workflow Diagnosis: the current multi-agent review pipeline.
2. Agent Edit Resume: a focused editing workbench with PDF preview on the left and an Agent console on the right.

The first version of Agent Edit Resume will be frontend-ready and backend-compatible:

- Uploaded PDFs preview immediately with a browser `Blob URL`.
- Agent runs are represented by structured stage state and concise tool-call rows.
- The UI is ready to replace the current PDF URL with a backend-generated PDF blob or URL after each edit.
- Until a real PDF editing API exists, the page can show deterministic simulated stages and keep the uploaded PDF as the current preview.

## Layout

The shared shell uses a compact top navigation bar:

- Left: product name and workspace context.
- Center or left-middle: tabs for `工作流诊断` and `Agent 改简历`.
- Right: identity menu trigger showing role/status. Admin users get `管理面板`; members get logout; guests get formal-login action.

Workflow Diagnosis keeps the current flowchart as the main canvas. The existing upload, target role, target description, and start action remain in the top control area, but styling should be tightened so it reads as one command bar.

Agent Edit Resume uses a two-column PC layout:

- Left column, about 68% width: PDF preview surface.
- Right column, about 32% width: Agent chat and execution stages.
- The preview surface includes an empty state, an upload affordance, the native PDF viewer, and a bottom toolbar.
- The bottom toolbar includes refresh, download, filename/version metadata, and last update time.

## PDF Preview

Use native browser PDF preview first:

- On upload, validate `application/pdf` or `.pdf`.
- Create an object URL with `URL.createObjectURL(file)`.
- Render it in an `<iframe>` with a stable `key` so refresh can force reload.
- Revoke old object URLs when replaced or when the component unmounts.
- Download uses the current object URL and filename.

Do not introduce `pdf.js` in this iteration. Native preview is faster, smaller, and adequate for upload-preview-refresh-download.

## Agent Console

The right panel contains:

- A compact message timeline.
- User input with a send button.
- Execution stages displayed as a vertical list.
- Each stage has status: idle, running, done, or failed.
- Running stages show a small spinner.
- Tool calls appear inside stages as collapsible rows.
- Collapsed rows show tool name and one-line result.
- Expanded rows show only concise structured output, not raw model text.

Initial stages:

1. `读取 PDF`
2. `理解修改意图`
3. `调用工具`
4. `修改内容`
5. `调整样式`
6. `生成 PDF`
7. `刷新预览`

Initial tool-call examples:

- `extract_resume_text`
- `plan_resume_edit`
- `rewrite_resume_section`
- `render_pdf`

## State And Data Flow

Core client state:

- `activeWorkspace`: `workflow` or `agent`
- `pdfFile`
- `pdfPreviewUrl`
- `pdfPreviewVersion`
- `pdfFrameKey`
- `agentMessages`
- `agentStages`
- `isAgentRunning`
- `agentError`

Agent edit flow:

1. User uploads a PDF.
2. The page creates a preview URL and displays it immediately.
3. User sends an edit request.
4. UI appends the user message and starts stage progression.
5. When a real backend exists, the request will send the PDF and instruction, then consume structured progress events.
6. On completion, the UI replaces `pdfPreviewUrl` with the new PDF blob or URL and increments `pdfPreviewVersion`.
7. User can refresh or download the latest preview.

## Performance Requirements

- Keep the existing workflow logic intact and avoid unnecessary remounts while switching tabs.
- Do not load a heavy PDF rendering library.
- Keep stage updates batched and concise.
- Use `memo` for repeated stage rows if they become noisy.
- Keep object URL lifecycle explicit to avoid memory leaks.
- Avoid large raw model output in React state.
- Prefer CSS transitions and lightweight spinners over expensive visual effects.

## Error Handling

- Non-PDF upload shows a visible inline error.
- Sending a prompt without a PDF asks the user to upload a PDF first.
- Sending an empty prompt is blocked.
- Failed Agent runs mark the current stage failed and leave the current PDF preview unchanged.
- Refresh reloads the current preview URL without recreating the PDF data.

## Testing And Verification

Add or update structure tests to assert:

- Navigation exposes both workspace tabs.
- Identity menu remains available and admin link is conditional.
- The Agent workbench has native PDF preview, refresh, and download controls.
- Agent stages include spinner-capable running state and collapsible tool-call rows.
- The implementation does not import `pdfjs` or `pdf.js`.

Manual verification:

- Uploading a PDF immediately previews it.
- Refresh reloads the iframe.
- Download points to the current PDF.
- Sending an edit prompt shows staged Agent progress.
- Existing workflow diagnosis still renders and starts from the command bar.

