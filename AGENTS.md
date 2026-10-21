# Project instructions

## Preserve the working location flow

The user confirmed that location sharing works correctly at commit
`b1333d3` (2026-10-21). Treat this as the accepted baseline unless the user
explicitly requests a change to that behavior.

- Only signed-in, active members can receive an administrator's location request.
- Close the application modal immediately after either choice or admin cancellation.
  Do not add location-result notifications on the member's screen.
- Waiting for the browser permission choice has no application deadline. After
  permission is granted, stalled coordinate acquisition is bounded to 30 seconds.
- Save the first coordinates as soon as the browser provides them. Do not wait
  for the refinement timer before sending that result. Later, more accurate
  coordinates may refine the same approval for up to 12 seconds.
- Valid authentication sessions must bypass the cross-tab refresh lock. A
  necessary refresh-lock wait must be bounded, never indefinite.
- Do not automatically retry a location request or approval after a connection
  failure. Preserve the existing single terminal refusal/disconnection behavior.
- Update admin fields on the received result; preserve event-driven updates,
  pending-request fallback checks, manual refresh, and minute-based normal refresh.
- Preserve previous approved coordinates when a later request is refused.
  Report browser-provided accuracy honestly; do not infer which permission option
  the member selected or claim to reset browser permission remotely.

Before changing location collection, authentication, request handling, admin
updates, or their SQL functions, compare the change against this baseline.
Run `npm test` and `npm run test:browser` for relevant behavior changes. Preserve
the browser regression tests for a held authentication lock, immediate first-fix
saving, permission waiting, stalled acquisition, and one-shot network failures.

If a later update breaks location sharing, restore the affected location behavior
from `b1333d3` (tag `location-baseline-v1`) and rerun those checks. Restore only
the affected changes; do not reset the entire repository or overwrite unrelated
features. Do not blindly reapply older SQL migrations to the live database.
