# src/ui

Formal UI structure lives here.

Current first cut:

- `main-window/readonly-thread-surface.ts` for the desktop main window thread shell

Rules:

- This is the source of truth for the formal UI structure.
- `ui-protype/` stays outside `src/` and remains prototype research only.
- Keep the renderer thin. Do not import runtime internals into the UI layer.
