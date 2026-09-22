# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-09-22

### Changed

- **Insights UI redesigned.** The previous layout had two dense
  cards (10+ stat tiles each + a tiny distribution bar + two
  streak rows) which was hard to scan. The new design centres
  three visual primitives:
    1. **Big primary number** — the count of the dominant status
       in the range, with a contextual label and "also N
       Near / Failure" addendum.
    2. **Stacked horizontal bar** — full-width, with the four
       status colours and a clearly numbered legend below.
    3. **Dot grid** — one circle per day, colour-coded by status,
       oldest left → newest right, today highlighted with a
       ring. Hidden when the range exceeds 35 days to avoid a
       messy grid.
- **Streak prominent.** Single big number with a flame icon and
  "best N" caption. Replaces the previous two streak cards.
- **Averages grid** at the bottom of the All-time card shows
  Avg Worn / Avg Out / Avg Removals / Longest Removal — the four
  numbers most worth knowing at a glance.

### Notes

- Range cards are unchanged in count: Last 7 days / Last 30 days
  / All time. Each card now has identical structure so the eye
  can compare them directly.
- 21 new tests for the redesigned Insights.
- Total tests: **220 passing**.

## [1.4.0] - 2026-09-22

### Added

- **Tray-out timer.** A new `Start Timer` button on Today starts
  a background timer. While running, a prominent card shows the
  elapsed time (live-updating every second) and offers
  `Stop & Log` / `Discard` actions.
- **Timestamp-based, not interval-based.** The timer's source of
  truth is `Date.now() - startedAt`, so elapsed time stays
  accurate across:
    - Screen lock / OS sleep
    - Browser backgrounding
    - Page refresh / re-open
    - Tab visibility changes
- **Background recovery.** Timer state lives in `localStorage` as
  `{ running, startedAt }`. On app boot, if a timer was running
  before, it is restored and the live tick is resumed. On
  `visibilitychange`, the Today screen re-renders so the elapsed
  counter reflects the actual elapsed time.
- **Long-running confirmation.** Stopping a timer that has run
  for **≥ 2 hours** triggers a confirmation sheet:
  "Timer has been running for 2h 30m. Is this correct?"
  with `Use time` / `Discard` actions. The app never silently
  invents a duration.
- **Discard confirm.** Discarding a timer asks for confirmation
  so an accidental tap doesn't lose data.
- **Export/import** the running timer state in JSON backups.
- 21 new tests covering timer state, UI rendering, long-running
  detection, discard flow, export/import round-trip.

### Notes

- Manual `Add Removal` and the timer are independent. You can
  log manual entries while a timer is running.
- A logged timer event stores the exact `startTs` (the moment
  you tapped Start) and `endTs` (the moment you tapped Stop).

Total tests: **199 passing**.

## [1.3.0] - 2026-09-22

### Added

- **First-run onboarding flow.** A four-step modal shown on first
  launch (and re-runnable from Settings → Re-run setup):
    1. **Welcome** — privacy one-liner and medical disclaimer.
    2. **Your plan** — total aligners, current aligner, day-count
       pattern (preset chips: 11/11/10, 10/10/10, 7/7/7, or custom).
    3. **Timezone** — pre-filled with the device's detected
       timezone; user can change.
    4. **Personal gate** (optional) — pick two dates that must
       both classify as Perfect, or skip.
- **In-app rules reference** (`Settings → How the rules work →
  View`) — formatted version of `RULESHEET.md` accessible without
  leaving the app.
- **Personal gate settings** (`gateEnabled`, `gateName`, `gateDate1`,
  `gateDate2`) replace the hardcoded `tray6Date`, `tray6GateDate1`,
  `tray6GateDate2` fields. The legacy fields are kept in sync for
  backward compatibility.

### Fixed

- **Empty-state MAX bug.** The empty-Today screen previously
  hardcoded "MAX 60 MIN" (which is incorrect — 60 min is a red-zone
  failure). It now calls `Rules.maxNextRemoval([], 'perfect')`,
  which correctly returns 35.
- **TDZ bug in Store load order.** The `backfillTrayStarts` call
  inside `load()` referenced `todayKey()`, which in turn accessed
  `state` before `let state = ...` had finished initialising.
  Resolved by separating `let state = emptyState()` from
  `state = load()` so function declarations are fully hoisted first.
- **Default currentTray** changed from 5 to 1. New users start on
  tray 1; existing users keep their current value (migration).
- **Existing users** with logged events are auto-marked as
  onboarded and skip the new flow.

### Notes

- 19 new tests for onboarding + rules screen.
- Total tests: **178 passing**.

## [1.2.1] - 2026-09-22

### Fixed

