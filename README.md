# Invisalign Wear Tracker

A mobile-first, local-first web app for tracking Invisalign tray-out time.
Built strictly to the product specification — no AI/LLM involved in
classification, calculation, or guidance.

## Quick start

```bash
# From this directory:
python3 -m http.server 8765
# Then open http://localhost:8765/index.html

# Or open index.html directly in a browser (Chrome / Safari / Firefox).
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell + screens |
| `styles.css` | Mobile-first Apple-inspired design system |
| `rules.js` | Deterministic classification, forecast, next-removal, plan |
| `store.js` | localStorage-backed raw events + settings |
| `app.js` | UI, routing, sheet management |
| `tests.html` | Browser UI for running rules-engine acceptance tests |
| `rules-tests.js` | 75 deterministic test cases (every §11 example + every §41 acceptance test + edge cases) |
| `manifest.webmanifest` | PWA install metadata |
| `icon-*.svg` | App icons |

## Design principles

1. **The app does the thinking.** The user types a whole number of
   minutes and immediately sees the day recalculated.
2. **Deterministic rules, no AI in the loop.** Every classification,
   forecast, and next-removal number is derived by pure JS from raw
   events. The rules are unit-tested against every example in the
   specification.
3. **Raw events are the source of truth.** Derived fields are
   recomputable. Editing a historical event automatically reclassifies
   the day, the streak, and the analytics.
4. **Local-first.** Everything lives in `localStorage`. Export to JSON
   or CSV. Delete All from Settings.
5. **Apple-inspired minimalism.** System font stack, generous spacing,
   restrained motion, large readable numerics, full dark mode.

## How the rules engine works

See `rules.js`. The single most important function is `classifyDay(events)`,
which exactly implements the failure / perfect / near-perfect / imperfect
ladder from spec §10:

```
FAILURE (any of)
  1. worn < 22h
  2. any removal 41–60
  3. any removal > 60
  4. more than 5 removals
  5. exactly 5 removals and none ≤ 10 min
  6. 3 or more amber removals (36–40)

PERFECT (no failure, and)
  - ≤ 4 removals
  - no amber, no red
  - 1–3 removals: ≤ 2 green-zone breaches (31–35)
  - 4 removals:    ≤ 1 green-zone breach

NEAR PERFECT (no failure, not perfect)
  - 1–2 amber removals
  - 1–3 removals with 3 green-zone breaches
  - exactly 5 removals with ≥ 1 event ≤ 10 min

IMPERFECT (no failure, not perfect, not near-perfect)
```

`maxNextRemoval(events, target)` performs a binary search over
0–120 minutes and returns the largest `d` such that adding `[d]` keeps
the day capable of `target ∈ {perfect, near-perfect, avoid-failure}`.

`planRemaining(events, target, N)` returns the largest uniform
duration X such that adding N more removals each of X still hits the
target. This is the "conservative feasible plan" surfaced in the
multi-removal card on the Today screen (spec §14).

## Testing

```bash
# Rules engine (75 cases — every spec example + every acceptance test)
node -e "global.window=globalThis; \
  require('./rules.js'); \
  require('./rules-tests.js'); \
  const {pass,fail}=window.RulesTests.runAll(); \
  console.log(pass,'passed,',fail,'failed');"

# Open tests.html in a browser for the visual runner.
```

The rules engine currently passes **75 / 75** tests:

- All 32 §11 validated examples
- All 12 §41 acceptance tests (A–L)
- All 9 §9 zone / breach tests
- Edge cases (empty, single, exactly-22h, >60, 6+ removals, etc.)
- Forecast invariants
- Next-removal max invariants (including spec §14: 40,40 → 35)

## Verified user flows

- **Add 35 minutes**: 23h 25m worn, Perfect still possible, Next removal
  MAX 35 MIN, 85 MIN LEFT. Matches spec §3.
- **Log 40, then 40**: 22h 40m worn, Near Perfect still possible, Next
  removal MAX 35 MIN, 40 MIN LEFT, multi-removal plan 20 + 20.
  Matches spec §14.
- **Log 41**: Failure locked in immediately. Matches spec §17.
- **Log three 36s**: Failure (third amber). Matches spec §10.
- **Edit a historical event**: all derived values (status, streak,
  insights, tray 6 gate) recompute from raw events.

## Phase 3 (deferred, per spec §40)

- Optional tray-out timer with background recovery
- Optional end-of-day reminder
- Optional cloud sync

These are intentionally not implemented in the MVP to keep the
core rules engine, persistence, and Today screen maximally reliable.
