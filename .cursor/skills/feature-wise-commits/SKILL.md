---
name: feature-wise-commits
description: >-
  Splits dirty or staged work into several focused git commits (one logical
  feature or concern per commit). Use when the user asks for feature-wise
  commits, split commits, commit by feature, or to organize a large change
  into a clean history before push or PR.
---

# Feature-wise commits

Turn one working tree into a **sequence of small, reviewable commits**. Each commit should tell one story: one feature, one fix, one refactor area, or one docs slice tied to code it describes.

## Hard rules

- **Only commit when the user asked** (this skill is that request). Do not push unless they ask separately.
- **Never** update git config, skip hooks, force-push, or run destructive git (`reset --hard`, `clean -fdx`, rewrite history) without explicit approval.
- **Never** stage everything: no `git add .`, no `git add -A`. Stage **named paths** only; use `git add -p` / patch staging when one file spans multiple features.
- **Never** commit secrets (`.env`, credentials, keys). Warn if the user wanted them included.
- If a pre-commit hook fails, **fix and create a new commit** — do not amend unless the user's commit rules allow it.

## 1. Inventory

Run in parallel from the repo root:

```bash
git status
git diff
git diff --cached
git log -10 --oneline
```

Include **staged and unstaged** changes. If the user scoped the task ("only SMS work"), respect that scope.

## 2. Group into commit slices

Cluster paths by **shared intent**, not folder alone. Typical slices in this repo:

| Slice kind | Usually includes | Commit prefix |
| --- | --- | --- |
| Feature | routes, components, actions, models, native code for one user flow | `feat(scope):` |
| Fix | minimal change fixing one bug | `fix(scope):` |
| Refactor | behavior-neutral moves/renames | `refactor(scope):` |
| Tests | tests for the slice they cover | same type as the feature, or `test(scope):` |
| Docs (product) | `docs/*.md` + `docs/versions.md` **Unreleased** bullet for that behavior | `docs:` or bundled in the feature commit |

**Coupling**

- Put **model + action + UI** for one feature in the **same** commit when they do not compile/run separately.
- Put **tests** in the same commit as the code they test when small; otherwise immediately after that feature commit.
- For behavior changes, update the matching file under `docs/` (see `.cursor/rules/docs-sync.mdc`) and add a dated **Unreleased** line in `docs/versions.md` in the **same commit** as that behavior — not a separate "docs dump" unless the user wants docs-only commits.

**Order**

1. Shared libs / models other slices depend on  
2. Server actions / API  
3. UI and routes  
4. Android / Capacitor native (if part of the feature)  
5. Tests-only follow-ups only when large  

**Exclude** from commits unless the user asks: `.next/`, build artifacts, accidental duplicates, unrelated WIP.

## 3. Propose the plan

Before committing, show a short numbered plan:

```markdown
## Commit plan

1. **feat(sms): inbox plugin and save review** — `src/lib/native/...`, `src/app/sms-inbox/`, …
2. **docs: SMS inbox flow** — `docs/features.md`, `docs/versions.md`
```

Adjust if the user already approved splitting in chat. One-line titles are enough unless hunks within a file need calling out.

## 4. Execute (one slice at a time)

For each approved slice:

1. Ensure the index is clean for **unrelated** files (do not unstaged others' work destructively).
2. `git add` **only** paths for this slice.
3. `git diff --cached` — verify the commit contains **only** this slice.
4. Commit with a message matching recent history: **`type(scope): short imperative summary`**, optional body with **why**.

**Commit message (PowerShell / Windows — default for this user):**

```powershell
git commit -m "feat(sms): add inbox read and save review sheet" -m "Parse bank SMS locally and let users confirm before creating notes."
```

**Commit message (bash):** use the user's HEREDOC pattern with `git commit -m "$(cat <<'EOF' ... EOF)"`.

5. `git status` — confirm success before the next slice.

Repeat until the planned slices are committed or the user stops you.

## 5. Report

Summarize:

- Commit SHAs and subjects (newest last or as a list)
- Anything **left unstaged/uncommitted** and why
- Reminder: push only if they asked

## Examples (this repo)

**Good sequence**

1. `feat(notes): note colors and settings sheet` — model, actions, `NoteSettingsSheet`, styles  
2. `test(notes): cover note HTML sanitization` — `tests/unit/noteHtml.test.ts`  
3. `feat(admin): in-app product docs viewer` — admin routes + `productDocs`  

**Avoid**

- One commit mixing SMS inbox + unrelated profile page edits  
- `docs/versions.md` updated once at the end with ten unrelated bullets  
- Staging `package-lock.json` in every commit — include it in the commit that **changed** `package.json`

## Do not

- Do not open PRs or branches unless the user asks (use `split-to-prs` for PR splits).
- Do not squash or rebase existing commits unless explicitly requested.
