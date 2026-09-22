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

    // Scroll to top on screen change.
    try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { /* jsdom */ }
  }

  /* ============================================================
   * Today
   * ============================================================ */

  function renderToday() {
    // Header pill
    const s = Store.state.settings;
    $('#trayNum').textContent = String(s.currentTray);
    $('#trayTotal').textContent = String(s.totalTrays);

    const today = Store.todayKey();
    const events = Store.eventsForDate(today);
    const summary = R.dailySummary(events);
    const forecast = R.forecast(events);

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
      nr.dataset.tone = 'progress';
      nr.appendChild(el('div', { class: 'next-removal-card__head' }, 'NEXT REMOVAL'));
      nr.appendChild(el('div', { class: 'next-removal-card__max' }, [
        'MAX ', el('span', null, R.formatMinutesShort(60)),
        el('span', { class: 'next-removal-card__unit' }, ' MIN')
      ]));
      nr.appendChild(el('div', { class: 'next-removal-card__sub' }, 'Perfect is still possible.'));
    } else {
      renderNextRemoval(nr, mr, events);
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

  function renderNextRemoval(card, multiCard, events) {
    const target = pickTarget(events);
    const max = R.maxNextRemoval(events, target);
    const forecast = R.forecast(events);
    const tone = toneForStatus(forecast);
    card.dataset.tone = tone;
    card.innerHTML = '';

    // Two-column section: NEXT REMOVAL | TOTAL LEFT
    const sections = el('div', { class: 'next-removal-card__sections' });
    card.appendChild(el('div', { class: 'next-removal-card__head' }, 'NEXT REMOVAL'));
    card.appendChild(sections);

    const nextSec = el('div', { class: 'next-removal-card__section' });
    nextSec.appendChild(el('div', { class: 'next-removal-card__max' }, [
      `MAX ${max} `, el('span', { class: 'next-removal-card__unit' }, 'MIN')
    ]));
    nextSec.appendChild(el('div', { class: 'next-removal-card__sub' },
      max === 0 ? 'No safe next removal.' : statusSubtext(forecast, target)));
    sections.appendChild(nextSec);

    // TOTAL LEFT — only when day still has room and not Failure
    const allowed = R.MINUTES_IN_DAY - R.WORN_MINIMUM; // 120
    const total = R.totalRemovalMinutes(events);
    const left = Math.max(0, allowed - total);
    if (left > 0 && forecast !== R.STATUS.FAILURE) {
      const totalSec = el('div', { class: 'next-removal-card__section' });
      totalSec.appendChild(el('div', { class: 'next-removal-card__total' }, [
        `${left} `, el('span', { class: 'next-removal-card__unit' }, 'MIN LEFT')
      ]));
      totalSec.appendChild(el('div', { class: 'next-removal-card__sub' }, 'before 22h'));
      sections.appendChild(totalSec);
    }

    // Multi-removal hint: show if more removals are likely possible
    if (forecast === R.STATUS.FAILURE) return;
    const remainingSlots = remainingRemovalSlots(events, target);
    if (remainingSlots >= 1 && target !== 'avoid-failure') {
      // remainingSlots = max additional removals allowed for target.
      // We plan for ALL remainingSlots being filled, each at the
      // same duration X. Largest X is the conservative feasible plan.
      const plan = R.planRemaining(events, target, remainingSlots);
      if (plan.feasible && plan.perRemoval > 0) {
        multiCard.hidden = false;
        multiCard.dataset.tone = tone;
        multiCard.innerHTML = '';
        const head = remainingSlots === 1
          ? 'IF YOU NEED 1 MORE REMOVAL'
          : `IF YOU NEED ${remainingSlots} MORE REMOVALS`;
        multiCard.appendChild(el('div', { class: 'multi-removal-card__head' }, head));
        multiCard.appendChild(el('div', { class: 'multi-removal-card__plan' }, [
          `MAX ${plan.perRemoval} `,
          el('span', { class: 'next-removal-card__unit' }, remainingSlots === 1 ? 'MIN' : 'MIN EACH')
        ]));
        multiCard.appendChild(el('div', { class: 'multi-removal-card__sub' },
          remainingSlots === 1
            ? 'A conservative plan for this next removal.'
            : 'Conservative feasible plan, leaving room to stay on target.'));
      }
    }
  }

  function pickTarget(events) {
    // The displayed guidance should target the BEST STILL-ACHIEVABLE
    // outcome. Once the day has crossed out of Perfect possibility
    // (e.g., 2 amber removals, 5 removals, etc.), we still want to
    // give useful next-removal advice — targeting Perfect would lock
    // the answer at 0, which is unhelpful and contradicts spec §14.
    const forecast = R.forecast(events);
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

    const head = el('div', { class: 'day-header' }, [
      el('div', { class: 'day-header__date' }, formatDayLong(dayKey)),
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

    // Tray 6 progression gate (user-defined)
    const gate = buildTray6Gate(s);
    root.appendChild(gate);

    root.appendChild(el('div', { class: 'settings-note' },
      'Tray progression rules and target dates are user-defined. ' +
      'They do not replace advice from your orthodontist.'));
  }

  function buildTray6Gate(s) {
    const card = el('div', { class: 'tray-gate' }, [
      el('div', { class: 'tray-gate__title' }, 'Tray 6 Check'),
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

    const days = dates.map(d => ({ date: d, events: Store.eventsForDate(d) }));

    // Compute segmentations
    const allAgg = R.aggregate(days);
    const streaks = R.computeStreaks(days.map(x => R.classifyDay(x.events).status));

    // Cumulative card
    root.appendChild(buildCumulativeCard(allAgg, streaks, days));

    // Last 7 days
    const last7 = days.slice(-7);
    if (last7.length > 0) {
      root.appendChild(buildSegmentCard('LAST 7 DAYS', R.aggregate(last7), R.computeStreaks(last7.map(x => R.classifyDay(x.events).status)), last7.length));
    }

    // Last 30 days
    const last30 = days.slice(-30);
    if (last30.length > 0) {
      root.appendChild(buildSegmentCard('LAST 30 DAYS', R.aggregate(last30), R.computeStreaks(last30.map(x => R.classifyDay(x.events).status)), last30.length));
    }
  }

  function buildSegmentCard(title, agg, streaks, dayCount) {
    const seg = el('div', { class: 'insights-segment' });
    seg.appendChild(el('div', { class: 'insights-segment__title' }, title));

    const completed = agg.completed;
    const avgWorn = completed > 0 ? Math.round(agg.totalWornMinutes / completed) : 0;
    const avgOut = completed > 0 ? Math.round(agg.totalRemovalMinutes / completed) : 0;

    const stats = el('div', { class: 'insights-stats' });
    stats.appendChild(buildStat2('Tracked Days', String(dayCount)));
    stats.appendChild(buildStat2('Perfect', String(agg.perfect), 'green'));
    stats.appendChild(buildStat2('Near Perfect', String(agg.nearPerfect), 'green'));
    stats.appendChild(buildStat2('Imperfect', String(agg.imperfect), 'imperfect'));
    stats.appendChild(buildStat2('Failure', String(agg.failure), 'red'));
    stats.appendChild(buildStat2('Avg Worn', completed ? R.formatMinutesShort(avgWorn) : '—'));
    stats.appendChild(buildStat2('Avg Out', completed ? `${avgOut}m` : '—'));
    stats.appendChild(buildStat2('Longest Removal', agg.longestRemoval ? `${agg.longestRemoval}m` : '—'));
    stats.appendChild(buildStat2('Total Events', String(agg.totalEvents)));
    stats.appendChild(buildStat2('Total Breaches', String(agg.totalBreaches)));
    stats.appendChild(buildStat2('Total Excess', `${agg.totalExcess}m`));
    seg.appendChild(stats);

    // Distribution bar
    const total = agg.perfect + agg.nearPerfect + agg.imperfect + agg.failure;
    if (total > 0) {
      const bar = el('div', { class: 'distribution-bar' });
      bar.appendChild(el('div', { class: 'distribution-bar__seg distribution-bar__seg--perfect',
        style: `flex:${agg.perfect}` }));
      bar.appendChild(el('div', { class: 'distribution-bar__seg distribution-bar__seg--near',
        style: `flex:${agg.nearPerfect}` }));
      bar.appendChild(el('div', { class: 'distribution-bar__seg distribution-bar__seg--imperfect',
        style: `flex:${agg.imperfect}` }));
      bar.appendChild(el('div', { class: 'distribution-bar__seg distribution-bar__seg--failure',
        style: `flex:${agg.failure}` }));
      seg.appendChild(bar);

      seg.appendChild(el('div', { class: 'distribution-legend' }, [
        legendItem('perfect', 'Perfect'),
        legendItem('near', 'Near Perfect'),
        legendItem('imperfect', 'Imperfect'),
        legendItem('failure', 'Failure'),
      ]));
    }

    // Streaks
    seg.appendChild(buildStreakCard('Perfect Streak', streaks.currentPerfect, streaks.longestPerfect));
    seg.appendChild(buildStreakCard('Non-Failure Streak', streaks.currentNonFailure, streaks.longestNonFailure));

    return seg;
  }

  function buildCumulativeCard(agg, streaks, days) {
    const card = el('div', { class: 'insights-segment' });
    card.appendChild(el('div', { class: 'insights-segment__title' }, 'ALL TIME'));

    const stats = el('div', { class: 'insights-stats' });
    stats.appendChild(buildStat2('Tracked Days', String(days.length)));
    stats.appendChild(buildStat2('Perfect', String(agg.perfect), 'green'));
    stats.appendChild(buildStat2('Near Perfect', String(agg.nearPerfect), 'green'));
    stats.appendChild(buildStat2('Imperfect', String(agg.imperfect), 'imperfect'));
    stats.appendChild(buildStat2('Failure', String(agg.failure), 'red'));
    stats.appendChild(buildStat2('No Data', String(agg.noData)));
    stats.appendChild(buildStat2('Avg Removal', agg.averageRemovalDuration ? `${Math.round(agg.averageRemovalDuration)}m` : '—'));
    stats.appendChild(buildStat2('Green Breaches', String(agg.greenBreachCount)));
    stats.appendChild(buildStat2('Amber', String(agg.amberCount), agg.amberCount > 0 ? 'red' : null));
    stats.appendChild(buildStat2('Red', String(agg.redCount + agg.extendedCount), (agg.redCount + agg.extendedCount) > 0 ? 'red' : null));
    card.appendChild(stats);

    card.appendChild(buildStreakCard('Perfect Streak', streaks.currentPerfect, streaks.longestPerfect, 'green'));
    card.appendChild(buildStreakCard('Non-Failure Streak', streaks.currentNonFailure, streaks.longestNonFailure));
    return card;
  }

  function buildStat2(label, value, tone) {
    const cls = 'insights-stat__value' + (tone ? ' insights-stat__value--' + tone : '');
    return el('div', { class: 'insights-stat' }, [
      el('div', { class: 'insights-stat__label' }, label),
      el('div', { class: cls }, value),
    ]);
  }
  function legendItem(key, label) {
    return el('span', null, [
      el('span', { class: 'distribution-legend__swatch distribution-bar__seg--' + key }),
      label,
    ]);
  }
  function buildStreakCard(label, current, longest, tone) {
    return el('div', { class: 'streak-card' }, [
      el('div', null, [
        el('div', { class: 'streak-card__label' }, label),
        el('div', { class: 'streak-card__value' + (tone ? ' streak-card__value--' + tone : '') }, `${current} current`),
      ]),
      el('div', { class: 'streak-card__value' }, `${longest} longest`),
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

    // Progression gate group
    root.appendChild(buildGroup('TRAY 6 PROGRESSION GATE', [
      rowDate('Gate Day 1', s.tray6GateDate1, v => Store.updateSettings({ tray6GateDate1: v })),
      rowDate('Gate Day 2', s.tray6GateDate2, v => Store.updateSettings({ tray6GateDate2: v })),
    ], 'Both days must be Perfect. Near Perfect does not qualify. User-defined, not medical advice.'));

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
    go('today');
  });
})();
