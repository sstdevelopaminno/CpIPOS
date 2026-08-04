# Offline Sale Foundation — Phase 1 Checklist

## Included in this phase

- `apps/backoffice-web/src/lib/pos-offline-sale-store.ts`
- `docs/offline-sale-foundation.md`

## Local verification commands

Run from the repository root:

```powershell
cd E:\CpIPOS
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web build
```

## Manual smoke test in browser console

Run inside CpIPOS Windows Runtime DevTools after the PR is deployed:

```js
const mod = await import('/_next/static/chunks/app/preview/pos/page.js').catch(() => null);
console.log('runtime module check', !!mod);
```

The module path is build-dependent, so the main verification is TypeScript/build for Phase 1. Runtime UI integration starts in Phase 2.

## Expected Phase 1 behavior

- No visible POS UI change yet.
- No change to online payment behavior.
- No automatic offline checkout yet.
- New local IndexedDB helper can be imported by Phase 2/3 POS modules.

## Phase 2 target

- Save catalog snapshot after successful online product/table/settings load.
- Add POS diagnostics showing last offline snapshot time.
- Add connectivity state banner.
