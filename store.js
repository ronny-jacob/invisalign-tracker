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
      return parsed;
    } catch (err) {
      console.warn('Store: failed to load, starting fresh', err);
      return emptyState();
    }
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

  function addRemoval(date, duration) {
    duration = Math.floor(duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid input. Enter a whole number of minutes.');
    }
    const existing = eventsForDate(date);
    const event = {
      id: newId(),
      date,
      tray: state.settings.currentTray,
      eventNumber: existing.length + 1,
      duration,
      startTs: null,
      endTs: null,
      createdTs: Date.now(),
      editedTs: null,
      editHistory: [],
    };
    state.events.push(event);
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
    save(state);
    emit();
  }

  function clearAll() {
    state = emptyState();
    save(state);
    emit();
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
    updateSettings, clearAll,
    exportJSON, exportCSV, importJSON,
    seedDemo,
    get state() { return state; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