- **Day-detail header now shows the day's tray, not the current
  tray.** Previously, opening 18 Sept in History (a day logged while
  on Tray 5) showed the global "TRAY 6 OF 14" header pill, which was
  misleading. Now:
    - The day-detail screen hides the global tray pill entirely.
    - The day-detail card displays a tray badge ("Tray 5",
      "Tray 5 + 6", etc.) derived from the events on that day.
    - If the day's tray differs from the current tray, the badge
      uses a muted "past" style so the difference is obvious.
    - If a day has events from multiple trays (e.g. the user
      backdated some events after switching trays), the badge shows
      "Tray 5 + 6" (sorted).
- 7 new tests for day-detail tray badge behaviour.

## [1.2.0] - 2026-09-22

### Added

- **Tray start-date tracking.** Each tray now has a recorded start
  date, exposed as `settings.trayStarts: { '<tray>': 'YYYY-MM-DD' }`.
  Three sources populate it:
    1. **Backfill on load** — for every tray that already has events
       but no recorded start date, infer the earliest event date as
       the tray's start.
    2. **Per-event inference** — the first event of a new tray auto-
       records its date as the tray start.
    3. **Manual correction** in Settings → Tray Start Dates.
- **`Store.traySchedule(tray)`** returns
  `{ startDate, durationDays, daysElapsed, daysRemaining,
     expectedSwitchDate, isOverdue, isComplete }`.
- **`Store.setTrayStartDate(tray, dateKey)`** with input validation.
- **`Store.trayStartsKnown()`** returns the sorted list of trays with
  recorded start dates.
- **Tray screen** now shows
    - "Day N of M" for the current tray
    - "Started X · switch in N days" / "switch tomorrow" / "switch today"
    - "Overdue by N days" with the original switch date
    - Progress bar (filled proportionally)
    - "Tray Schedule" list of every known tray with its start date
      and day-of-N status.
- **Settings → Tray Start Dates** group with a date picker per known
  tray.
- 16 new tests for tray tracking logic.

### Notes

- Updating `currentTray` no longer auto-records today as the start
  date; the date is inferred from the first event of the new tray.
  This avoids clobbering inferred dates when the user changes tray
  before logging any events.
- A future enhancement: auto-roll `currentTray` when
  `daysElapsed >= durationDays`.

## [1.1.0] - 2026-09-22

### Added

- **Timestamps on every event.** Each removal now stores `createdTs`,
  `editedTs`, and an approximate `startTs`/`endTs` window. Manual
  entry derives the window as "the most recent N minutes ending at
  now"; a future timer feature can overwrite these with the exact
  recorded timestamps.
- **Time-aware formatting helpers** (`formatClock`, `formatRange`,
  `formatRelative`) that respect `settings.timezone` for the actual
  time and the device locale for 12h / 24h preference.
- **Day-detail event rows** now show the approximate window
  (e.g. `10:06–10:42`) and when the event was logged
  (`logged just now`, `logged 12m ago`, or a clock for older
  events). Edits append `· edited 5m ago`.
- **Today grid** shows `last at HH:MM` under the REMOVALS cell once
  at least one event has been logged.
- **History rows** show `last at HH:MM` in the day's sub-line.
- **Toast messages** now include relative time
  (`Added 35 min · just now`, `Updated · 2m ago`).
- 17 new tests for timestamp behaviour, total 136 tests passing.

### Notes

- Existing data is fully preserved. Old events with `startTs: null`
  continue to render correctly (no time-range prefix).
- All date / time display is now timezone-aware via
  `settings.timezone`.

## [1.0.1] - 2026-09-22

### Added

- `RULESHEET.md` — concise one-page rules reference (zones,
  classification ladder, next-removal-max algorithm, multi-removal
  plan, streaks, tray-6 gate, invariants). Useful as a quick lookup
  and as the basis for an in-app rules explainer later.

## [1.0.0] - 2026-09-18

### Added

- **Mobile-first web app** for tracking Invisalign tray-out time.
  Pure HTML / CSS / JS, no build step, no dependencies.
- **Deterministic rules engine** (`rules.js`) implementing spec §10
  verbatim — no AI / LLM in classification, forecast, or
  next-removal calculation.
- **localStorage-backed store** (`store.js`) — raw events as the
  single source of truth, with edit history and JSON / CSV export.
- **Five-screen UI** — Today, History, Day Detail, Tray, Insights,
  Settings.
- **Apple-inspired design system** — system font stack, generous
  spacing, large readable numerics, full dark mode, reduced-motion
  support.
- **Tray tracking** with user-defined progression gate (defaults
  to the 18 Sept / 19 Sept / 20 Sept Tray 6 transition).
- **Insights** — last-7-days, last-30-days, all-time aggregates,
  status distribution, streak tracking (Perfect + Non-Failure).
- **PWA-ready** with `manifest.webmanifest` and SVG icons.
- **75-case rules-engine test suite** covering every §11 example,
  every §41 acceptance test A–L, all §9 zone / breach tests, and
  edge cases.
- **Live at** https://ronny-jacob.github.io/invisalign-tracker/
  (GitHub Pages, served from `main` branch, HTTPS enforced).
