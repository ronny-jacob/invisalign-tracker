# Invisalign Wear Tracker — Rulesheet

A concise reference for the deterministic rules engine.

## Constants

- Day length: **1440 min**
- 22h minimum wear: **1320 min**

## Event zones

| Duration (min) | Zone | Notes |
| --- | --- | --- |
| 0–30 | **Green** | No breach |
| 31–35 | **Green (minor)** | "Breach" — exceeds 30 by 1–5 min |
| 36–40 | **Amber** | Moderate overrun |
| 41–60 | **Red** | Significant overrun |
| > 60 | **Extended** | Auto-failure |

Breach = strictly more than 30 min. Excess = duration − 30.

## Daily classification

Failure if **any** of these is true:

1. Worn time < 22 h
2. Any single removal is 41–60 min
3. Any single removal is > 60 min
4. More than 5 removals
5. Exactly 5 removals and none is ≤ 10 min
6. Three or more amber removals (36–40 min)

If no failure and worn ≥ 22 h:

- **Perfect** — ≤ 4 removals, no amber/red, AND
  - 1–3 removals: ≤ 2 green-zone breaches (31–35)
  - 4 removals: ≤ 1 green-zone breach
- **Near Perfect** — not Perfect, AND any of:
  - 1 or 2 amber removals
  - 1–3 removals with 3 green-zone breaches
  - 4 removals with 2+ green-zone breaches
  - exactly 5 removals with at least one ≤ 10 min
- **Imperfect** — none of the above, but no failure.

## Forecast

The day classifies as if no further removals were added. Recomputed
on every change.

## Next-removal max

For a target outcome (`perfect` / `near-perfect` / `avoid-failure`),
the largest duration `d` (whole minutes, 0–120) such that adding
`[d]` keeps the day capable of the target.

If Perfect is no longer achievable, the app targets Near Perfect (or
Avoid Failure when even that is gone).

## Multi-removal plan

For `N` remaining removals, the largest uniform duration `X` such that
adding `N` removals each of `X` still hits the target. Conservative
feasible plan — any non-uniform allocation ≤ X is also safe.

## Streaks

- **Perfect streak** — consecutive Perfect days. NO_DATA and
  IN_PROGRESS don't break it.
- **Non-failure streak** — consecutive days that are Perfect, Near
  Perfect, or Imperfect. Failure resets it. NO_DATA and IN_PROGRESS
  don't break it.

## Tray 6 progression gate (user-defined)

Both gate days must classify as **Perfect**. Near Perfect does not
qualify. User-defined; not medical advice.

## Invariants

- Raw events are the only source of truth.
- All derived fields (status, worn, breaches, streaks, etc.) are
  recomputable from events.
- No AI/LLM is involved in any calculation.
