# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.4] - 2026-10-06

### Fixed

- **Android edge-swipe-back closed the app instead of navigating within it.** The app never wrote to the browser history, so the system's back gesture found no history to go back to and Chrome closed the tab (or the PWA). Every screen change now pushes a `history.state` entry, and a `popstate` listener renders the screen for the previous entry. The in-app ‹ Back button on Day Detail and Rules also uses `history.back()` so the gesture and the button share one path. When the user swipes back past the first entry, the handler reseeds `history.state = { appScreen: 'today' }` and renders Today instead of leaving a blank page.

### Notes

- Implementation split `go()` into a renderer (`renderScreen`) + a navigator (`go`) that pushes state. `go()` now wraps `pushState` + `renderScreen`. Boot checks `history.state` and either renders that screen (refresh on Day Detail / Rules) or seeds `{ appScreen: 'today' }` via `replaceState`. The popstate handler reads `e.state` first (matches real-browser behaviour) and falls back to `history.state` if the event has no state.

- 9 new tests in `backfill.js` cover: `go()` pushes, state shape, dispatched popstate restores History / Today / null-fallback, day back button invokes `history.back()`, rules back button invokes `history.back()`. Total: **56 passing** (was 46). Rules suite unchanged at **75 passing**. Effective total: **131 passing**.

