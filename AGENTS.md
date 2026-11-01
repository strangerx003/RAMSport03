<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## RAMSport diagram UI constraints

- Never add an Events or Gates palette above the Components list in the FTA left pane. Gate creation stays in the existing connection workflow unless the user explicitly requests a different design.
- Center the RBD/FTA workspace action buttons as one normal-flow group. Never absolutely position an action button over toolbar help text, status text, or another control.
- Do not add an alternative connection mode or a Connect toolbar button unless the user explicitly requests one. Use the existing drag-from-port connection workflow.
