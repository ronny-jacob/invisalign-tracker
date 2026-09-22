# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
