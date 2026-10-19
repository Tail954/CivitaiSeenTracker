const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDateFilter, dateMatches, jstDayStart, jstToday, normalizeRange,
  supportedPage, validDate, versionsMatch
} = require('../src/date-filter.js');

const TODAY = '2026-10-19';
const start = `${TODAY}T00:00:00+09:00`;
const nextStart = '2026-10-20T00:00:00+09:00';

test('JST day boundaries include both edges and exclude the next midnight', () => {
  assert.equal(jstToday(new Date('2026-10-18T15:00:00.000Z')), TODAY);
  assert.equal(dateMatches(start, { range: false, date: TODAY }), true);
  assert.equal(dateMatches('2026-10-19T14:59:59.999Z', { range: false, date: TODAY }), true);
  assert.equal(dateMatches(nextStart, { range: false, date: TODAY }), false);
  assert.equal(jstDayStart(TODAY), Date.parse(start));
});

test('date validation and range selection handle invalid and reversed input', () => {
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
  assert.deepEqual(normalizeRange('2026-10-21', '2026-10-19'), ['2026-10-19', '2026-10-21']);
  assert.equal(normalizeRange('bad', TODAY), null);
  assert.equal(dateMatches('2026-10-20T14:59:59.999Z', {
    range: true, startDate: '2026-10-19', endDate: '2026-10-20'
  }), true);
});

test('updated mode matches any version; registered mode uses the oldest version', () => {
  const versions = [
    { createdAt: '2026-10-10T15:00:00Z' },
    { createdAt: '2026-10-19T00:00:00+09:00' }
  ];
  assert.equal(versionsMatch(versions, { range: false, date: TODAY }, 'updated'), true);
  assert.equal(versionsMatch(versions, { range: false, date: TODAY }, 'registered'), false);
  assert.equal(versionsMatch([{ createdAt: 'bad' }], { range: false, date: TODAY }, 'updated'), null);
  assert.equal(versionsMatch([], { range: false, date: TODAY }, 'updated'), null);
});

test('date filtering only starts on supported model pages and domains', () => {
  assert.equal(supportedPage({ hostname: 'civitai.com', pathname: '/models' }), true);
  assert.equal(supportedPage({ hostname: 'civitai.red', pathname: '/models/123' }), true);
  assert.equal(supportedPage({ hostname: 'civitai.com', pathname: '/user/name' }), false);
  assert.equal(supportedPage({ hostname: 'other.example', pathname: '/models' }), false);
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : force;
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.listeners = {}; this.classList = new FakeClassList(); this.hidden = false;
    this.textContent = ''; this.value = ''; this.checked = false;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = value; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() { this.removed = true; }
  fire(name) { this.listeners[name]?.({ target: this }); }
}

function setup(options = {}) {
  const elements = [];
  const document = {
    head: new FakeElement('head'), body: new FakeElement('body'),
    createElement(tag) { const el = new FakeElement(tag); elements.push(el); return el; }
  };
  const store = new Map();
  const storage = options.storage || {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); }
  };
  const window = {
    location: { hostname: 'civitai.com', pathname: '/models' },
    setTimeout(callback, delay) { return setTimeout(callback, delay); },
    fetch() { throw new Error('unexpected fetch'); }
  };
  const card = options.card || { modelId: 77, cardElement: new FakeElement('article') };
  const cards = options.cards || [card];
  let fetches = 0;
  const api = createDateFilter({
    window, document, storage, getCards: () => cards, now: () => new Date('2026-10-19T01:00:00Z'),
    fetchImpl: async () => { fetches++; return { ok: true, status: 200, json: async () => ({ modelVersions: [{ createdAt: start }] }) }; },
    isApiVersionListComplete: () => true,
    ...options
  });
  return { api, card, document, elements, storage, store, get fetches() { return fetches; }, window };
}

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
}

test('controller gates unseen recording until a complete matching result and preserves unknown cards', async () => {
  const ctx = setup({ isApiVersionListComplete: () => false });
  assert.equal(ctx.api.supported, true);
  assert.equal(ctx.api.canRecordSeen(77), false);
  await flush();
  assert.equal(ctx.api.getStatus(77), 'unknown');
  assert.equal(ctx.card.cardElement.classList.contains('civitai-date-filter-hidden'), false);
  assert.equal(ctx.api.canRecordSeen(77), false);
  assert.equal(ctx.fetches, 1);
  ctx.api.destroy();
});

