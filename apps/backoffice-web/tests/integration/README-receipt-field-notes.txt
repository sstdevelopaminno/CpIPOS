Windows Web POS XP-80T field print notes (2026-11-11)

Customer photo: Xprinter XP-80T USB 80mm paper, amount/date and item row
rightmost characters clipped after Windows Web POS v0.2.5.

Reproduction strategy without making an additional production sale:
1. Render a synthetic HTML receipt from the canonical template in automated tests.
2. Confirm that the 80mm paper CSS carries <=56mm content width with >=1mm
   left margin and retains existing font sizes; 58mm layout is unchanged.
3. Confirm same safety geometry for current-sale and historical-reprint HTML.
4. After the production POS web deployment, CLOSE/REOPEN the existing Windows
   Web POS and reprint ONE completed receipt from receipt history; do not make
   a test sale, void, replay MDM jobs, or auto-retry unknown print deliveries.
5. Read the printed totals on both sides and check font legibility; if still
   clipped, inspect the Windows XP-80T queue's actual paper preset, imageable
   width, scaling/offset, and driver version with an attended customer.

This is code regression testing only; no physical-printer acceptance claim.
