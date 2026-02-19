# AGENTS.md

## Git Workflow Policy (Relaxed)

Goal: keep branch history clear while avoiding forgotten local changes.

1. Isolated commits are preferred, but not mandatory.
2. For one task, related changes can be grouped into one stage commit.
3. Use a checkpoint commit at least once per accepted milestone, or every 60 minutes during active work.
4. `git add -A` is allowed only after `git status --short` confirms all changed files belong to the current task.
5. Before branch switch, merge, or handoff: workspace must be clean by commit or named stash.
6. Any stash must include a clear message and be referenced in handoff notes.
7. Commit messages must include task scope prefix, for example:
   - `feat(p5.7-r1): ...`
   - `fix(p5.6.14-r4): ...`
   - `docs(p5.7): ...`

## Anti-Drift Checklist

Run this checklist before ending a task:

1. `git status --short`
2. confirm no unrelated files are staged
3. commit or stash unfinished work
4. provide latest commit SHA in acceptance report