test('controller hides only a confirmed mismatch and exposes a matching card to SeenTracker', async () => {
  const ctx = setup({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({
    modelVersions: [{ createdAt: '2026-10-18T14:59:59Z' }]
  }) }) });
  await flush();
  assert.equal(ctx.api.getStatus(77), 'nonmatching');
  assert.equal(ctx.card.cardElement.classList.contains('civitai-date-filter-hidden'), true);
  assert.equal(ctx.api.canRecordSeen(77), false);
  ctx.api.destroy();

  const matching = setup();
  await flush();
  assert.equal(matching.api.getStatus(77), 'matching');
  assert.equal(matching.card.cardElement.classList.contains('civitai-date-filter-hidden'), false);
  assert.equal(matching.api.canRecordSeen(77), true);
  matching.api.destroy();
});

test('turning the filter off restores cards and returns SeenTracker to its ordinary recording behavior', async () => {
  const ctx = setup();
  const toggle = ctx.elements.find(element => element.attributes['aria-label'] === '日付フィルターを有効にする');
  toggle.checked = false;
  toggle.fire('change');
  await flush();
  assert.equal(ctx.api.isEnabled(), false);
  assert.equal(ctx.card.cardElement.classList.contains('civitai-date-filter-hidden'), false);
  assert.equal(ctx.api.canRecordSeen(77), true);
  assert.equal(JSON.parse(ctx.storage.getItem('civitai_date_filter_settings')).enabled, false);
  ctx.api.destroy();
});

test('selection is retained for same-day reloads and resets to JST today after a new day', async () => {
  const first = setup();
  const input = first.elements.find(element => element.attributes['aria-label'] === '対象日');
  input.value = '2026-10-18'; input.fire('change');
  const saved = first.storage.getItem('civitai_date_filter_settings');
  first.api.destroy();

  const sameDay = setup({ storage: first.storage });
  assert.equal(sameDay.elements.find(element => element.attributes['aria-label'] === '対象日').value, '2026-10-18');
  sameDay.api.destroy();

  const nextDay = setup({ storage: first.storage, now: () => new Date('2026-10-20T01:00:00Z') });
  assert.equal(nextDay.elements.find(element => element.attributes['aria-label'] === '対象日').value, '2026-10-20');
  assert.ok(saved);
  nextDay.api.destroy();
});

test('filter activation requests cancellation of an active SeenTracker jump', () => {
  let cancelled = 0;
  const ctx = setup({ shouldStopJump: () => { cancelled++; } });
  const toggle = ctx.elements.find(element => element.attributes['aria-label'] === '日付フィルターを有効にする');
  toggle.checked = true; toggle.fire('change');
  assert.equal(cancelled, 1);
  ctx.api.destroy();
});

test('API requests are deduplicated by model ID and limited to two concurrent requests', async () => {
  const cards = [77, 77, 78, 79].map(modelId => ({ modelId, cardElement: new FakeElement('article') }));
  const pending = new Map();
  let active = 0, maxActive = 0, requestCount = 0;
  const fetchImpl = path => {
    const id = Number(path.split('/').pop());
    requestCount++; active++; maxActive = Math.max(maxActive, active);
    return new Promise(resolve => pending.set(id, body => { active--; resolve({
      ok: true, status: 200, json: async () => body
    }); }));
  };
  const ctx = setup({ cards, fetchImpl });
  await flush();
  assert.equal(requestCount, 2);
  assert.equal(maxActive, 2);
  pending.get(77)({ modelVersions: [{ createdAt: start }] });
  await flush();
  assert.equal(requestCount, 3);
  pending.get(78)({ modelVersions: [{ createdAt: start }] });
  pending.get(79)({ modelVersions: [{ createdAt: start }] });
  await flush();
  assert.equal(maxActive, 2);
  ctx.api.destroy();
});

test('turning filtering off aborts in-flight date requests', async () => {
  let requestSignal;
  const ctx = setup({ fetchImpl: (_path, init) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  } });
  await flush();
  const toggle = ctx.elements.find(element => element.attributes['aria-label'] === '日付フィルターを有効にする');
  toggle.checked = false; toggle.fire('change');
  await flush();
  assert.equal(requestSignal.aborted, true);
  assert.equal(ctx.api.canRecordSeen(77), true);
  ctx.api.destroy();
});
