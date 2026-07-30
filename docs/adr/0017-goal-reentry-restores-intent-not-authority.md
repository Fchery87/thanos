# ADR 0017 — Goal re-entry restores intent, not authority

**Status:** Accepted

A persisted `/goal` records Goal Intent only. After every process restart,
Thanos restores both formerly active and paused goals as paused with
`restart_requires_approval`; it never restores a Run Grant. `/goal resume`
remains the single re-entry command: read-only intent may continue directly,
while mutating intent must regenerate and approve its Work Contract and capture
a fresh Repository Baseline before any continuation is sent.

This corrects the current behavior, which persists only condition and status,
restores `active` as active, and lets `/goal resume` immediately enqueue work
without knowing whether mutation authority was lost. A same-process pause may
retain its Run Grant, but resume must revalidate its baseline and contract
revision; drift destroys the grant and returns the run to approval.
