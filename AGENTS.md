<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Docs stay current

`docs/` is the current description of the product (features, tech, strategy, business, access, versions). After any change to behavior, access, architecture, or product strategy, update the matching file and add a dated line under Unreleased in `docs/versions.md`. Cursor rule: `.cursor/rules/docs-sync.mdc`. Claude rule: `.claude/rules/docs-sync.md`. Keep those two rules and the checklist in `docs/README.md` the same. Do not put secrets in docs.
