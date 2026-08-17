# Android shift popup visual-viewport centering — 2026-08-17

Scope: the automatic shift-end reminder (`ปิดกะ / ต่อกะ`) and the manual close-shift confirmation dialog shown over the POS sales screen.

The dialogs are now centered by a full-screen visual-viewport layer rather than `left: 50% / top: 50%` transforms. The layer tracks `window.visualViewport` resize/scroll plus window resize/orientation changes and falls back to `innerWidth/innerHeight` on older Android WebViews.

This specifically addresses Android/LANDI POS screens where the visible viewport differs from the layout viewport, which caused the dialogs to appear shifted right and down.

No shift schedule, continue/close/logout behavior, authorization, cash validation, session handling, or shift API semantics changed.
