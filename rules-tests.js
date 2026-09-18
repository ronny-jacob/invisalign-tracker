/* ============================================================
 * Rules engine — Acceptance Tests
 * ============================================================
 * Verifies that classifyDay() matches every example from the
 * specification (§11) and every explicit acceptance test (§41).
 *
 * Open tests.html in a browser to run.
 * ============================================================ */

(function () {
  'use strict';

  const R = window.Rules;

  const cases = [
    // ---- §11 validated examples ----
    { name: '§11: 20 → PERFECT',                     events: [20], expectStatus: 'PERFECT', expectWornHM: '23h 40m' },
    { name: '§11: 30 → PERFECT',                     events: [30], expectStatus: 'PERFECT', expectWornHM: '23h 30m' },
    { name: '§11: 35 → PERFECT',                     events: [35], expectStatus: 'PERFECT', expectWornHM: '23h 25m' },
    { name: '§11: 36 → NEAR PERFECT',                events: [36], expectStatus: 'NEAR_PERFECT', expectWornHM: '23h 24m' },
    { name: '§11: 40 → NEAR PERFECT',                events: [40], expectStatus: 'NEAR_PERFECT', expectWornHM: '23h 20m' },
    { name: '§11: 41 → FAILURE',                     events: [41], expectStatus: 'FAILURE', expectWornHM: '23h 19m' },

    { name: '§11: 20,20 → PERFECT',                  events: [20,20], expectStatus: 'PERFECT', expectWornHM: '23h 20m' },
    { name: '§11: 30,30 → PERFECT',                  events: [30,30], expectStatus: 'PERFECT', expectWornHM: '23h 00m' },
    { name: '§11: 20,35 → PERFECT',                  events: [20,35], expectStatus: 'PERFECT', expectWornHM: '23h 05m' },
    { name: '§11: 35,35 → PERFECT',                  events: [35,35], expectStatus: 'PERFECT', expectWornHM: '22h 50m' },
    { name: '§11: 30,36 → NEAR PERFECT',             events: [30,36], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 54m' },
    { name: '§11: 36,36 → NEAR PERFECT',             events: [36,36], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 48m' },
    { name: '§11: 36,36,30 → NEAR PERFECT',          events: [36,36,30], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 18m' },
    { name: '§11: 36,36,36 → FAILURE (3 ambers)',    events: [36,36,36], expectStatus: 'FAILURE', expectWornHM: '22h 12m' },
    { name: '§10: 40,40,40 → exactly 22h, FAILURE (3 ambers)',  events: [40,40,40], expectStatus: 'FAILURE', expectWornHM: '22h 00m' },
    { name: '§11: 20,41 → FAILURE',                  events: [20,41], expectStatus: 'FAILURE', expectWornHM: '22h 59m' },

    { name: '§11: 20,20,20 → PERFECT',               events: [20,20,20], expectStatus: 'PERFECT', expectWornHM: '23h 00m' },
    { name: '§11: 20,25,35 → PERFECT',               events: [20,25,35], expectStatus: 'PERFECT', expectWornHM: '22h 40m' },
    { name: '§11: 35,35,35 → NEAR PERFECT',          events: [35,35,35], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 15m' },

    { name: '§11: 30,30,30,30 → PERFECT (==22h)',    events: [30,30,30,30], expectStatus: 'PERFECT', expectWornHM: '22h 00m' },
    { name: '§11: 30,30,30,35 → FAILURE (<22h)',     events: [30,30,30,35], expectStatus: 'FAILURE', expectWornHM: '21h 55m' },
    { name: '§11: 15,20,35,10 → PERFECT',            events: [15,20,35,10], expectStatus: 'PERFECT', expectWornHM: '22h 40m' },
    { name: '§11: 20,20,20,35 → PERFECT',            events: [20,20,20,35], expectStatus: 'PERFECT', expectWornHM: '22h 25m' },
    { name: '§11: 35,35,30,30 → FAILURE',            events: [35,35,30,30], expectStatus: 'FAILURE', expectWornHM: '21h 50m' },
    { name: '§11: 36,30,20,10 → NEAR PERFECT',       events: [36,30,20,10], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 24m' },
    { name: '§11: 40,30,20,10 → NEAR PERFECT',       events: [40,30,20,10], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 20m' },
    { name: '§11: 36,36,20,10 → NEAR PERFECT',       events: [36,36,20,10], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 18m' },
    { name: '§11: 41,20,20,20 → FAILURE',            events: [41,20,20,20], expectStatus: 'FAILURE', expectWornHM: '22h 19m' },

    { name: '§11: 20,20,20,20,20 → FAILURE (5, no ≤10)', events: [20,20,20,20,20], expectStatus: 'FAILURE', expectWornHM: '22h 20m' },
    { name: '§11: 10,20,20,20,20 → NEAR PERFECT',   events: [10,20,20,20,20], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 30m' },
    { name: '§11: 10,15,20,20,30 → NEAR PERFECT',   events: [10,15,20,20,30], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 25m' },
    { name: '§11: 10,20,20,20,35 → NEAR PERFECT',   events: [10,20,20,20,35], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 15m' },
    { name: '§11: 10,20,20,20,41 → FAILURE',        events: [10,20,20,20,41], expectStatus: 'FAILURE', expectWornHM: '22h 09m' },

    { name: '§11: 6 removals → FAILURE',             events: [10,10,10,10,10,10], expectStatus: 'FAILURE' },

    // ---- §41 acceptance tests ----
    { name: 'Test A: 35 → 23h25m, Perfect possible', events: [35], expectStatus: 'PERFECT', expectWornHM: '23h 25m' },
    { name: 'Test B: 36 → 23h24m, Near Perfect',     events: [36], expectStatus: 'NEAR_PERFECT', expectWornHM: '23h 24m' },
    { name: 'Test C: 40,40 → 22h40m, Near Perfect',  events: [40,40], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 40m' },
    { name: 'Test D: 40,40,40 → FAILURE (3 ambers)', events: [40,40,40], expectStatus: 'FAILURE', expectWornHM: '22h 00m' },
    { name: 'Test K: 36,36,36 → Failure (3 ambers)', events: [36,36,36], expectStatus: 'FAILURE', expectWornHM: '22h 12m' },
    { name: 'Test E: 30,30,30,30 → 22h00m, Perfect', events: [30,30,30,30], expectStatus: 'PERFECT', expectWornHM: '22h 00m' },
    { name: 'Test F: 30,30,30,35 → FAILURE (<22h)',  events: [30,30,30,35], expectStatus: 'FAILURE', expectWornHM: '21h 55m' },
    { name: 'Test G: 5×20 → FAILURE (5, no ≤10)',    events: [20,20,20,20,20], expectStatus: 'FAILURE', expectWornHM: '22h 20m' },
    { name: 'Test H: 10,20,20,20,20 → Near Perfect', events: [10,20,20,20,20], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 30m' },
    { name: 'Test I: 41 → Failure immediately',      events: [41], expectStatus: 'FAILURE' },
    { name: 'Test J: 36,36,20,10 → 22h18m, Near Perfect', events: [36,36,20,10], expectStatus: 'NEAR_PERFECT', expectWornHM: '22h 18m' },
    { name: 'Test K: 36,36,36 → Failure (3 ambers)', events: [36,36,36], expectStatus: 'FAILURE', expectWornHM: '22h 12m' },
    { name: 'Test K-alt: 40,40,40 → exactly 22h, Failure', events: [40,40,40], expectStatus: 'FAILURE', expectWornHM: '22h 00m' },
    { name: 'Test L: 20,25,35 → 22h40m, Perfect',    events: [20,25,35], expectStatus: 'PERFECT', expectWornHM: '22h 40m' },

    // ---- §9 zone / breach tests ----
    { name: 'Zone: 30 is not a breach',               events: [30], expectStatus: 'PERFECT' },
    { name: 'Zone: 31 is +1 breach',                  events: [31], expectStatus: 'PERFECT' },
    { name: 'Zone: 35 is +5 breach',                  events: [35], expectStatus: 'PERFECT' },
    { name: 'Zone: 36 is amber',                      events: [36], expectStatus: 'NEAR_PERFECT' },
    { name: 'Zone: 60 is red',                        events: [60], expectStatus: 'FAILURE' },
    { name: 'Zone: 61 is extended (>60)',             events: [61], expectStatus: 'FAILURE' },
    { name: 'Zone: 120 is extended',                  events: [120], expectStatus: 'FAILURE' },

    // ---- Edge: empty / no data ----
    { name: 'No events → NO_DATA',                   events: [],    expectStatus: 'NO_DATA' },

    // ---- Breach excess math ----
    { name: 'Breach: 30 → 0 excess',                 events: [30], breachExcess: 0 },
    { name: 'Breach: 31 → +1',                       events: [31], breachExcess: 1 },
    { name: 'Breach: 35 → +5',                       events: [35], breachExcess: 5 },
    { name: 'Breach: 40 → +10',                      events: [40], breachExcess: 10 },
    { name: 'Breach: 41 → +11',                      events: [41], breachExcess: 11 },
    { name: 'Breach: 60 → +30',                      events: [60], breachExcess: 30 },
    { name: 'Breach: 61 → +31',                      events: [61], breachExcess: 31 },

    // ---- Forecast equals classification ----
    { name: 'Forecast: 30,30,30,30 → PERFECT',       events: [30,30,30,30], expectForecast: 'PERFECT' },
    { name: 'Forecast: 36,36,36 → FAILURE',          events: [36,36,36],    expectForecast: 'FAILURE' },
    { name: 'Forecast: 30 → PERFECT',                events: [30],          expectForecast: 'PERFECT' },

    // ---- Next-removal max invariants ----
    {
      name: 'Next-removal: 35 alone, Perfect target → max ≤ 35',
      events: [35], target: 'perfect', expectMaxAtMost: 35, expectMaxAtLeast: 30,
    },
    {
      name: 'Next-removal: 40,40, Near Perfect → max = 35 (avoid 3rd amber)',
      events: [40,40], target: 'near-perfect', expectMaxExact: 35,
    },
    {
      name: 'Plan: 40,40 + 2 more uniform → 20 min each (spec §14)',
      events: [40,40], target: 'near-perfect', planFuture: 2, expectPlanExact: 20,
    },
    {
      name: 'Next-removal: 36,36,36 already Failure-locked → max = 0',
      events: [36,36,36], target: 'near-perfect', expectMaxExact: 0,
    },
    {
      name: 'Next-removal: empty day, Perfect → max ≤ 35 (no amber/red)',
      events: [], target: 'perfect', expectMaxAtMost: 35, expectMaxAtLeast: 30,
    },
    {
      name: 'Next-removal: avoid-failure, no ambers → max = 40 (last non-red)',
      events: [20], target: 'avoid-failure', expectMaxExact: 40,
    },
    {
      name: 'Next-removal: avoid-failure, 40,40 → max = 35 (3rd amber would Fail)',
      events: [40,40], target: 'avoid-failure', expectMaxExact: 35,
    },
    {
      name: 'Next-removal: 30,30,30,30, avoid-failure → max = 0 (already at 22h exactly)',
      events: [30,30,30,30], target: 'avoid-failure', expectMaxExact: 0,
    },
    {
      name: 'Next-removal: 41 alone, avoid-failure → max = 0',
      events: [41], target: 'avoid-failure', expectMaxExact: 0,
    },
  ];

  function runAll() {
    const results = [];
    let pass = 0, fail = 0;

    for (const c of cases) {
      const evts = c.events.map(d => ({ duration: d }));
      const summary = R.dailySummary(evts);
      const cls = R.classifyDay(evts);
      const fc = R.forecast(evts);
      const max = c.target != null ? R.maxNextRemoval(evts, c.target) : null;

      const checks = [];

      if (c.expectStatus != null) {
        checks.push({ ok: cls.status === c.expectStatus, got: cls.status, want: c.expectStatus, label: 'status' });
      }
      if (c.expectWornHM != null) {
        const wornHM = R.formatHM(summary.worn);
        checks.push({ ok: wornHM === c.expectWornHM, got: wornHM, want: c.expectWornHM, label: 'worn' });
      }
      if (c.breachExcess != null) {
        const total = R.breachExcess(evts.reduce((a, b) => a + b.duration, 0));
        checks.push({ ok: total === c.breachExcess, got: total, want: c.breachExcess, label: 'breachExcess total' });
      }
      if (c.expectForecast != null) {
        checks.push({ ok: fc === c.expectForecast, got: fc, want: c.expectForecast, label: 'forecast' });
      }
      if (c.expectMaxExact != null) {
        checks.push({ ok: max === c.expectMaxExact, got: max, want: c.expectMaxExact, label: 'maxNextRemoval' });
      }
      if (c.expectMaxAtMost != null) {
        checks.push({ ok: max <= c.expectMaxAtMost, got: max, want: `≤ ${c.expectMaxAtMost}`, label: 'maxNextRemoval≤' });
      }
      if (c.expectMaxAtLeast != null) {
        checks.push({ ok: max >= c.expectMaxAtLeast, got: max, want: `≥ ${c.expectMaxAtLeast}`, label: 'maxNextRemoval≥' });
      }
      if (c.planFuture != null) {
        const plan = R.planRemaining(evts, c.target, c.planFuture);
        checks.push({
          ok: plan.feasible && plan.perRemoval === c.expectPlanExact,
          got: JSON.stringify(plan),
          want: `feasible perRemoval=${c.expectPlanExact}`,
          label: `planRemaining(${c.planFuture} more)`,
        });
      }

      const allOk = checks.every(x => x.ok);
      if (allOk) pass++; else fail++;
      results.push({ name: c.name, allOk, checks });
    }

    return { pass, fail, results };
  }

  window.RulesTests = { runAll, cases };
})();
