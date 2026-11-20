<!--
First line: if this PR changes SPEC.md, PLAN.md, CLAUDE.md or anything under .github/, replace the
line below with "Changes: <which of those files>". Otherwise delete it.
-->
Changes: SPEC.md / PLAN.md / CLAUDE.md / .github/

Closes #

## Summary

<!-- What changed and why, in a few sentences. Name the SPEC sections it implements. -->

## How tested

<!-- Each command you ran, with its summary line pasted. Say which checks you could not run and why. -->

```
pnpm test:unit        →
pnpm lint             →
pnpm typecheck        →
pnpm test:integration →   (when packages/db or a migration changed)
```

Preview smoke: <!-- link to the preview smoke result -->

## Risk level

<!-- low / medium / high, and why. Auth, billing, the command and emergency path, and unofficial
providers are CODEOWNERS paths: mark high and leave the merge to a human. -->

## Assumptions and omissions

<!-- Anything you assumed, left out or noted for a follow-up issue. Write "None" if none. -->

## New dependencies

<!-- One line per new dependency: name, and why the standard library or an existing dependency will not
do. Write "None" if none. -->
