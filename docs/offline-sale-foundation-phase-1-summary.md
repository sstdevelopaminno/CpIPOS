# CpIPOS Offline Sale Foundation — Phase 1 Summary

Phase 1 is a safe foundation-only change. It prepares the Windows/PWA client to store offline cash sales locally, but does not yet enable offline checkout in the POS UI.

## What changed

- Added typed IndexedDB helper for offline sale storage.
- Added device-local offline receipt number generation.
- Added queue status helpers for future sync workers.
- Added documentation for the offline sale lifecycle and next integration phases.

## Why this is safe

- No existing POS payment code is changed in this phase.
- No server API behavior is changed.
- No visible UI is changed.
- The new module is available for Phase 2 integration and can be typechecked independently.

## Next phase

Phase 2 should wire online catalog loading to the offline catalog snapshot writer and show diagnostics in POS.