- Manual smoke test on Android Chrome with the PWA installed: open Today → tap History tab → tap a row → swipe back from the left edge → lands on History. Swipe back again → lands on Today. Swipe back once more → still on Today, the app does not close (the system back gesture only closes when there's literally no history left to pop, which now never happens after the first navigation).

## [1.7.3] - 2026-10-06

### Fixed

- **Toast was invisible on every screen except Today.** The `<div id="toast">` was nested inside `<section id="screen-today">`. Since `.screen { display: none }` and only `.screen--active { display: block }`, the toast was hidden whenever the user was on Day Detail, Insights, Settings, etc. Backfilling a removal from Day Detail would show no feedback because the success toast was rendering into a hidden parent. The toast now lives at body level, just before the scripts, so it stays visible regardless of which screen is active.

- **Body scroll wasn't locked while a sheet was open.** Tapping the underlying screen could scroll content behind the dimmed backdrop. `openSheet` now adds `body.sheet-open` and `closeSheet` removes it (only when no other sheet is still visible, so the Edit → Confirm flow keeps the lock). `.sheet-open` is just `body { overflow: hidden; }`.

### Tests

- 4 new regression tests in `backfill.js`:
  - Toast is at body level, not inside any `.screen`
  - Toast remains visible from Day Detail after a backfill
  - Toast text mentions the added duration
  - `body.sheet-open` toggled correctly across open / close

- backfill.js total: **46 passing** (was 42). Rules suite unchanged at **75 passing**. Effective total: **121 passing**.

## [1.7.2] - 2026-10-06

### Fixed

- **Backfill time field accepted out-of-range values like "24:00" and "12:60".** The HTML5 `<input type="time">` parser would normally block these, but the JS path used a regex that only checked the two-digit shape. JS `Date` then silently rolled "24:00" forward to next-day 00:00 and "12:60" to 13:00, so the event could be stored with a `startTs` on a different calendar day than the one the user picked. The Add sheet submit now validates `hh ∈ [0, 23]` and `mm ∈ [0, 59]` and falls back to midday (with the existing-events offset) when the value is out of range. The 24:00 / 12:60 path now writes the event to the same day the user selected.

- **Editing a backfilled event left `endTs` stale.** When the user changed the duration of a backfilled event (e.g. 35 min → 45 min), only `duration` was updated. The stored `startTs` (noon of that day) and `endTs` (noon + 35 min) were unchanged, so the day-detail range display showed a wrong window. `Store.editRemoval` now adjusts `endTs = startTs + newDuration * 60_000` whenever a `startTs` is present. Events without a `startTs` (legacy records) are unchanged.

- **`Store.trayForDate` accepted non-integer tray keys.** A corrupted `trayStarts` map (e.g. with a fractional `"1.5"` or non-numeric `"abc"` key from manual localStorage edits) could produce a non-integer tray number. The helper now filters to `Number.isInteger(t) && t > 0`, so only valid tray numbers are considered.

### Tests

- 7 new regression tests in `backfill.js`:
  - "24:00" rejected: event not on wrong day
  - "12:60" rejected: fallback to noon
  - "23:30" honoured
  - Edit backfilled event: `endTs - startTs` matches new duration
  - Edit backfilled event: `startTs` preserved (noon of day)
  - `trayForDate` ignores fractional tray keys
  - `trayForDate` ignores `NaN` tray keys

- backfill.js total: **42 passing** (was 35). Rules suite unchanged at **75 passing**. Effective total: **75 + 42 = 117 passing**.

## [1.7.1] - 2026-10-06

### Changed

- **History rows no longer render a "+" button.** The Add entry point lives only in Day Detail now — open a day from History, then tap "+ Add" in the header (or the empty-state CTA if the day has no events). This tightens the History list to a single tap-to-open action.

### Removed

- `.history-row__add` styling (the small circular "+" icon next to the status badge).

### Notes

- `backfill.js` updated: 35 assertions passing (down from 38; removed the three History "+" open/click-doesn't-navigate/has-dayKey checks, added a "no + button" assertion and a "History row click navigates to Day Detail" regression). Rules suite unchanged. Effective total: **75 + 35 = 110 passing**.

## [1.7.0] - 2026-10-06

### Added

- **Backfill tray-out times from History.** When you missed logging on a particular day, you can now add a removal for any past date in two places:
  - **History row + button.** A small "+" icon appears next to the status badge of every History row. Click it to open the Add sheet prefilled with that day.
  - **Day Detail "+ Add."** A primary "+ Add" button sits in the day header, and a CTA sits inside the empty-state for days with no removals.

- **Optional Approximate time (HH:MM).** The Add sheet now includes an Approximate time field when the target day is not today. Leave it blank to default to midday of that day; supply a time to anchor the start of the removal window. Two backfilled events on the same day are offset by one minute so they don't overlap visually.

- **Tray inference for backfills.** New `Store.trayForDate(dayKey)` returns the tray that was active on a given date, so backfilled events slot into the correct tray band. Pre-tray dates store `tray: null` and display as "No tray" in Day Detail headers.

### Changed

- `Store.addRemoval(date, duration, opts?)` extended with `opts.tray` and `opts.startTs`/`opts.endTs` for backfill. Past dates default to local noon of that day (offset by one minute per existing event) when no explicit time is given. Today path unchanged.
- `Store.nowOnDay(dateKey, offsetMinutes?)` is exposed as a helper for the noon default.
- The History row markup changed from a `<button>` to a `<div role="button">` so the nested "+" action is a real `<button>`. Keyboard activation (Enter / Space) navigates to Day Detail; the "+" button has its own focusable, accessible label.
- The Day Detail header tray label now reads "No tray" instead of "Tray null" when an event has `tray: null`.

### Notes

- 38 new tests in `backfill.js` cover: helpers, date/tray inference, two-event offsets, explicit time, pre-tray `null`, the unchanged Today path, History "+" UI (opens sheet, sets dayKey, shows time field, does NOT navigate), Today Add (hides time field), submit creates event, Day Detail "+Add" header CTA, backfilled status under softening, undo/edit/delete on backfilled events, and "No tray" display. Rules-only suite remains at **75 passing**. Effective total: **75 + 38 = 113 passing**.

## [1.6.0] - 2026-09-22

### Changed

- **Failure softening for one-off 41–60-min removals.** A day
  with exactly one event in the red zone (41–60 min) — where
  that one event is the only such removal in the trailing 7-day
  window (today + 6 prior days) — is classified as **Imperfect**
  instead of Failure. The softening only fires when the red zone
  is the *sole* failure trigger: other triggers (worn < 22h,
  extended > 60 min, > 5 removals, 5 removals with no ≤ 10 min,
  3+ amber removals) keep their full effect.
    - **New `Rules.classifyDayWithSoftening(events, history, todayKey)`** —
      the softening-aware classifier. The spec-strict `classifyDay`
      is unchanged.
    - **`Rules.check41to60Softening(events, history, todayKey)`** —
      returns `{ todayRedCount, historyRedCount, totalInWindow,
      soften }` for inspection / testing.
    - **`Rules.isRedZone(duration)`** — utility predicate
      (41 ≤ duration ≤ 60).
    - **`Store.historyEventsExcludingToday(todayKey, days)`** —
      events from the prior `days` calendar days, in the user's
      timezone.
    - Softening wires through every view that displays status:
      Today (forecast), History (row badges), Day detail (header),
      Insights (distribution + streaks), next-removal-max
      planning, multi-removal planning.
  **Spec deviation (intentional):** spec §10 #2 makes "any single
  removal is 41–60 min" an unconditional Failure. We loosen this
  one trigger. Documented in `RULESHEET.md` under "One-off 41–60
  min softening".

- **Next-removal card redesigned.** Replaces the previous
  "MAX X MIN" + separate "IF YOU NEED N MORE REMOVALS" card
  with a single inline list showing all valid (count, per-removal
  max) pairs at once:
    - "1 more removal · 35 MIN"
    - "2 more removals · 30 MIN EACH"
    - "3 more removals · 28 MIN EACH"
  The card also handles three terminal states:
    - **Failure is locked in** — replaces the list entirely.
    - **No more removals today** (at cap for target).
    - **No safe next removal** (today's events block any path to
      the chosen target).
  Pluralisation: `1 more removal` (singular) uses `MIN`; `2+ more
  removals` uses `MIN EACH`. The "TOTAL LEFT" subtext moves under
  the list and adds `max single removal N MIN` so users see both
  the per-count maxes and the absolute single-removal max.

### Notes

- 22 new softening tests + 14 new capacity-list tests.
- Total tests: **275 passing**.

## [1.5.1] - 2026-09-22

### Changed

- **Personal Gate is now opt-in.** It was originally built for the
  author's specific orthodontic requirement (two days before
  Tray 6 had to be Perfect). New users should never see this
  feature unless they actively enable it.
    - **Default `gateEnabled: false`** for new users.
    - **Removed the gate step from onboarding** (3 steps now,
      down from 4). The progress dots reflect this.
    - **Tray screen no longer shows the gate card** unless
      `gateEnabled` is `true` AND both dates are set.
    - **Settings → Personal Gate** group: a toggle to enable,
      plus the two date fields and a customisable name. Off by
      default; the user has to actively turn it on.
    - **Existing users** who already had `gateEnabled: true` keep
      their configuration (the migration doesn't touch it).

### Notes

- 16 new tests for the opt-in gate behaviour.
- Total tests: **236 passing**.

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
