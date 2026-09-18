/* ============================================================
 * Invisalign Wear Tracker — Deterministic Rules Engine
 * ============================================================
 * Source of truth for classification, forecast, and next-removal
 * calculation. NO AI/LLM is used anywhere in this module.
 *
 * All inputs are arrays of { duration: <whole minutes> } events.
 * All outputs are pure data, recomputable from raw events.
 * ============================================================ */

(function (global) {
  'use strict';

  const MINUTES_IN_DAY = 1440;
  const WORN_MINIMUM = 1320; // 22 hours
  const GREEN_LIMIT = 30;     // ≤30 = no breach
  const AMBER_MIN = 36;       // 36–40 = amber
  const AMBER_MAX = 40;
  const RED_MIN = 41;         // 41–60 = red
  const RED_MAX = 60;
  const SHORT_EVENT_MAX = 10; // ≤10 min = qualifies for 5-removal grace

  const ZONE = Object.freeze({
    GREEN: 'GREEN',           // 0–30
    GREEN_BREACH: 'GREEN_BREACH', // 31–35
    AMBER: 'AMBER',           // 36–40
    RED: 'RED',               // 41–60
    EXTENDED: 'EXTENDED',     // >60
  });

  const STATUS = Object.freeze({
    NO_DATA: 'NO_DATA',
    IN_PROGRESS: 'IN_PROGRESS',
    PERFECT: 'PERFECT',
    NEAR_PERFECT: 'NEAR_PERFECT',
    IMPERFECT: 'IMPERFECT',
    FAILURE: 'FAILURE',
  });

  /* ----------------------------------------------------------
   * Primitives
   * ---------------------------------------------------------- */

  function zoneOf(duration) {
    const d = Math.floor(duration);
    if (d > RED_MAX) return ZONE.EXTENDED;
    if (d >= RED_MIN) return ZONE.RED;
    if (d >= AMBER_MIN) return ZONE.AMBER;
    if (d > GREEN_LIMIT) return ZONE.GREEN_BREACH;
    return ZONE.GREEN;
  }

  function breachExcess(duration) {
    return Math.max(0, Math.floor(duration) - GREEN_LIMIT);
  }

  function totalRemovalMinutes(events) {
    if (!events || events.length === 0) return 0;
    let sum = 0;
    for (const e of events) sum += Math.floor(e.duration);
    return sum;
  }

  function wornMinutes(events) {
    return MINUTES_IN_DAY - totalRemovalMinutes(events);
  }

  function isAmber(d) { const z = zoneOf(d); return z === ZONE.AMBER; }
  function isRed(d)   { const z = zoneOf(d); return z === ZONE.RED; }
  function isExtended(d) { return Math.floor(d) > RED_MAX; }
  function isAnyRed(d) { return isRed(d) || isExtended(d); }

  /* ----------------------------------------------------------
   * Daily classification (matches spec §10 exactly)
   * ---------------------------------------------------------- */

  function classifyDay(events) {
    if (!events || events.length === 0) {
      return { status: STATUS.NO_DATA, reason: null };
    }

    const durations = events.map(e => Math.floor(e.duration));
    const total = totalRemovalMinutes(events);
    const worn = wornMinutes(events);
    const count = durations.length;
    const amberCount = durations.filter(isAmber).length;
    const shortCount = durations.filter(d => d <= SHORT_EVENT_MAX).length;

    // ---- FAILURE conditions (any one triggers Failure) ----

    // 1. Worn time < 22h
    if (worn < WORN_MINIMUM) {
      return {
        status: STATUS.FAILURE,
        reason: wornTimeReason(worn, total),
      };
    }

    // 2. Any 41–60 removal
    if (durations.some(isRed)) {
      const idx = durations.findIndex(isRed);
      return {
        status: STATUS.FAILURE,
        reason: `Reason: ${durations[idx]} min removal.`,
      };
    }

    // 3. Any >60 removal (extended)
    if (durations.some(isExtended)) {
      const idx = durations.findIndex(isExtended);
      return {
        status: STATUS.FAILURE,
        reason: `Reason: ${durations[idx]} min removal.`,
      };
    }

    // 4. >5 removals
    if (count > 5) {
      return {
        status: STATUS.FAILURE,
        reason: `Reason: ${count} removals.`,
      };
    }

    // 5. Exactly 5 removals and none is ≤10 minutes
    if (count === 5 && shortCount === 0) {
      return {
        status: STATUS.FAILURE,
        reason: `Reason: five removals without a ≤10-minute event.`,
      };
    }

    // 6. 3 or more amber removals
    if (amberCount >= 3) {
      return {
        status: STATUS.FAILURE,
        reason: `Reason: third amber removal.`,
      };
    }

    // ---- From here on, worn ≥ 22h, no failure condition ----

    // ---- PERFECT ----
    // worn ≥22h AND no amber/red AND
    //   (1–3 removals: ≤2 green-zone breaches)
    //   (4 removals:   ≤1 green-zone breach)
    //   (5 removals:   not Perfect by rule)
    const greenBreachCount = durations.filter(d => d > GREEN_LIMIT && d < AMBER_MIN).length;

    if (count <= 3 && greenBreachCount <= 2 && amberCount === 0) {
      return { status: STATUS.PERFECT, reason: null };
    }
    if (count === 4 && greenBreachCount <= 1 && amberCount === 0) {
      return { status: STATUS.PERFECT, reason: null };
    }

    // ---- NEAR PERFECT ----
    // worn ≥22h, no failure, not Perfect.
    // Examples in spec:
    //   - one or two amber removals
    //   - 1–3 removals with 3 green breaches (but spec caps green breaches at 2 in 1–3 case for Perfect; so 3 green breaches here is Near Perfect)
    //   - exactly 5 removals with at least one ≤10-minute event
    if (count === 5 && shortCount >= 1) {
      return { status: STATUS.NEAR_PERFECT, reason: null };
    }
    if (amberCount >= 1 && amberCount <= 2) {
      return { status: STATUS.NEAR_PERFECT, reason: null };
    }
    if (count <= 3 && greenBreachCount >= 3) {
      return { status: STATUS.NEAR_PERFECT, reason: null };
    }
    // 4 removals with ≥2 green breaches (but < amber count threshold) is Near Perfect
    if (count === 4 && greenBreachCount >= 2) {
      return { status: STATUS.NEAR_PERFECT, reason: null };
    }

    // ---- IMPERFECT ----
    // worn ≥22h, no failure, not Perfect, not Near Perfect.
    return { status: STATUS.IMPERFECT, reason: null };
  }

  function wornTimeReason(worn, total) {
    const overOrUnder = worn < WORN_MINIMUM ? 'below' : 'exactly';
    return `Reason: worn time is ${overOrUnder} 22h.`;
  }

  /* ----------------------------------------------------------
   * Forecast — what the day would classify as if it ended now
   * (i.e., no further removals are added)
   * ---------------------------------------------------------- */

  function forecast(events) {
    return classifyDay(events).status;
  }

  /* ----------------------------------------------------------
   * "Why is Perfect no longer possible?" — earliest reason.
   * Returns null if Perfect still possible; otherwise a short string.
   * ---------------------------------------------------------- */

  function perfectBlockedReason(events) {
    if (!events || events.length === 0) return null;
    const durations = events.map(e => Math.floor(e.duration));
    const count = durations.length;
    const amberCount = durations.filter(isAmber).length;
    const greenBreachCount = durations.filter(d => d > GREEN_LIMIT && d < AMBER_MIN).length;
    const redIdx = durations.findIndex(isAnyRed);

    if (redIdx >= 0) {
      return `Reason: ${durations[redIdx]} min removal.`;
    }
    if (amberCount >= 1) {
      const idx = durations.findIndex(isAmber);
      return `Reason: ${durations[idx]} min removal.`;
    }
    if (count === 5) {
      return `Reason: five removals.`;
    }
    if (count === 4 && greenBreachCount >= 2) {
      return `Reason: 4 removals with 2 green-zone breaches.`;
    }
    if (count <= 3 && greenBreachCount >= 3) {
      return `Reason: ${greenBreachCount} green-zone breaches.`;
    }
    return null;
  }

  /* ----------------------------------------------------------
   * Next-removal max for a target outcome.
   *
   * target ∈ {'perfect','near-perfect','avoid-failure'}
   *
   * Returns the largest d (whole minutes, 0..120) such that adding
   * one removal of duration d would still leave the day capable of
   * the target outcome IF NO FURTHER REMOVALS OCCUR.
   * (Future removal reservations are surfaced separately as
   *  "if you need X more removals".)
   *
   * If the target is already unachievable for any next removal,
   * returns 0.
   * ---------------------------------------------------------- */

  function maxNextRemoval(events, target) {
    const base = events || [];
    const baseTotal = totalRemovalMinutes(base);

    // Binary search for largest d in [0, 120] such that
    // adding [d] still permits target (assuming no further removals).
    let lo = 0, hi = 120, best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const trial = base.concat([{ duration: mid }]);
      if (targetStillPossible(trial, target)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function targetStillPossible(events, target) {
    if (target === 'avoid-failure') {
      return classifyDay(events).status !== STATUS.FAILURE;
    }
    if (target === 'near-perfect') {
      const s = classifyDay(events).status;
      return s === STATUS.PERFECT || s === STATUS.NEAR_PERFECT;
    }
    if (target === 'perfect') {
      return classifyDay(events).status === STATUS.PERFECT;
    }
    return false;
  }

  /* ----------------------------------------------------------
   * Multi-removal planning.
   *
   * Given "I still need N more removals AFTER the one I'm about to
   * log", what is the largest uniform duration X such that adding
   * [X] (the removal I'm about to log) AND then N more removals
   * each of duration X still keeps the day on target?
   *
   * Returns { feasible, perRemoval, reason }.
   *
   * This is the "conservative feasible plan" mentioned in spec §14.
   * Per-removal max is uniform: if even X-uniform works, then any
   * non-uniform allocation ≤ X is also safe.
   * ---------------------------------------------------------- */

  function planRemaining(events, target, futureRemovals) {
    // futureRemovals = total number of removals that will still be
    // logged from now on (i.e. including the very next one).
    // The plan assigns each a uniform duration X. We find the
    // largest X such that the day still achieves target.
    const base = events || [];
    const N = Math.max(0, Math.floor(futureRemovals || 0));

    let lo = 0, hi = 120, best = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const trial = base.slice();
      for (let i = 0; i < N; i++) trial.push({ duration: mid });
      if (targetStillPossible(trial, target)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) {
      return { feasible: false, perRemoval: 0, reason: 'Target not achievable with that many future removals.' };
    }
    return { feasible: true, perRemoval: best, reason: null };
  }

  /* ----------------------------------------------------------
   * Daily summary (used by Today, History, Detail screens)
   * ---------------------------------------------------------- */

  function dailySummary(events) {
    const durations = (events || []).map(e => Math.floor(e.duration));
    const total = durations.reduce((a, b) => a + b, 0);
    const worn = MINUTES_IN_DAY - total;
    const longest = durations.length ? Math.max(...durations) : 0;
    const breaches = durations.filter(d => d > GREEN_LIMIT).length;
    const classification = classifyDay(events);

    return {
      total,
      worn,
      longest,
      breaches,
      count: durations.length,
      zones: durations.map(zoneOf),
      status: classification.status,
      reason: classification.reason,
      inProgress: classification.status === STATUS.IN_PROGRESS,
      noData: classification.status === STATUS.NO_DATA,
    };
  }

  /* ----------------------------------------------------------
   * Streaks (Perfect and non-failure)
   * ---------------------------------------------------------- */

  function computeStreaks(dayStatuses) {
    // dayStatuses is an ordered list (oldest → newest) of statuses
    // (NO_DATA and IN_PROGRESS are skipped per spec).
    let currentPerfect = 0, longestPerfect = 0;
    let currentNonFailure = 0, longestNonFailure = 0;

    for (const s of dayStatuses) {
      if (s === STATUS.PERFECT) {
        currentPerfect += 1;
        if (currentPerfect > longestPerfect) longestPerfect = currentPerfect;
      } else {
        currentPerfect = 0;
      }

      if (s === STATUS.PERFECT || s === STATUS.NEAR_PERFECT || s === STATUS.IMPERFECT) {
        currentNonFailure += 1;
        if (currentNonFailure > longestNonFailure) longestNonFailure = currentNonFailure;
      } else if (s === STATUS.FAILURE) {
        currentNonFailure = 0;
      }
      // NO_DATA and IN_PROGRESS break neither streak (per spec they don't count)
    }
    return { currentPerfect, longestPerfect, currentNonFailure, longestNonFailure };
  }

  /* ----------------------------------------------------------
   * Aggregations
   * ---------------------------------------------------------- */

  function aggregate(days) {
    // days = [{ date, events: [...] }, ...]
    const out = {
      totalDays: days.length,
      completed: 0,
      inProgress: 0,
      noData: 0,
      perfect: 0,
      nearPerfect: 0,
      imperfect: 0,
      failure: 0,
      totalEvents: 0,
      totalRemovalMinutes: 0,
      totalWornMinutes: 0,
      totalBreaches: 0,
      totalExcess: 0,
      greenBreachCount: 0,
      amberCount: 0,
      redCount: 0,
      extendedCount: 0,
      longestRemoval: 0,
      averageRemovalDuration: 0,
    };
    let totalRemovalForAvg = 0;
    for (const d of days) {
      const events = d.events || [];
      const cls = classifyDay(events);
      const summary = dailySummary(events);
      out.totalEvents += events.length;
      out.totalRemovalMinutes += summary.total;
      out.totalWornMinutes += summary.worn;
      if (cls.status === STATUS.NO_DATA) out.noData += 1;
      else if (cls.status === STATUS.IN_PROGRESS) out.inProgress += 1;
      else out.completed += 1;

      switch (cls.status) {
        case STATUS.PERFECT: out.perfect += 1; break;
        case STATUS.NEAR_PERFECT: out.nearPerfect += 1; break;
        case STATUS.IMPERFECT: out.imperfect += 1; break;
        case STATUS.FAILURE: out.failure += 1; break;
      }

      for (const e of events) {
        const dur = Math.floor(e.duration);
        const z = zoneOf(dur);
        const breach = dur > GREEN_LIMIT;
        if (breach) {
          out.totalBreaches += 1;
          out.totalExcess += dur - GREEN_LIMIT;
        }
        if (z === ZONE.GREEN_BREACH) out.greenBreachCount += 1;
        else if (z === ZONE.AMBER) out.amberCount += 1;
        else if (z === ZONE.RED) out.redCount += 1;
        else if (z === ZONE.EXTENDED) out.extendedCount += 1;
        if (dur > out.longestRemoval) out.longestRemoval = dur;
        totalRemovalForAvg += dur;
      }
    }
    if (out.totalEvents > 0) {
      out.averageRemovalDuration = totalRemovalForAvg / out.totalEvents;
    }
    return out;
  }

  /* ----------------------------------------------------------
   * Display helpers (formatting)
   * ---------------------------------------------------------- */

  function formatHM(totalMinutes) {
    const m = Math.max(0, Math.floor(totalMinutes));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${String(mm).padStart(2, '0')}m`;
  }

  function formatMinutesShort(totalMinutes) {
    const m = Math.max(0, Math.floor(totalMinutes));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return `${mm}m`;
    if (mm === 0) return `${h}h`;
    return `${h}h ${mm}m`;
  }

  /* ----------------------------------------------------------
   * Public API
   * ---------------------------------------------------------- */

  global.Rules = {
    MINUTES_IN_DAY,
    WORN_MINIMUM,
    GREEN_LIMIT,
    AMBER_MIN, AMBER_MAX, RED_MIN, RED_MAX,
    SHORT_EVENT_MAX,
    ZONE, STATUS,
    zoneOf,
    breachExcess,
    totalRemovalMinutes,
    wornMinutes,
    classifyDay,
    forecast,
    perfectBlockedReason,
    maxNextRemoval,
    planRemaining,
    dailySummary,
    computeStreaks,
    aggregate,
    formatHM,
    formatMinutesShort,
  };
})(typeof window !== 'undefined' ? window : globalThis);
