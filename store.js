/* ============================================================
 * Store — persistence + raw event source of truth
 * ============================================================
 * localStorage is the single source of truth.
 * Every UI screen reads via store.onChange().
 * No derived state is persisted; everything is recomputable
 * from raw events via rules.js.
 * ============================================================ */

(function (global) {
  'use strict';

  const KEY = 'invisalign-tracker.v1';
  const RULE_VERSION = '1.0.0';

  /* ---- schema ----
   * {
   *   schemaVersion: 1,
   *   ruleVersion: '1.0.0',
   *   events: [
   *     {
   *       id: 'ev_xxx',
   *       date: 'YYYY-MM-DD',         // local date (per timezone)
   *       tray: 5,
   *       eventNumber: 1,             // per-day ordering
   *       duration: 35,               // whole minutes
   *       startTs: null | ms,
   *       endTs: null | ms,
   *       createdTs: ms,
   *       editedTs: null | ms,
   *       editHistory: [
   *         { ts: ms, from: <min>, to: <min> }
   *       ]
   *     }
   *   ],
   *   settings: {
   *     theme: 'system' | 'light' | 'dark',
   *     timezone: 'Asia/Kolkata',     // IANA
   *     currentTray: 5,
   *     totalTrays: 14,
   *     tray1Days: 11,
   *     tray2Days: 11,
   *     trayOnwardDays: 10,
   *     tray6Date: '2026-09-20',
   *     tray6GateDate1: '2026-09-18',
   *     tray6GateDate2: '2026-09-19',
   *     notificationsEnabled: false
   *   }
   * }
   */

  const defaultSettings = () => ({
    theme: 'system',
    timezone: 'Asia/Kolkata',
    currentTray: 5,
    totalTrays: 14,
    tray1Days: 11,
    tray2Days: 11,
    trayOnwardDays: 10,
    // Map of tray number → start date (YYYY-MM-DD).
    // Auto-populated from the first event of each tray on load if empty.
    trayStarts: {},
    tray6Date: '2026-09-20',
    tray6GateDate1: '2026-09-18',
    tray6GateDate2: '2026-09-19',
    notificationsEnabled: false,
  });

  function emptyState() {
    return {
      schemaVersion: 1,
      ruleVersion: RULE_VERSION,
      events: [],
      settings: defaultSettings(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyState();
      parsed.events = Array.isArray(parsed.events) ? parsed.events : [];
      parsed.settings = Object.assign(defaultSettings(), parsed.settings || {});
      if (!parsed.settings.trayStarts || typeof parsed.settings.trayStarts !== 'object') {
        parsed.settings.trayStarts = {};
      }
      // Backfill tray start dates from existing events if missing.
      backfillTrayStarts(parsed);
      return parsed;
    } catch (err) {
      console.warn('Store: failed to load, starting fresh', err);
      return emptyState();
    }
  }

  // For every tray number that has events but no recorded start date,
  // record the earliest event date as the inferred tray start. This is
  // a best-guess: the first logged event of a tray ≈ the day it began.
  function backfillTrayStarts(s) {
    const starts = s.settings.trayStarts;
    const byTray = {};
    for (const e of s.events) {
      const t = e.tray;
      if (!byTray[t] || e.date < byTray[t]) byTray[t] = e.date;
    }
    let changed = false;
    for (const t of Object.keys(byTray)) {
      if (!starts[t]) {
        starts[t] = byTray[t];
        changed = true;
      }
    }
    // Also: if currentTray has no recorded start, default to today so
    // the day-counter is meaningful from the moment of upgrade.
    if (!starts[String(s.settings.currentTray)]) {
      starts[String(s.settings.currentTray)] = todayKey();
      changed = true;
    }
    return changed;
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Store: failed to save', err);
    }
  }

  /* ---- change notification ---- */
  const listeners = new Set();
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit() {
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.warn('listener error', err); }
    }
  }

  let state = load();

  /* ---- date helpers ----
   * We bucket events by the user's local date (per settings.timezone).
   * For simplicity in MVP we use the device's local date but
   * use the IANA timezone for "today" derivation. */

  function todayKey() {
    // Use Intl to derive YYYY-MM-DD in the configured timezone
    const tz = state.settings.timezone || 'Asia/Kolkata';
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  }

  function eventsForDate(dateKey) {
    return state.events
      .filter(e => e.date === dateKey)
      .sort((a, b) => a.eventNumber - b.eventNumber);
  }

  function allDatesSorted() {
    const set = new Set(state.events.map(e => e.date));
    return Array.from(set).sort();
  }

  /* ---- mutations ---- */

  function newId() {
    return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function addRemoval(date, duration, opts) {
    duration = Math.floor(duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid input. Enter a whole number of minutes.');
    }
    opts = opts || {};
    const existing = eventsForDate(date);
    const now = Date.now();
    // Manual entry has no real start/end, so we approximate the window
    // as "the most recent N minutes ending now." A future timer feature
    // can overwrite these with the actual recorded timestamps.
    const endTs = opts.endTs != null ? opts.endTs : now;
    const startTs = opts.startTs != null ? opts.startTs : (endTs - duration * 60_000);
    const event = {
      id: newId(),
      date,
      tray: state.settings.currentTray,
      eventNumber: existing.length + 1,
      duration,
      startTs,
      endTs,
      createdTs: now,
      editedTs: null,
      editHistory: [],
    };
    state.events.push(event);
    // If this is the first event of this tray, record its date as the
    // tray start. Best-effort: user can correct in Settings.
    if (!state.settings.trayStarts[String(event.tray)]) {
      state.settings.trayStarts[String(event.tray)] = event.date;
    }
    save(state);
    emit();
    return event;
  }

  function undoLastRemoval(date) {
    const todays = eventsForDate(date);
    if (todays.length === 0) return null;
    const last = todays[todays.length - 1];
    state.events = state.events.filter(e => e.id !== last.id);
    save(state);
    emit();
    return last;
  }

  function editRemoval(id, newDuration) {
    newDuration = Math.floor(newDuration);
    if (!Number.isFinite(newDuration) || newDuration <= 0) {
      throw new Error('Invalid input. Enter a whole number of minutes.');
    }
    const ev = state.events.find(e => e.id === id);
    if (!ev) throw new Error('Event not found.');
    const from = ev.duration;
    if (from === newDuration) return ev;
    ev.editHistory.push({ ts: Date.now(), from, to: newDuration });
    ev.duration = newDuration;
    ev.editedTs = Date.now();
    save(state);
    emit();
    return ev;
  }

  function deleteRemoval(id) {
    const before = state.events.length;
    state.events = state.events.filter(e => e.id !== id);
    if (state.events.length !== before) {
      save(state);
      emit();
      return true;
    }
    return false;
  }

  function updateSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch || {});
    // Note: we do NOT auto-set trayStarts[currentTray] = today here.
    // That would clobber inferred dates. Instead:
    //   - backfillTrayStarts() on load infers from earliest event per tray
    //   - addRemoval() infers the start date from the first event of a tray
    //   - setTrayStartDate() lets the user correct any inference manually
    save(state);
    emit();
  }

  function setTrayStartDate(tray, dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) {
      throw new Error('Invalid date. Use YYYY-MM-DD.');
    }
    const t = String(tray);
    state.settings.trayStarts = Object.assign({}, state.settings.trayStarts);
    state.settings.trayStarts[t] = dateKey;
    save(state);
    emit();
    return state.settings.trayStarts[t];
  }

  // Compute the schedule for a given tray.
  // Returns { startDate, durationDays, daysElapsed, daysRemaining,
  //   expectedSwitchDate, isOverdue, isComplete }.
  function traySchedule(tray) {
    const s = state.settings;
    const startDate = (s.trayStarts && s.trayStarts[String(tray)]) || null;
    const durationDays = trayScheduleDuration(tray);
    if (!startDate) {
      return {
        startDate: null, durationDays, daysElapsed: 0, daysRemaining: durationDays,
        expectedSwitchDate: null, isOverdue: false, isComplete: false,
      };
    }
    const today = todayKey();
    const daysElapsed = daysBetween(startDate, today);
    const daysRemaining = Math.max(0, durationDays - daysElapsed);
    const expectedSwitchDate = addDays(startDate, durationDays);
    const isComplete = daysElapsed >= durationDays;
    const isOverdue = daysElapsed > durationDays;
    return { startDate, durationDays, daysElapsed, daysRemaining, expectedSwitchDate, isOverdue, isComplete };
  }

  function trayScheduleDuration(tray) {
    const s = state.settings;
    const t = Number(tray);
    if (t === 1) return s.tray1Days;
    if (t === 2) return s.tray2Days;
    return s.trayOnwardDays;
  }

  function daysBetween(a, b) {
    // a, b are YYYY-MM-DD; returns inclusive difference (today - start).
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const da = new Date(ay, am - 1, ad).getTime();
    const db = new Date(by, bm - 1, bd).getTime();
    return Math.round((db - da) / 86_400_000);
  }

  function addDays(dateKey, n) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d + n);
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  function clearAll() {
    state = emptyState();
    save(state);
    emit();
  }

  function trayStartsKnown() {
    const starts = state.settings.trayStarts || {};
    return Object.keys(starts)
      .map(Number)
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
  }

  function exportJSON() {
    return JSON.stringify({
      schemaVersion: state.schemaVersion,
      ruleVersion: state.ruleVersion,
      exportedAt: new Date().toISOString(),
      events: state.events,
      settings: state.settings,
    }, null, 2);
  }

  function exportCSV() {
    // Per spec §31: date, tray, event number, duration minutes,
    // total out, worn minutes, removal count, status
    const byDate = new Map();
    for (const e of state.events) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    const dates = Array.from(byDate.keys()).sort();
    const lines = ['date,tray,event_number,duration_minutes,total_out,worn_minutes,removal_count,status'];
    const R = global.Rules;
    for (const d of dates) {
      const evts = byDate.get(d).sort((a, b) => a.eventNumber - b.eventNumber);
      const durations = evts.map(x => x.duration);
      const total = durations.reduce((a, b) => a + b, 0);
      const worn = 1440 - total;
      const status = R.classifyDay(evts).status;
      evts.forEach((e, i) => {
        lines.push([d, e.tray, e.eventNumber, e.duration, total, worn, evts.length, status].join(','));
      });
    }
    return lines.join('\n');
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.events)) {
      throw new Error('Invalid file: missing events[]');
    }
    state = emptyState();
    state.events = parsed.events.map(e => ({
      id: e.id || newId(),
      date: e.date,
      tray: e.tray || 1,
      eventNumber: e.eventNumber || 1,
      duration: Math.floor(e.duration),
      startTs: e.startTs || null,
      endTs: e.endTs || null,
      createdTs: e.createdTs || Date.now(),
      editedTs: e.editedTs || null,
      editHistory: Array.isArray(e.editHistory) ? e.editHistory : [],
    }));
    if (parsed.settings) {
      state.settings = Object.assign(defaultSettings(), parsed.settings);
    }
    save(state);
    emit();
    return state;
  }

  /* ---- seed for first-run demo (only if completely empty + explicit) ---- */
  function seedDemo() {
    if (state.events.length > 0) return;
    const today = todayKey();
    addRemoval(today, 35);
  }

  /* ---- public API ---- */

  global.Store = {
    load, save,
    subscribe,
    todayKey,
    eventsForDate, allDatesSorted,
    addRemoval, undoLastRemoval, editRemoval, deleteRemoval,
    updateSettings, setTrayStartDate, clearAll,
    traySchedule, trayStartsKnown,
    exportJSON, exportCSV, importJSON,
    seedDemo,
    get state() { return state; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
