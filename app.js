/* ============================================================
 * Invisalign Wear Tracker — Main App
 *
 * Responsibilities:
 *  - Routing between screens
 *  - Rendering Today, History, Day Detail, Tray, Insights, Settings
 *  - Sheet/modal management
 *  - Wiring Store + Rules together
 *
 * No derived state is cached at the screen level. Every render
 * pulls fresh from the Store (which holds raw events).
 * ============================================================ */

(function () {
  'use strict';

  const R = window.Rules;
  const Store = window.Store;

  /* ============================================================
   * Utilities
   * ============================================================ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'dataset') {
          for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
        } else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'html') {
          node.innerHTML = v;
        } else if (v != null) {
          node.setAttribute(k, v);
        }
      }
    }
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function formatDayLong(dateKey) {
    // dateKey is 'YYYY-MM-DD'
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDayShort(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function formatDayDay(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }

  // -- Time formatting --
  // Uses the user's configured timezone, but the device's locale for
  // 12h vs 24h preference.

  function _tzFormatter() {
    const tz = (Store.state.settings && Store.state.settings.timezone) || undefined;
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: undefined,
    });
  }

  function formatClock(ts) {
    if (!ts) return '';
    try {
      return _tzFormatter().format(new Date(ts));
    } catch (e) {
      return new Date(ts).toLocaleTimeString();
    }
  }

  function formatRange(startTs, endTs) {
    if (!startTs && !endTs) return '';
    const s = formatClock(startTs);
    const e = formatClock(endTs);
    if (s && e) return `${s}–${e}`;
    return s || e;
  }

  function formatRelative(ts, now) {
    if (!ts) return '';
    const t = (typeof now === 'number') ? now : Date.now();
    const diff = t - ts;
    if (diff < 0) return 'just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return formatClock(ts);
  }

  function showToast(message, actionLabel, onAction) {
    const t = $('#toast');
    t.innerHTML = '';
    t.appendChild(document.createTextNode(message));
    if (actionLabel && typeof onAction === 'function') {
      const btn = el('button', { class: 'toast__undo', type: 'button' }, actionLabel);
      btn.addEventListener('click', () => {
        onAction();
        dismissToast();
      });
      t.appendChild(btn);
    }
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(dismissToast, 6000);
  }
  function dismissToast() {
    const t = $('#toast');
    if (t) t.hidden = true;
  }

  /* ============================================================
   * Routing
   * ============================================================ */

  const SCREENS = ['today', 'history', 'tray', 'insights', 'settings', 'day'];

  let currentScreen = 'today';
  let currentDayKey = null;

  function go(screen, params) {
    currentScreen = screen;
    if (params && params.dayKey) currentDayKey = params.dayKey;
    if (screen !== 'day') currentDayKey = null;

    $$('.screen').forEach(s => s.classList.remove('screen--active'));
    const target = $('#screen-' + screen);
    if (target) target.classList.add('screen--active');

    $$('.tab').forEach(t => {
      const isActive = t.dataset.screen === screen;
      t.classList.toggle('tab--active', isActive);
      t.setAttribute('aria-selected', String(isActive));
    });

    // Always render the target screen.
    if (screen === 'today') renderToday();
    if (screen === 'history') renderHistory();
    if (screen === 'tray') renderTray();
    if (screen === 'insights') renderInsights();
    if (screen === 'settings') renderSettings();
    if (screen === 'day') renderDay();
    if (screen === 'rules') renderRulesScreen();

    // The global tray pill is meaningless (and confusing) on the
    // day-detail screen, since the day may belong to a different tray
    // than the user's current one.
    const pill = $('#trayPill');
    if (pill) pill.hidden = (screen === 'day' || screen === 'rules');

    // Scroll to top on screen change.
    try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { /* jsdom */ }
  }

  /* ============================================================
   * Today
   * ============================================================ */

  // ----------------------------------------------------------
  // Status helper: applies the softening rule (one-off 41–60 min
  // → Imperfect) so every screen shows the same status.
  // ----------------------------------------------------------
  function statusForDay(events, dayKey) {
    const history = Store.historyEventsExcludingToday(dayKey, 7);
    return R.classifyDayWithSoftening(events, history, dayKey);
  }

  function renderToday() {
    // Header pill
    const s = Store.state.settings;
    $('#trayNum').textContent = String(s.currentTray);
    $('#trayTotal').textContent = String(s.totalTrays);

    const today = Store.todayKey();
    const events = Store.eventsForDate(today);
    const summary = R.dailySummary(events);
    const forecast = statusForDay(events, today).status;

    // 3-cell grid
    const grid = $('#todayGrid');
    grid.innerHTML = '';
    grid.appendChild(buildStat('WORN', R.formatMinutesShort(summary.worn)));
    grid.appendChild(buildStat('OUT', `${summary.total}m`));
    const lastEventTs = events.length
      ? events.reduce((a, b) => (b.createdTs > a.createdTs ? b : a)).createdTs
      : null;
    grid.appendChild(buildStat(
      'REMOVALS', String(summary.count),
      lastEventTs
        ? [el('span', { class: 'today-grid__hint' }, `last at ${formatClock(lastEventTs)}`)]
        : null,
    ));

    // Timer card + Start Timer button visibility
    const timer = Store.getTimer();
    if (timer.running) {
      renderTimerCard();
      startTimerTick();
    } else {
      $('#timerCard').hidden = true;
      stopTimerTick();
    }
    $('#startTimerBtn').hidden = timer.running;

    // Forecast card
    const fc = $('#forecastCard');
    fc.innerHTML = '';
    fc.dataset.tone = toneForStatus(forecast);

    if (summary.count === 0) {
      fc.appendChild(el('div', { class: 'forecast-card__head' }, 'STATUS'));
      fc.appendChild(el('div', { class: 'forecast-card__status' }, 'No removals yet'));
      fc.appendChild(el('div', { class: 'forecast-card__sub' }, 'Add your first removal to begin tracking the day.'));
    } else if (forecast === R.STATUS.FAILURE) {
      // Failure is locked in — spec §17
      fc.appendChild(el('div', { class: 'forecast-card__head' }, 'IF YOU STOP NOW'));
      fc.appendChild(el('div', { class: 'forecast-card__status' }, 'FAILURE IS LOCKED IN'));
      if (summary.reason) {
        fc.appendChild(el('div', { class: 'forecast-card__sub' }, summary.reason));
      }
    } else {
      fc.appendChild(el('div', { class: 'forecast-card__head' }, 'IF YOU STOP NOW'));
      fc.appendChild(el('div', { class: 'forecast-card__status' }, forecastLabel(forecast)));
      fc.appendChild(el('div', { class: 'forecast-card__sub' }, outcomeSubtext(forecast)));

      const why = R.perfectBlockedReason(events);
      if (forecast !== R.STATUS.PERFECT && why) {
        fc.appendChild(el('div', { class: 'forecast-card__why' }, why));
      }
    }

    // Next-removal card
    const nr = $('#nextRemovalCard');
    nr.innerHTML = '';
    const mr = $('#multiRemovalCard');
    mr.innerHTML = '';
    mr.hidden = true;

    if (summary.count === 0) {
      // Empty day: render the same capacity-list view as if the day
      // had events. pickTarget falls back to forecast, which is
      // NO_DATA, so target falls back to 'perfect' as the best
      // still-achievable outcome.
      renderNextRemoval(nr, mr, events, R.STATUS.PERFECT);
    } else {
      renderNextRemoval(nr, mr, events, forecast);
    }
  }

  function toneForStatus(status) {
    switch (status) {
      case R.STATUS.PERFECT:      return 'perfect';
      case R.STATUS.NEAR_PERFECT: return 'near';
      case R.STATUS.IMPERFECT:    return 'imperfect';
      case R.STATUS.FAILURE:      return 'failure';
      case R.STATUS.NO_DATA:      return 'nodata';
      default:                    return 'progress';
    }
  }
  function forecastLabel(status) {
    switch (status) {
      case R.STATUS.PERFECT:      return 'Perfect';
      case R.STATUS.NEAR_PERFECT: return 'Near Perfect';
      case R.STATUS.IMPERFECT:    return 'Imperfect';
      case R.STATUS.FAILURE:      return 'Failure';
      case R.STATUS.NO_DATA:      return 'No data';
      default:                    return 'In progress';
    }
  }

  function buildStat(label, value, extras) {
    return el('div', { class: 'today-grid__cell' }, [
      el('div', { class: 'today-grid__label' }, label),
      el('div', { class: 'today-grid__value' }, value),
      ...(extras || []),
    ]);
  }

  function renderNextRemoval(card, multiCard, events, softenedForecast) {
    const target = pickTarget(events, softenedForecast);
    const max = R.maxNextRemoval(events, target);
    const tone = toneForStatus(softenedForecast);
    card.dataset.tone = tone;
    card.innerHTML = '';

    card.appendChild(el('div', { class: 'next-removal-card__head' }, 'NEXT REMOVAL'));

    // Build the per-count capacity list (1 more, 2 more, 3 more, …).
    // Each row says "N more removal{s}: X MIN each" — the largest
    // uniform duration that lets N more removals still hit the target.
    const remainingSlots = remainingRemovalSlots(events, target);
    const plans = [];
    for (let n = 1; n <= remainingSlots; n++) {
      const p = R.planRemaining(events, target, n);
      if (p.feasible && p.perRemoval > 0) plans.push({ count: n, per: p.perRemoval });
    }

    const list = el('div', { class: 'next-removal-card__list' });

    if (softenedForecast === R.STATUS.FAILURE) {
      // Failure is locked in — show only the failure copy. No list.
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--failure',
      }, [
        el('span', { class: 'next-removal-card__row-text' },
          'Failure is locked in.'),
      ]));
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--failure',
      }, [
        el('span', { class: 'next-removal-card__row-sub' },
          'More removals won\'t change today.'),
      ]));
    } else if (remainingSlots === 0) {
      // At cap for target.
      const targetLabel = target === 'perfect' ? 'Perfect' :
                         target === 'near-perfect' ? 'Near Perfect' : 'this';
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--neutral',
      }, [
        el('span', { class: 'next-removal-card__row-text' },
          'No more removals today.'),
      ]));
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--neutral',
      }, [
        el('span', { class: 'next-removal-card__row-sub' },
          `${targetLabel} caps at ${target === 'perfect' ? 4 : 5} removals.`),
      ]));
    } else if (plans.length === 0) {
      // Today's events block any further removal that hits the
      // chosen target (e.g. one 41-min + target near-perfect: any
      // further 41-min would tip into ≥ 2 ambers or another red).
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--neutral',
      }, [
        el('span', { class: 'next-removal-card__row-text' },
          'No safe next removal.'),
      ]));
      list.appendChild(el('div', {
        class: 'next-removal-card__row next-removal-card__row--neutral',
      }, [
        el('span', { class: 'next-removal-card__row-sub' },
          'Today\'s events already meet the cap for the current best target.'),
      ]));
    } else {
      // Per-count capacity list.
      for (const p of plans) {
        const unitSuffix = p.count === 1 ? ' MIN' : ' MIN EACH';
        const row = el('div', { class: 'next-removal-card__row' }, [
          el('span', { class: 'next-removal-card__row-count' },
            `${p.count} more ${pluralize(p.count, 'removal', 'removals')}`),
          el('span', { class: 'next-removal-card__row-max' }, [
            `${p.per} `,
            el('span', { class: 'next-removal-card__unit' }, unitSuffix),
          ]),
        ]);
        list.appendChild(row);
      }
    }
    card.appendChild(list);

    // TOTAL LEFT — only when day still has room (and not Failure).
    const allowed = R.MINUTES_IN_DAY - R.WORN_MINIMUM; // 120
    const total = R.totalRemovalMinutes(events);
    const left = Math.max(0, allowed - total);
    if (left > 0 && softenedForecast !== R.STATUS.FAILURE) {
      const totalSec = el('div', { class: 'next-removal-card__totalbox' });
      totalSec.appendChild(el('div', { class: 'next-removal-card__total' }, [
        `${left} `, el('span', { class: 'next-removal-card__unit' }, 'MIN LEFT')
      ]));
      totalSec.appendChild(el('div', { class: 'next-removal-card__sub' },
        `before 22h · max single removal ${max} MIN`));
      card.appendChild(totalSec);
    }

    // The separate multi-removal card is no longer used — its content
    // is now inlined above. Caller still passes `multiCard` for
    // back-compat; we just hide it.
    if (multiCard) {
      multiCard.hidden = true;
      multiCard.innerHTML = '';
    }
  }

  function pickTarget(events, softenedStatus) {
    // The displayed guidance should target the BEST STILL-ACHIEVABLE
    // outcome. Once the day has crossed out of Perfect possibility
    // (e.g., 2 amber removals, 5 removals, etc.), we still want to
    // give useful next-removal advice — targeting Perfect would lock
    // the answer at 0, which is unhelpful and contradicts spec §14.
    // softenedStatus is the failure-softening-aware forecast; if
    // omitted, the spec-strict forecast is used.
    const forecast = softenedStatus != null
      ? softenedStatus
      : R.forecast(events);
    if (forecast === R.STATUS.FAILURE) return 'avoid-failure';
    if (forecast === R.STATUS.IMPERFECT) return 'near-perfect';
    if (forecast === R.STATUS.NEAR_PERFECT) {
      // Perfect is no longer achievable; the next-best achievable is
      // Near Perfect (or Avoid Failure if even that is gone).
      if (R.maxNextRemoval(events, 'near-perfect') > 0) return 'near-perfect';
      return 'avoid-failure';
    }
    // PERFECT forecast → keep targeting Perfect.
    return 'perfect';
  }

  function statusSubtext(forecast, target) {
    if (forecast === R.STATUS.FAILURE) {
      return 'Failure is locked in.';
    }
    if (forecast === R.STATUS.PERFECT) return 'Perfect is still possible.';
    if (forecast === R.STATUS.NEAR_PERFECT) return 'Near Perfect is still possible.';
    if (forecast === R.STATUS.IMPERFECT) return 'No longer Perfect or Near Perfect, but day is not a Failure.';
    return '';
  }

  function outcomeSubtext(forecast) {
    // For the "Actual status: X" subtext per spec §15.
    if (forecast === R.STATUS.PERFECT)      return 'In progress · Perfect still possible';
    if (forecast === R.STATUS.NEAR_PERFECT) return 'In progress · Perfect no longer possible';
    if (forecast === R.STATUS.IMPERFECT)    return 'In progress · Not Perfect or Near Perfect';
    if (forecast === R.STATUS.FAILURE)      return 'Failure';
    return 'In progress';
  }

  function remainingRemovalSlots(events, target) {
    const n = events.length;
    if (target === 'perfect') return Math.max(0, 4 - n);
    if (target === 'near-perfect') return Math.max(0, 5 - n);
    return Math.max(0, 5 - n);
  }

  /* ============================================================
   * History
   * ============================================================ */

  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';

    const dates = Store.allDatesSorted().reverse();
    if (dates.length === 0) {
      list.appendChild(buildEmpty('No history yet', 'Days with removals will appear here.'));
      return;
    }
    for (const d of dates) {
      const events = Store.eventsForDate(d);
      const summary = R.dailySummary(events);
      // Apply softening-aware classification (one-off 41–60 min → Imperfect).
      const softened = statusForDay(events, d);
      summary.status = softened.status;
      summary.reason = softened.reason;
      const last = events.length
        ? events.reduce((a, b) => (b.createdTs > a.createdTs ? b : a))
        : null;
      const subParts = [
        `${summary.count} ${pluralize(summary.count, 'removal', 'removals')}`,
        ' · ',
        `${R.formatMinutesShort(summary.worn)} worn`,
      ];
      if (last) subParts.push(' · ', `last at ${formatClock(last.createdTs)}`);
      const row = el('button', { class: 'history-row', type: 'button' }, [
        el('div', null, [
          el('div', { class: 'history-row__date' }, formatDayLong(d)),
          el('div', { class: 'history-row__sub' }, subParts),
        ]),
        el('div', { class: 'history-row__badge', dataset: { status: summary.status } }, badgeText(summary.status)),
        el('div', { class: 'history-row__chev', 'aria-hidden': 'true' }, '›'),
      ]);
      row.addEventListener('click', () => go('day', { dayKey: d }));
      list.appendChild(row);
    }
  }

  function badgeText(status) {
    switch (status) {
      case R.STATUS.PERFECT:      return 'Perfect';
      case R.STATUS.NEAR_PERFECT: return 'Near Perfect';
      case R.STATUS.IMPERFECT:    return 'Imperfect';
      case R.STATUS.FAILURE:      return 'Failure';
      case R.STATUS.IN_PROGRESS:  return 'In Progress';
      case R.STATUS.NO_DATA:      return 'No Data';
      default:                    return status;
    }
  }

  function buildEmpty(title, subtitle) {
    return el('div', { class: 'empty-block' }, [
      el('div', { class: 'empty-block__title' }, title),
      el('div', null, subtitle),
    ]);
  }

  function pluralize(n, one, many) { return n === 1 ? one : many; }

  /* ============================================================
   * Day Detail
   * ============================================================ */

  function renderDay() {
    const root = $('#dayContent');
    root.innerHTML = '';
    if (!currentDayKey) {
      root.appendChild(buildEmpty('No day selected', 'Pick a day from History.'));
      return;
    }
    const dayKey = currentDayKey;
    const events = Store.eventsForDate(dayKey);
    const summary = R.dailySummary(events);
    // Apply softening-aware classification (one-off 41–60 min → Imperfect).
    const softened = statusForDay(events, dayKey);
    // Update `summary.status` and `summary.reason` in place so all
    // downstream UI in this view uses the softened values.
    summary.status = softened.status;
    summary.reason = softened.reason;

    // Determine which tray(s) this day's events were logged under.
    // If all events share the same tray, show it. If mixed (e.g., the
    // user backdated some events after switching trays), say "Mixed".
    const trayCounts = {};
    for (const e of events) {
      const t = e.tray;
      trayCounts[t] = (trayCounts[t] || 0) + 1;
    }
    const trayKeys = Object.keys(trayCounts);
    let trayLabel = null;
    if (trayKeys.length === 1) trayLabel = `Tray ${trayKeys[0]}`;
    else if (trayKeys.length > 1) trayLabel = `Tray ${trayKeys.sort((a, b) => a - b).join(' + ')}`;
    const isPastTray = trayKeys.length === 1
      && Number(trayKeys[0]) !== Store.state.settings.currentTray;

    const head = el('div', { class: 'day-header' }, [
      el('div', { class: 'day-header__top' }, [
        el('div', { class: 'day-header__date' }, formatDayLong(dayKey)),
        trayLabel ? el('span', {
          class: 'day-header__tray',
          dataset: { state: isPastTray ? 'past' : 'current' },
        }, trayLabel) : null,
      ]),
      el('div', { class: 'day-header__status', dataset: { status: summary.status } },
        badgeText(summary.status)),
      summary.reason ? el('div', { class: 'day-header__reason' }, summary.reason) : null,
      el('div', { class: 'day-header__metrics' }, [
        el('div', { class: 'day-header__metric' }, [
          el('div', { class: 'day-header__metric-label' }, 'Worn'),
          el('div', { class: 'day-header__metric-value' }, R.formatMinutesShort(summary.worn)),
        ]),
        el('div', { class: 'day-header__metric' }, [
          el('div', { class: 'day-header__metric-label' }, 'Out'),
          el('div', { class: 'day-header__metric-value' }, `${summary.total}m`),
        ]),
        el('div', { class: 'day-header__metric' }, [
          el('div', { class: 'day-header__metric-label' }, 'Removals'),
          el('div', { class: 'day-header__metric-value' }, String(summary.count)),
        ]),
      ]),
      el('div', { class: 'day-header__metrics' }, [
        el('div', { class: 'day-header__metric' }, [
          el('div', { class: 'day-header__metric-label' }, 'Longest'),
          el('div', { class: 'day-header__metric-value' }, summary.longest ? `${summary.longest}m` : '—'),
        ]),
        el('div', { class: 'day-header__metric' }, [
          el('div', { class: 'day-header__metric-label' }, 'Breaches'),
          el('div', { class: 'day-header__metric-value' }, String(summary.breaches)),
        ]),
      ]),
    ]);
    root.appendChild(head);

    if (events.length === 0) {
      root.appendChild(buildEmpty('No removals', 'This day has no removals logged.'));
      return;
    }

    const list = el('div', { class: 'event-list' }, [
      el('div', { class: 'event-list__title' }, 'Events'),
    ]);
    events.forEach((e, i) => {
      const zone = R.zoneOf(e.duration);
      const range = formatRange(e.startTs, e.endTs);
      const logged = formatRelative(e.createdTs);
      const edited = e.editedTs ? ` · edited ${formatRelative(e.editedTs)}` : '';
      const sub = range
        ? `${range} · logged ${logged}${edited}`
        : `logged ${logged}${edited}`;
      const row = el('div', { class: 'event-row' }, [
        el('span', { class: 'event-row__num' }, String(i + 1)),
        el('div', { class: 'event-row__main' }, [
          el('span', { class: 'event-row__zone', dataset: { zone } }, [
            el('span', { class: 'event-row__dot' }),
            zoneLabel(zone),
          ]),
          el('span', { class: 'event-row__sub' }, sub),
        ]),
        el('span', { class: 'event-row__dur' }, `${e.duration} min`),
        el('button', {
          class: 'event-row__edit',
          type: 'button',
          'aria-label': `Edit event ${i + 1}`,
        }, 'Edit'),
      ]);
      row.lastChild.addEventListener('click', () => openEditSheet(e));
      list.appendChild(row);
    });
    root.appendChild(list);
  }

  function zoneLabel(zone) {
    switch (zone) {
      case R.ZONE.GREEN:         return 'Green';
      case R.ZONE.GREEN_BREACH:  return 'Green (minor)';
      case R.ZONE.AMBER:         return 'Amber';
      case R.ZONE.RED:           return 'Red';
      case R.ZONE.EXTENDED:      return 'Extended';
      default:                   return zone;
    }
  }

  /* ============================================================
   * Tray
   * ============================================================ */

  function renderTray() {
    const s = Store.state.settings;
    const root = $('#trayContent');
    root.innerHTML = '';

    const sched = Store.traySchedule(s.currentTray);

    // Header card: big tray number + day-of-N progress
    const summaryCard = el('div', { class: 'tray-summary' }, [
      el('div', { class: 'tray-summary__label' }, 'Current Tray'),
      el('div', { class: 'tray-summary__num' }, String(s.currentTray)),
      el('div', { class: 'tray-summary__total' }, `of ${s.totalTrays}`),
    ]);
    if (sched.startDate) {
      const dayText = sched.isComplete
        ? `Day ${sched.durationDays} of ${sched.durationDays} · ready to switch`
        : sched.isOverdue
          ? `Day ${sched.daysElapsed} of ${sched.durationDays} · overdue by ${sched.daysElapsed - sched.durationDays} day${sched.daysElapsed - sched.durationDays === 1 ? '' : 's'}`
          : `Day ${Math.max(1, sched.daysElapsed + 1)} of ${sched.durationDays}`;
      summaryCard.appendChild(el('div', { class: 'tray-summary__day', 'data-state': sched.isOverdue ? 'overdue' : (sched.isComplete ? 'complete' : 'active') }, dayText));

      if (sched.isComplete) {
        summaryCard.appendChild(el('div', { class: 'tray-summary__hint', style: 'color: var(--amber);' },
          'Tray duration reached. Bump the current tray in Settings when you switch.'));
      } else if (sched.isOverdue) {
        summaryCard.appendChild(el('div', { class: 'tray-summary__hint' },
          `Was due to switch on ${formatDayShort(sched.expectedSwitchDate)}.`));
      } else {
        summaryCard.appendChild(el('div', { class: 'tray-summary__hint' }, [
          `Started ${formatDayShort(sched.startDate)}`,
          sched.daysRemaining === 1 ? ' · switch tomorrow' :
            sched.daysRemaining === 0 ? ' · switch today' :
              ` · switch in ${sched.daysRemaining} days`,
        ]));
      }

      // Progress bar
      const pct = Math.min(100, Math.round((sched.daysElapsed / sched.durationDays) * 100));
      const bar = el('div', { class: 'tray-progress' }, [
        el('div', { class: 'tray-progress__fill', style: `width:${pct}%`, 'data-state': sched.isOverdue ? 'overdue' : 'active' }),
      ]);
      summaryCard.appendChild(bar);
    } else {
      summaryCard.appendChild(el('div', { class: 'tray-summary__meta' },
        'No start date recorded for this tray.'));
    }
    summaryCard.appendChild(el('div', { class: 'tray-summary__meta' }, [
      `Tray 1: ${s.tray1Days} days · Tray 2: ${s.tray2Days} days · Onward: ${s.trayOnwardDays} days`,
    ]));
    root.appendChild(summaryCard);

    // Schedule editor hint
    const knownTrays = Store.trayStartsKnown();
    if (knownTrays.length > 0) {
      const list = el('div', { class: 'tray-history' }, [
        el('div', { class: 'tray-history__title' }, 'Tray Schedule'),
      ]);
      for (const t of knownTrays) {
        const ts = Store.traySchedule(t);
        const row = el('div', { class: 'tray-history__row' }, [
          el('span', { class: 'tray-history__num' }, `Tray ${t}`),
          el('span', { class: 'tray-history__date' }, formatDayShort(ts.startDate)),
          el('span', { class: 'tray-history__hint' },
            t === s.currentTray
              ? 'current'
              : ts.isComplete
                ? `done · ${ts.durationDays}d`
                : `day ${ts.daysElapsed + 1}/${ts.durationDays}`),
        ]);
        list.appendChild(row);
      }
      root.appendChild(list);
      root.appendChild(el('div', { class: 'settings-note' },
        'Edit individual tray start dates in Settings → Tray.'));
    }

    // Personal gate (opt-in). Hidden when disabled.
    if (s.gateEnabled && s.gateDate1 && s.gateDate2) {
      const gate = buildTray6Gate(s);
      root.appendChild(gate);
      root.appendChild(el('div', { class: 'settings-note' },
        'Personal gate dates are user-defined. They do not replace advice from your orthodontist. ' +
        'Enable or change them in Settings → Personal Gate.'));
    }
  }

  function buildTray6Gate(s) {
    const card = el('div', { class: 'tray-gate' }, [
      el('div', { class: 'tray-gate__title' }, s.gateName || 'Personal Gate'),
    ]);

    for (const d of [s.tray6GateDate1, s.tray6GateDate2]) {
      const events = Store.eventsForDate(d);
      const summary = R.dailySummary(events);
      const today = Store.todayKey();
      let state, label;
      if (events.length === 0) {
        if (d > today) { state = 'WAITING'; label = 'Waiting'; }
        else { state = 'NOT_MET'; label = 'Not Perfect'; }
      } else {
        // For past days, classify fully. For today, use actual.
        const cls = R.classifyDay(events);
        if (cls.status === R.STATUS.PERFECT) { state = 'PASSED'; label = 'Perfect'; }
        else { state = 'NOT_MET'; label = 'Not Perfect'; }
      }
      // In-progress day that could still become Perfect
      if (d === today && events.length > 0 && state !== 'PASSED') {
        const fc = R.forecast(events);
        if (fc === R.STATUS.PERFECT) {
          state = 'IN_PROGRESS'; label = 'On track';
        } else {
          state = 'NOT_MET'; label = 'Not Perfect';
        }
      }

      card.appendChild(el('div', { class: 'tray-gate__row' }, [
        el('span', { class: 'tray-gate__date' }, formatDayShort(d)),
        el('span', { class: 'tray-gate__status', dataset: { state } }, label),
      ]));
    }

    // Verdict
    const verdict = evaluateGate(s);
    card.appendChild(el('div', { class: 'tray-gate__verdict', dataset: { state: verdict.state } }, verdict.text));
    return card;
  }

  function evaluateGate(s) {
    const today = Store.todayKey();
    const days = [s.tray6GateDate1, s.tray6GateDate2];
    const states = days.map(d => {
      const events = Store.eventsForDate(d);
      if (events.length === 0) {
        return { day: d, status: d > today ? R.STATUS.NO_DATA : R.STATUS.FAILURE };
      }
      return { day: d, status: R.classifyDay(events).status };
    });

    const anyFailure = states.some(x => x.status !== R.STATUS.PERFECT && x.status !== R.STATUS.NO_DATA && x.status !== R.STATUS.IN_PROGRESS);
    const allPerfect = states.every(x => x.status === R.STATUS.PERFECT);
    const allDone = states.every(x => x.status !== R.STATUS.NO_DATA && x.status !== R.STATUS.IN_PROGRESS);

    if (allPerfect) return { state: 'PASSED', text: `Gate passed — both days Perfect. Tray 6 transition unlocks on ${formatDayShort(s.tray6Date)}.` };
    if (anyFailure && allDone) return { state: 'NOT_MET', text: 'Gate not met. Near Perfect does not qualify.' };
    return { state: 'WAITING', text: 'Gate waiting — keep tracking. Both days must reach Perfect.' };
  }

  /* ============================================================
   * Insights
   * ============================================================ */

  function renderInsights() {
    const root = $('#insightsContent');
    root.innerHTML = '';

    const dates = Store.allDatesSorted();
    if (dates.length === 0) {
      root.appendChild(buildEmpty('No insights yet', 'Insights will appear after a few days of tracking.'));
      return;
    }

    // Build a flat list of {date, status} for every tracked day,
    // oldest → newest. Status uses the softening-aware variant.
    const allDays = dates.map(d => ({
      date: d,
      status: statusForDay(Store.eventsForDate(d), d).status,
    }));
    const today = Store.todayKey();

    // 7-day card (only if we have at least one day)
    if (allDays.length > 0) {
      root.appendChild(buildInsightsCard('Last 7 days', allDays.slice(-7), today));
    }
    // 30-day card
    if (allDays.length > 0) {
      root.appendChild(buildInsightsCard('Last 30 days', allDays.slice(-30), today));
    }
    // All-time card
    if (allDays.length > 0) {
      root.appendChild(buildInsightsCard('All time', allDays, today));
    }
  }

  function buildInsightsCard(title, days, today) {
    const counts = countStatuses(days);
    const total = days.length;
    const dominant = dominantStatus(counts);
    const completedDays = days.filter(d => d.status !== R.STATUS.NO_DATA).length;
    const agg = R.aggregate(days.map(d => ({
      date: d.date, events: Store.eventsForDate(d.date),
    })));
    const streaks = R.computeStreaks(days.map(d => d.status));

    const card = el('div', { class: 'insights-card' });

    // Header
    const head = el('div', { class: 'insights-card__head' });
    head.appendChild(el('div', { class: 'insights-card__title' }, title));
    head.appendChild(el('div', { class: 'insights-card__hint' },
      `${total} day${total === 1 ? '' : 's'}`));
    card.appendChild(head);

    // Hero: big status count + label
    card.appendChild(buildInsightsHero(dominant, heroLabelForRange(title, dominant, counts, total)));

    // Stacked bar
    card.appendChild(buildInsightsBar(counts, total));

    // Legend
    card.appendChild(buildInsightsLegend(counts));

    // Dot grid for smaller ranges only (≤ 35 dots)
    if (days.length <= 35) {
      card.appendChild(buildInsightsDots(days, today));
    }

    // Streak
    card.appendChild(buildInsightsStreak(streaks));

    // Averages + totals only on the all-time card to avoid clutter
    if (title === 'All time' && completedDays > 0) {
      const avgWorn = Math.round(agg.totalWornMinutes / completedDays);
      const avgOut = Math.round(agg.totalRemovalMinutes / completedDays);
      card.appendChild(buildInsightsAverages(agg, completedDays, avgWorn, avgOut));
    }

    return card;
  }

  function countStatuses(days) {
    const c = { PERFECT: 0, NEAR_PERFECT: 0, IMPERFECT: 0, FAILURE: 0, NO_DATA: 0 };
    for (const d of days) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }
  function dominantStatus(counts) {
    const order = ['PERFECT', 'NEAR_PERFECT', 'IMPERFECT', 'FAILURE'];
    let best = { key: 'NO_DATA', count: 0 };
    for (const k of order) {
      if (counts[k] > best.count) best = { key: k, count: counts[k] };
    }
    return best;
  }
  function dominantToneClass(key) {
    return ({
      PERFECT: '',
      NEAR_PERFECT: 'insights-hero__big--near',
      IMPERFECT: 'insights-hero__big--imperfect',
      FAILURE: 'insights-hero__big--failure',
      NO_DATA: 'insights-hero__big--neutral',
    })[key] || '';
  }
  function heroLabelForRange(title, dominant, counts, total) {
    if (dominant.key === 'NO_DATA') {
      return el('div', null, [el('strong', null, 'No data'), ' — log a removal to begin.']);
    }
    const words = {
      PERFECT: 'Perfect days',
      NEAR_PERFECT: 'Near Perfect days',
      IMPERFECT: 'Imperfect days',
      FAILURE: 'Failure days',
    }[dominant.key];
    const extras = [];
    if (dominant.key === 'PERFECT' && counts.NEAR_PERFECT > 0) {
      extras.push(`${counts.NEAR_PERFECT} Near Perfect`);
    }
    if (counts.FAILURE > 0) {
      extras.push(`${counts.FAILURE} Failure`);
    }
    const suffix = extras.length ? ` (also ${extras.join(', ')})` : '';
    return el('div', null, [
      el('strong', null, words),
      ` of ${total} days tracked${suffix}`,
    ]);
  }
  function buildInsightsHero(dominant, label) {
    const wrap = el('div', { class: 'insights-hero' });
    const big = el('div', { class: 'insights-hero__big ' + dominantToneClass(dominant.key) },
      String(dominant.count));
    big.dataset.status = dominant.key;
    wrap.appendChild(big);
    wrap.appendChild(el('div', { class: 'insights-hero__label' }, label));
    return wrap;
  }
  function buildInsightsBar(counts, total) {
    const bar = el('div', { class: 'insights-bar' });
    if (total === 0) return bar;
    const flexFor = (n) => n === 0 ? 'flex:0.0001' : `flex:${n}`;
    bar.appendChild(el('div', { class: 'insights-bar__seg insights-bar__seg--perfect', style: flexFor(counts.PERFECT) }));
    bar.appendChild(el('div', { class: 'insights-bar__seg insights-bar__seg--near', style: flexFor(counts.NEAR_PERFECT) }));
    bar.appendChild(el('div', { class: 'insights-bar__seg insights-bar__seg--imperfect', style: flexFor(counts.IMPERFECT) }));
    bar.appendChild(el('div', { class: 'insights-bar__seg insights-bar__seg--failure', style: flexFor(counts.FAILURE) }));
    return bar;
  }
  function buildInsightsLegend(counts) {
    const wrap = el('div', { class: 'insights-legend' });
    const items = [
      ['perfect', 'Perfect', counts.PERFECT],
      ['near', 'Near Perfect', counts.NEAR_PERFECT],
      ['imperfect', 'Imperfect', counts.IMPERFECT],
      ['failure', 'Failure', counts.FAILURE],
    ];
    for (const [key, label, n] of items) {
      wrap.appendChild(el('span', { class: 'insights-legend__item' }, [
        el('span', { class: 'insights-legend__swatch insights-bar__seg--' + key }),
        el('span', null, label),
        el('span', { class: 'insights-legend__count' }, String(n)),
      ]));
    }
    return wrap;
  }
  function buildInsightsDots(days, today) {
    const grid = el('div', { class: 'insights-dots' });
    for (const d of days) {
      const dot = el('div', { class: 'insights-dot' });
      dot.dataset.status = d.status;
      if (d.date === today) dot.dataset.today = 'true';
      grid.appendChild(dot);
    }
    return grid;
  }
  function buildInsightsStreak(streaks) {
    const wrap = el('div', { class: 'insights-streak' });
    wrap.appendChild(el('div', { class: 'insights-streak__icon' }, '🔥'));
    const main = el('div', { class: 'insights-streak__main' });
    const numCls = streaks.currentPerfect > 0
      ? 'insights-streak__num'
      : 'insights-streak__num insights-streak__num--neutral';
    main.appendChild(el('span', { class: numCls }, String(streaks.currentPerfect)));
    main.appendChild(el('span', { class: 'insights-streak__label' },
      streaks.currentPerfect === 1 ? 'day Perfect streak' : 'day Perfect streak'));
    wrap.appendChild(main);
    wrap.appendChild(el('div', { class: 'insights-streak__best' }, `best ${streaks.longestPerfect}`));
    return wrap;
  }
  function buildInsightsAverages(agg, completedDays, avgWorn, avgOut) {
    const wrap = el('div', { class: 'insights-averages', style: 'margin-top: 18px;' });
    wrap.appendChild(avgCell('Avg worn', R.formatMinutesShort(avgWorn)));
    wrap.appendChild(avgCell('Avg out', `${avgOut}m`));
    wrap.appendChild(avgCell('Avg removals', completedDays > 0
      ? (agg.totalEvents / completedDays).toFixed(1)
      : '—'));
    wrap.appendChild(avgCell('Longest removal', agg.longestRemoval ? `${agg.longestRemoval}m` : '—'));
    return wrap;
  }
  function avgCell(label, value) {
    return el('div', { class: 'insights-avg' }, [
      el('div', { class: 'insights-avg__value' }, value),
      el('div', { class: 'insights-avg__label' }, label),
    ]);
  }

  /* ============================================================
   * Settings
   * ============================================================ */

  function renderSettings() {
    const s = Store.state.settings;
    const root = $('#settingsContent');
    root.innerHTML = '';

    // Appearance group
    root.appendChild(buildGroup('APPEARANCE', [
      rowSelect('Theme', s.theme, [
        { value: 'system', label: 'System' },
        { value: 'light',  label: 'Light' },
        { value: 'dark',   label: 'Dark' },
      ], v => { Store.updateSettings({ theme: v }); applyTheme(v); }),
    ]));

    // Tray group
    root.appendChild(buildGroup('TRAY', [
      rowSelect('Current Tray', String(s.currentTray), rangeOptions(1, s.totalTrays),
        v => Store.updateSettings({ currentTray: Number(v) })),
      rowNumber('Total Trays', s.totalTrays, v => Store.updateSettings({ totalTrays: Number(v) || 14 })),
      rowNumber('Tray 1 Days', s.tray1Days, v => Store.updateSettings({ tray1Days: Number(v) || 11 })),
      rowNumber('Tray 2 Days', s.tray2Days, v => Store.updateSettings({ tray2Days: Number(v) || 11 })),
      rowNumber('Onward Days', s.trayOnwardDays, v => Store.updateSettings({ trayOnwardDays: Number(v) || 10 })),
      rowDate('Intended Tray 6 Date', s.tray6Date, v => Store.updateSettings({ tray6Date: v })),
    ]));

    // Tray start dates editor
    const trayStartsRows = (Store.trayStartsKnown().length
      ? Store.trayStartsKnown().map(t => {
          const startDate = (s.trayStarts && s.trayStarts[String(t)]) || '';
          const node = rowDate(`Tray ${t} Started`, startDate, v => {
            try { Store.setTrayStartDate(t, v); }
            catch (e) { showToast(e.message); }
          });
          node.dataset.tray = String(t);
          return node;
        })
      : [el('div', { class: 'settings-row' }, [
          el('span', { class: 'settings-row__label' }, 'No tray start dates recorded yet'),
          el('span', { class: 'settings-row__value', style: 'font-weight:400;color:var(--fg-tertiary)' }, '—'),
        ])]
    );
    root.appendChild(buildGroup('TRAY START DATES',
      trayStartsRows,
      'When did you start each tray? Auto-inferred from the first logged event of each tray. Edit here if the inference is off (e.g. you switched trays but didn\'t log a removal that day).'));

    // Personal gate group (opt-in). Off by default; both dates are
    // user-defined and not medical advice.
    const gateToggleBtn = el('button', {
      class: 'settings-row__action' + (s.gateEnabled ? '' : ' settings-row__action--danger'),
      type: 'button',
    }, s.gateEnabled ? 'On' : 'Off');
    gateToggleBtn.addEventListener('click', () => {
      Store.updateSettings({ gateEnabled: !s.gateEnabled });
    });
    const gateRows = [
      el('div', { class: 'settings-row' }, [
        el('span', { class: 'settings-row__label' }, 'Enable Personal Gate'),
        gateToggleBtn,
      ]),
      rowDate('Gate Day 1', s.gateDate1 || '', v => Store.updateSettings({ gateDate1: v, tray6GateDate1: v })),
      rowDate('Gate Day 2', s.gateDate2 || '', v => Store.updateSettings({ gateDate2: v, tray6GateDate2: v })),
      rowStatic('Gate Name', s.gateName || 'Personal Gate'),
    ];
    root.appendChild(buildGroup('PERSONAL GATE', gateRows,
      'Optional. Some users (or orthodontists) want to require two specific days to both classify as Perfect before advancing to a new tray. Off by default. ' +
      'Both gate days must be Perfect; Near Perfect does not qualify.'));

    // Timezone group
    root.appendChild(buildGroup('TIMEZONE', [
      rowSelect('Timezone', s.timezone, [
        { value: 'Asia/Kolkata', label: 'IST (UTC+05:30)' },
        { value: 'Asia/Dubai', label: 'Gulf (UTC+04:00)' },
        { value: 'Europe/London', label: 'London' },
        { value: 'America/New_York', label: 'New York' },
        { value: 'America/Los_Angeles', label: 'Los Angeles' },
        { value: 'UTC', label: 'UTC' },
      ], v => Store.updateSettings({ timezone: v })),
    ]));

    // Data group
    root.appendChild(buildGroup('DATA', [
      rowAction('Export JSON', 'Export', () => download('invisalign-tracker.json', Store.exportJSON(), 'application/json')),
      rowAction('Export CSV', 'Export', () => download('invisalign-tracker.csv', Store.exportCSV(), 'text/csv')),
      rowAction('Import JSON', 'Choose…', () => $('#importInput').click()),
      rowAction('Delete All Data', 'Delete', () => confirmDanger(
        'Delete all data?',
        'This permanently removes all logged events, settings, and history. This cannot be undone.',
        () => { Store.clearAll(); go('today'); }
      ), 'danger'),
    ], 'Data is stored locally on this device only.'));

    root.appendChild(buildGroup('ABOUT', [
      rowStatic('Rule Version', R.WORN_MINIMUM === 1320 ? 'v1.0.0 (22h minimum)' : 'v?'),
      rowStatic('Storage', 'Local (this device)'),
      rowAction('How the rules work', 'View', () => openRulesScreen()),
      rowAction('Re-run setup', 'Run', () => { Store.updateSettings({ onboarded: false }); startOnboarding(); }),
    ]));

    // Hidden file input for import
    const input = el('input', {
      type: 'file', accept: 'application/json', class: 'hidden-input', id: 'importInput',
    });
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importJSON(String(reader.result || ''));
          showToast('Imported.');
          go('today');
        } catch (err) {
          showToast('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
    root.appendChild(input);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function buildGroup(title, rows, footerNote) {
    const group = el('div', { class: 'settings-group' });
    group.appendChild(el('div', { class: 'settings-group__title' }, title));
    for (const r of rows) group.appendChild(r);
    if (footerNote) group.appendChild(el('div', { class: 'settings-note' }, footerNote));
    return group;
  }
  function rowStatic(label, value) {
    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      el('span', { class: 'settings-row__value' }, value),
    ]);
  }
  function rowSelect(label, value, options, onChange) {
    const select = el('select', null);
    for (const o of options) {
      const opt = el('option', { value: o.value }, o.label);
      if (o.value === value) opt.setAttribute('selected', 'selected');
      select.appendChild(opt);
    }
    select.addEventListener('change', e => onChange(e.target.value));
    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      select,
    ]);
  }
  function rowDate(label, value, onChange) {
    const input = el('input', { type: 'date', value });
    input.addEventListener('change', e => onChange(e.target.value));
    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      input,
    ]);
  }
  function rowNumber(label, value, onChange) {
    const input = el('input', { type: 'number', value, min: '1' });
    input.addEventListener('change', e => onChange(e.target.value));
    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      input,
    ]);
  }
  function rowAction(label, actionLabel, onClick, danger) {
    return el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-row__label' }, label),
      el('button', {
        class: 'settings-row__action' + (danger ? ' settings-row__action--danger' : ''),
        type: 'button',
      }, actionLabel),
    ]).also(node => { node.lastChild.addEventListener('click', onClick); });
  }
  function rangeOptions(min, max) {
    const out = [];
    for (let i = min; i <= max; i++) out.push({ value: String(i), label: String(i) });
    return out;
  }

  /* ============================================================
   * Timer state and live tick
   * ============================================================ */

  let timerTickHandle = null;

  function startTimerTick() {
    stopTimerTick();
    // Update every second while the timer is running.
    timerTickHandle = setInterval(() => {
      const card = $('#timerCard');
      if (!card || card.hidden) {
        stopTimerTick();
        return;
      }
      renderTimerCard();
    }, 1000);
  }
  function stopTimerTick() {
    if (timerTickHandle) {
      clearInterval(timerTickHandle);
      timerTickHandle = null;
    }
  }

  function renderTimerCard() {
    const t = Store.getTimer();
    const card = $('#timerCard');
    if (!t.running) {
      card.hidden = true;
      card.innerHTML = '';
      stopTimerTick();
      return;
    }
    card.hidden = false;
    card.dataset.state = t.elapsedMinutes >= Store.LONG_RUNNING_MIN ? 'long' : 'active';
    const elapsed = formatTimerElapsed(t.elapsedMs);
    card.innerHTML = '';
    card.appendChild(el('div', { class: 'timer-card__head' }, 'TRAY OUT'));
    card.appendChild(el('div', { class: 'timer-card__elapsed' }, elapsed));
    if (t.elapsedMinutes >= Store.LONG_RUNNING_MIN) {
      card.appendChild(el('div', { class: 'timer-card__warn' },
        `Running for ${elapsed} — that's a long time. Confirm when you stop.`));
    }
    const actions = el('div', { class: 'timer-card__actions' });
    const stopBtn = el('button', { class: 'btn btn--primary', type: 'button', id: 'stopTimerBtn' },
      'Stop & Log');
    const discardBtn = el('button', { class: 'btn btn--ghost', type: 'button', id: 'discardTimerBtn' },
      'Discard');
    stopBtn.addEventListener('click', () => handleStopTimer());
    discardBtn.addEventListener('click', () => handleDiscardTimer());
    actions.appendChild(stopBtn);
    actions.appendChild(discardBtn);
    card.appendChild(actions);
  }

  function formatTimerElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  function handleStartTimer() {
    Store.startTimer();
    renderToday();
    startTimerTick();
    showToast('Timer started.');
  }

  function handleStopTimer() {
    const t = Store.getTimer();
    if (!t.running) return;
    const minutes = t.elapsedMinutes;
    if (minutes >= Store.LONG_RUNNING_MIN) {
      // Ask for confirmation
      confirmLongTimer(t, minutes);
    } else {
      logTimerResult(t, minutes);
    }
  }

  function confirmLongTimer(t, minutes) {
    const sheet = $('#confirmSheet');
    $('#confirmTitle').textContent = 'Timer ran for a long time';
    $('#confirmBody').textContent = `Timer has been running for ${formatTimerElapsed(t.elapsedMs)}. Is this correct?`;
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    // Rename the buttons for this context
    ok.textContent = 'Use time';
    cancel.textContent = 'Discard';
    function cleanup() {
      ok.removeEventListener('click', okHandler);
      cancel.removeEventListener('click', cancelHandler);
      sheet.querySelector('[data-confirm-close]').removeEventListener('click', cancelHandler);
      sheet.querySelector('.sheet__backdrop').removeEventListener('click', cancelHandler);
      // Restore default button labels
      ok.textContent = 'Confirm';
      cancel.textContent = 'Cancel';
    }
    function okHandler() {
      cleanup();
      closeSheet(sheet);
      logTimerResult(t, minutes);
    }
    function cancelHandler() {
      cleanup();
      closeSheet(sheet);
      // User discarded the long timer; show a toast with an undo path:
      // they can re-add via the manual entry sheet by tapping Add Removal.
      showToast('Timer discarded.');
    }
    ok.addEventListener('click', okHandler);
    cancel.addEventListener('click', cancelHandler);
    sheet.querySelector('[data-confirm-close]').addEventListener('click', cancelHandler);
    sheet.querySelector('.sheet__backdrop').addEventListener('click', cancelHandler);
    openSheet(sheet);
  }

  function logTimerResult(t, minutes) {
    // Log under today's date with the exact startTs/endTs we recorded.
    Store.stopTimer();
    const ev = Store.addRemoval(Store.todayKey(), minutes, {
      startTs: t.startedAt,
      endTs: Date.now(),
    });
    renderToday();
    stopTimerTick();
    showToast(`Logged ${minutes} min · ${formatRelative(ev.createdTs)}`, 'Undo', () => {
      Store.deleteRemoval(ev.id);
      showToast('Removed.');
      renderToday();
    });
  }

  function handleDiscardTimer() {
    confirmDanger('Discard timer?', 'This timer will not be logged.', () => {
      Store.discardTimer();
      renderToday();
      stopTimerTick();
      showToast('Timer discarded.');
    });
  }

  /* ============================================================
   * Onboarding (first-run)
   * ============================================================ */

  const onboard = {
    step: 0,
    draft: {
      totalTrays: 14,
      currentTray: 1,
      patternPreset: '11/11/10',
      customTray1: 11,
      customTray2: 11,
      customTrayOnward: 10,
      timezone: 'Asia/Kolkata',
    },
  };

  function startOnboarding() {
    onboard.step = 0;
    // Pre-fill draft with whatever the device thinks the timezone is.
    try {
      const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (guess) onboard.draft.timezone = guess;
    } catch (e) { /* keep default */ }
    renderOnboardingStep();
    const overlay = $('#onboarding');
    overlay.hidden = false;
  }

  function endOnboarding() {
    $('#onboarding').hidden = true;
  }

  function renderOnboardingProgress() {
    const dots = $$('#onboardingProgress .onboarding__dot');
    dots.forEach((d, i) => {
      d.classList.toggle('onboarding__dot--active', i <= onboard.step);
    });
  }

  function renderOnboardingStep() {
    // Three steps: welcome → tray plan → timezone. The personal
    // gate (was step 3) is opt-in only and configured later in
    // Settings.
    renderOnboardingProgress();
    const root = $('#onboardingContent');
    root.innerHTML = '';
    const step = onboard.step;
    if (step === 0) root.appendChild(buildOnboardWelcome());
    else if (step === 1) root.appendChild(buildOnboardTrayPlan());
    else if (step === 2) root.appendChild(buildOnboardTimezone());
  }

  function buildOnboardWelcome() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'onboarding__eyebrow' }, 'WELCOME'));
    wrap.appendChild(el('h1', { class: 'onboarding__title' },
      'A calm way to track your Invisalign wear.'));
    wrap.appendChild(el('p', { class: 'onboarding__body' },
      'Log how many minutes your tray was out. The app does the math — daily status, what your next removal can be, and whether today can still be a Perfect day.'));
    const ul = el('ul', { class: 'onboarding__list' });
    ul.appendChild(el('li', null, 'No AI in the loop. Every status and forecast is calculated from a deterministic rules engine you can read in plain English.'));
    ul.appendChild(el('li', null, 'Your data stays on this device. Export to JSON or CSV any time. Nothing is sent to a server.'));
    ul.appendChild(el('li', null, 'This is a tracking tool, not medical advice. Confirm any clinical decisions with your orthodontist.'));
    wrap.appendChild(ul);
    wrap.appendChild(buildNav({ nextLabel: 'Get started', onNext: () => { onboard.step = 1; renderOnboardingStep(); } }));
    return wrap;
  }

  function buildOnboardTrayPlan() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'onboarding__eyebrow' }, 'YOUR PLAN'));
    wrap.appendChild(el('h1', { class: 'onboarding__title' }, 'Tell us your plan.'));
    wrap.appendChild(el('p', { class: 'onboarding__body' },
      'These are the only settings you\'ll need to fill in. You can change them later in Settings.'));

    const f1 = el('div', { class: 'onboarding__field' });
    f1.appendChild(el('label', { class: 'onboarding__label' }, 'Total aligners in your plan'));
    f1.appendChild(el('input', {
      class: 'onboarding__input', type: 'number', min: '1', max: '99',
      value: String(onboard.draft.totalTrays), id: 'ob_totalTrays',
    }));
    wrap.appendChild(f1);

    const f2 = el('div', { class: 'onboarding__field' });
    f2.appendChild(el('label', { class: 'onboarding__label' }, 'Which aligner are you on right now?'));
    f2.appendChild(el('input', {
      class: 'onboarding__input', type: 'number', min: '1',
      value: String(onboard.draft.currentTray), id: 'ob_currentTray',
    }));
    wrap.appendChild(f2);

    const f3 = el('div', { class: 'onboarding__field' });
    f3.appendChild(el('label', { class: 'onboarding__label' }, 'How many days per aligner?'));
    const chips = el('div', { class: 'onboarding__chips' });
    const presets = [
      { value: '11/11/10', label: '11 / 11 / 10' },
      { value: '10/10/10', label: '10 / 10 / 10' },
      { value: '7/7/7',    label: '7 / 7 / 7' },
      { value: 'custom',   label: 'Custom' },
    ];
    for (const p of presets) {
      const chip = el('button', {
        class: 'onboarding__chip' + (onboard.draft.patternPreset === p.value ? ' onboarding__chip--active' : ''),
        type: 'button',
        dataset: { preset: p.value },
      }, p.label);
      chip.addEventListener('click', () => {
        onboard.draft.patternPreset = p.value;
        renderOnboardingStep();
      });
      chips.appendChild(chip);
    }
    f3.appendChild(chips);
    if (onboard.draft.patternPreset === 'custom') {
      const cf = el('div', { class: 'onboarding__field', style: 'margin-top:12px' });
      cf.appendChild(el('label', { class: 'onboarding__label' }, 'Custom: days for tray 1'));
      cf.appendChild(el('input', { class: 'onboarding__input', type: 'number', min: '1', value: String(onboard.draft.customTray1), id: 'ob_t1' }));
      cf.appendChild(el('label', { class: 'onboarding__label', style: 'margin-top:12px' }, 'Custom: days for tray 2'));
      cf.appendChild(el('input', { class: 'onboarding__input', type: 'number', min: '1', value: String(onboard.draft.customTray2), id: 'ob_t2' }));
      cf.appendChild(el('label', { class: 'onboarding__label', style: 'margin-top:12px' }, 'Custom: days for tray 3+'));
      cf.appendChild(el('input', { class: 'onboarding__input', type: 'number', min: '1', value: String(onboard.draft.customTrayOnward), id: 'ob_t3' }));
      f3.appendChild(cf);
    }
    wrap.appendChild(f3);

    wrap.appendChild(buildNav({
      onBack: () => { onboard.step = 0; renderOnboardingStep(); },
      nextLabel: 'Next',
      onNext: () => {
        const total = parseInt($('#ob_totalTrays').value, 10) || 14;
        const cur = parseInt($('#ob_currentTray').value, 10) || 1;
        onboard.draft.totalTrays = total;
        onboard.draft.currentTray = Math.max(1, Math.min(cur, total));
        if (onboard.draft.patternPreset === 'custom') {
          onboard.draft.customTray1 = parseInt($('#ob_t1').value, 10) || 11;
          onboard.draft.customTray2 = parseInt($('#ob_t2').value, 10) || 11;
          onboard.draft.customTrayOnward = parseInt($('#ob_t3').value, 10) || 10;
        }
        onboard.step = 2;
        renderOnboardingStep();
      },
    }));
    return wrap;
  }

  function buildOnboardTimezone() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'onboarding__eyebrow' }, 'TIMEZONE'));
    wrap.appendChild(el('h1', { class: 'onboarding__title' }, 'When does your day start?'));
    wrap.appendChild(el('p', { class: 'onboarding__body' },
      'The app buckets events by calendar day in this timezone. We guessed from your device — confirm or change.'));

    const sel = el('select', { class: 'onboarding__select', id: 'ob_tz' });
    const options = [
      'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo',
      'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
    ];
    for (const tz of options) {
      const opt = el('option', { value: tz }, tz);
      if (tz === onboard.draft.timezone) opt.setAttribute('selected', 'selected');
      sel.appendChild(opt);
    }
    wrap.appendChild(sel);

    wrap.appendChild(buildNav({
      onBack: () => { onboard.step = 1; renderOnboardingStep(); },
      nextLabel: 'Finish',
      onNext: () => {
        onboard.draft.timezone = $('#ob_tz').value;
        finishOnboarding();
      },
    }));
    return wrap;
  }

  function finishOnboarding() {
    const d = onboard.draft;
    let tray1Days = 11, tray2Days = 11, trayOnwardDays = 10;
    if (d.patternPreset === '11/11/10') { tray1Days = 11; tray2Days = 11; trayOnwardDays = 10; }
    else if (d.patternPreset === '10/10/10') { tray1Days = 10; tray2Days = 10; trayOnwardDays = 10; }
    else if (d.patternPreset === '7/7/7')    { tray1Days = 7;  tray2Days = 7;  trayOnwardDays = 7; }
    else { tray1Days = d.customTray1; tray2Days = d.customTray2; trayOnwardDays = d.customTrayOnward; }

    Store.updateSettings({
      totalTrays: d.totalTrays,
      currentTray: d.currentTray,
      tray1Days, tray2Days, trayOnwardDays,
      timezone: d.timezone,
      // gateEnabled stays at its default (false) — opt-in only via Settings.
      onboarded: true,
      medicalDisclaimerAck: true,
    });
    endOnboarding();
    go('today');
  }

  function buildNav({ nextLabel, onBack, onNext }) {
    const nav = el('div', { class: 'onboarding__nav' });
    if (onBack) {
      const b = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Back');
      b.addEventListener('click', onBack);
      nav.appendChild(b);
    }
    const next = el('button', { class: 'btn btn--primary', type: 'button' }, nextLabel || 'Next');
    next.addEventListener('click', onNext);
    nav.appendChild(next);
    return nav;
  }

  /* ============================================================
   * Rules reference screen
   * ============================================================ */

  function renderRulesScreen() {
    const root = $('#rulesContent');
    root.innerHTML = '';
    root.appendChild(el('h2', null, 'How the rules work'));
    root.appendChild(el('p', null,
      'Every status, forecast, and "next removal" number is derived by a small, deterministic JavaScript engine from your raw events. No AI is involved in the math.'));

    root.appendChild(el('h3', null, 'Event zones'));
    const zoneTable = el('table');
    zoneTable.appendChild(el('thead', null, el('tr', null, [
      el('th', null, 'Duration (min)'),
      el('th', null, 'Zone'),
      el('th', null, 'Note'),
    ])));
    const tbody = el('tbody');
    [
      ['0–30',   'Green',           'No breach'],
      ['31–35',  'Green (minor)',   '"Breach" — exceeds 30 by 1–5 min'],
      ['36–40',  'Amber',           'Moderate overrun'],
      ['41–60',  'Red',             'Significant overrun (auto-Failure)'],
      ['> 60',   'Extended',        'Auto-Failure'],
    ].forEach(row => {
      tbody.appendChild(el('tr', null, row.map(c => el('td', null, c))));
    });
    zoneTable.appendChild(tbody);
    root.appendChild(zoneTable);
    root.appendChild(el('p', null, [
      'Breach = strictly more than 30 min. Excess = duration − 30.',
    ]));

    root.appendChild(el('h3', null, 'Daily classification'));
    root.appendChild(el('p', null, 'Failure if ANY of these is true:'));
    root.appendChild(el('ul', null, [
      el('li', null, 'Worn time < 22 h.'),
      el('li', null, 'Any single removal is 41–60 min.'),
      el('li', null, 'Any single removal is > 60 min.'),
      el('li', null, 'More than 5 removals.'),
      el('li', null, 'Exactly 5 removals and none is ≤ 10 min.'),
      el('li', null, 'Three or more amber removals (36–40 min).'),
    ]));

    root.appendChild(el('p', null, 'If no failure and worn ≥ 22 h:'));
    root.appendChild(el('ul', null, [
      el('li', null, [el('strong', null, 'Perfect'), ' — ≤ 4 removals, no amber/red; for 1–3 removals ≤ 2 green-zone breaches, for 4 removals ≤ 1.']),
      el('li', null, [el('strong', null, 'Near Perfect'), ' — not Perfect, but no Failure; e.g. one or two amber removals, or 5 removals with at least one ≤ 10 min.']),
      el('li', null, [el('strong', null, 'Imperfect'), ' — none of the above, but no Failure.']),
    ]));

    root.appendChild(el('h3', null, 'One-off 41–60 min softening'));
    root.appendChild(el('p', null,
      'The 41–60-min rule is loosened by one: a day with exactly one 41–60-min removal, where that removal is the only such event in the trailing 7-day window (counting today), is classified as Imperfect instead of Failure. The softening only fires when the red zone is the sole failure trigger — other triggers (worn < 22h, >60 min, > 5 removals, 5 removals with no ≤ 10 min, 3+ ambers) keep their full effect. Today is the one-off relief; tomorrow, the same 41–60 removal would no longer soften.'));

    root.appendChild(el('h3', null, 'Forecast'));
    root.appendChild(el('p', null,
      'The day classifies as if no further removals were added. Recomputed on every change.'));

    root.appendChild(el('h3', null, 'Next-removal max'));
    root.appendChild(el('p', null, [
      'The largest single-removal duration that keeps the day capable of a chosen target (',
      el('code', null, 'perfect'),
      ' / ',
      el('code', null, 'near-perfect'),
      ' / ',
      el('code', null, 'avoid-failure'),
      '). It checks every rule simultaneously. If Perfect is no longer achievable, the app targets Near Perfect.',
    ]));

    root.appendChild(el('h3', null, 'Multi-removal plan'));
    root.appendChild(el('p', null,
      'If you still need more removals today, the largest uniform duration X such that adding N removals each of X still hits the target. Conservative feasible plan.'));

    root.appendChild(el('h3', null, 'Streaks'));
    const stTbl = el('table');
    stTbl.appendChild(el('thead', null, el('tr', null, [
      el('th', null, 'Streak'), el('th', null, 'Counts'),
    ])));
    const sBody = el('tbody');
    [
      ['Perfect', 'consecutive Perfect days. NO_DATA and IN_PROGRESS don\'t break it.'],
      ['Non-failure', 'consecutive Perfect + Near Perfect + Imperfect days. Failure resets it.'],
    ].forEach(row => {
      sBody.appendChild(el('tr', null, row.map(c => el('td', null, c))));
    });
    stTbl.appendChild(sBody);
    root.appendChild(stTbl);

    root.appendChild(el('h3', null, 'Invariants'));
    root.appendChild(el('ul', null, [
      el('li', null, 'Raw events are the only source of truth.'),
      el('li', null, 'Every derived field is recomputable from events.'),
      el('li', null, 'No AI/LLM is involved in any calculation.'),
    ]));
  }

  /* ============================================================
   * Sheets (modals)
   * ============================================================ */

  let lastFocused = null;
  function openSheet(sheet, onShown) {
    lastFocused = document.activeElement;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      const f = sheet.querySelector('input, select, textarea, button');
      if (f) f.focus({ preventScroll: true });
      if (onShown) onShown();
    });
  }
  function closeSheet(sheet) {
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  }

  function openAddSheet() {
    const sheet = $('#addSheet');
    $('#addInput').value = '';
    $('#addError').hidden = true;
    openSheet(sheet);
  }
  function openEditSheet(event) {
    const sheet = $('#editSheet');
    const input = $('#editInput');
    input.value = String(event.duration);
    $('#editError').hidden = true;
    sheet.dataset.eventId = event.id;
    sheet.dataset.eventDay = event.date;
    openSheet(sheet);
  }

  function confirmDanger(title, body, onConfirm) {
    const sheet = $('#confirmSheet');
    $('#confirmTitle').textContent = title;
    $('#confirmBody').textContent = body;
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    function done(result) {
      ok.removeEventListener('click', okHandler);
      cancel.removeEventListener('click', cancelHandler);
      sheet.querySelector('[data-confirm-close]').removeEventListener('click', cancelHandler);
      sheet.querySelector('.sheet__backdrop').removeEventListener('click', cancelHandler);
      closeSheet(sheet);
      if (result) onConfirm();
    }
    function okHandler() { done(true); }
    function cancelHandler() { done(false); }
    ok.addEventListener('click', okHandler);
    cancel.addEventListener('click', cancelHandler);
    sheet.querySelector('[data-confirm-close]').addEventListener('click', cancelHandler);
    sheet.querySelector('.sheet__backdrop').addEventListener('click', cancelHandler);
    openSheet(sheet);
  }

  /* ============================================================
   * Wire-up
   * ============================================================ */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  function wire() {
    // Tabs
    $$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.screen)));

    // Today add button
    $('#addBtn').addEventListener('click', openAddSheet);

    // Start timer button
    $('#startTimerBtn').addEventListener('click', handleStartTimer);

    // Add sheet
    $('#addSheet').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet($('#addSheet'))));
    $('#addForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = $('#addInput').value.trim();
      const errEl = $('#addError');
      errEl.hidden = true;
      if (!/^\d+$/.test(raw)) {
        errEl.textContent = 'Invalid input. Enter a whole number of minutes.';
        errEl.hidden = false;
        return;
      }
      const dur = parseInt(raw, 10);
      if (dur <= 0) {
        errEl.textContent = 'Invalid input. Enter a whole number of minutes.';
        errEl.hidden = false;
        return;
      }
      try {
        const ev = Store.addRemoval(Store.todayKey(), dur);
        closeSheet($('#addSheet'));
        showToast(`Added ${ev.duration} min · ${formatRelative(ev.createdTs)}`, 'Undo', () => {
          Store.undoLastRemoval(Store.todayKey());
          showToast('Undone.');
        });
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    // Edit sheet
    $('#editSheet').querySelectorAll('[data-edit-close]').forEach(b => b.addEventListener('click', () => closeSheet($('#editSheet'))));
    $('#editForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const sheet = $('#editSheet');
      const id = sheet.dataset.eventId;
      const day = sheet.dataset.eventDay;
      const raw = $('#editInput').value.trim();
      const errEl = $('#editError');
      errEl.hidden = true;
      if (!/^\d+$/.test(raw)) {
        errEl.textContent = 'Invalid input. Enter a whole number of minutes.';
        errEl.hidden = false;
        return;
      }
      const dur = parseInt(raw, 10);
      if (dur <= 0) {
        errEl.textContent = 'Invalid input. Enter a whole number of minutes.';
        errEl.hidden = false;
        return;
      }
      try {
        const updated = Store.editRemoval(id, dur);
        closeSheet(sheet);
        showToast(`Updated · ${formatRelative(updated.editedTs)}`);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
    $('#editDelete').addEventListener('click', () => {
      const sheet = $('#editSheet');
      const id = sheet.dataset.eventId;
      if (!id) return;
      confirmDanger('Delete this removal?', 'This will recalculate the day immediately.', () => {
        Store.deleteRemoval(id);
        closeSheet(sheet);
        showToast('Deleted.');
      });
    });

    // Day-detail back
    $('#dayBackBtn').addEventListener('click', () => go('history'));

    // Initial theme
    applyTheme(Store.state.settings.theme || 'system');
  }

  // tiny helper for chained DOM mutation
  Element.prototype.also = function (fn) { fn(this); return this; };

  // ---- Rules screen ----
  function openRulesScreen() {
    go('rules');
  }

  // Re-render on store changes
  Store.subscribe(() => {
    if (currentScreen === 'today') renderToday();
    else if (currentScreen === 'history') renderHistory();
    else if (currentScreen === 'tray') renderTray();
    else if (currentScreen === 'insights') renderInsights();
    else if (currentScreen === 'settings') renderSettings();
    else if (currentScreen === 'day') renderDay();
  });

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    // Rules screen back button
    $('#rulesBackBtn').addEventListener('click', () => {
      go('settings');
    });
    if (!Store.state.settings.onboarded) {
      startOnboarding();
    } else {
      go('today');
      // If a timer was running, resume the live tick
      if (Store.getTimer().running) startTimerTick();
    }
    // Re-render on tab visibility change so the timer updates
    // immediately when the user comes back (setInterval may have
    // been throttled in the background).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentScreen === 'today') {
        renderToday();
      }
    });
  });
})();
