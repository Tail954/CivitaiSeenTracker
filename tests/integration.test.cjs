const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('./harness.cjs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'civitai-seen-tracker.user.js'), 'utf8');
// Simulate a verified API contract in fixtures only. This is not live API evidence.
const fixtureSource = source.replace(/const DATE_API_CONTRACTS = [^;]+;/,
    "const DATE_API_CONTRACTS = { 'civitai.com': 'fixture-v1', 'civitai.red': 'fixture-v1' };");
assert.notEqual(fixtureSource, source);
const dates = { today: '2026-10-19T01:00:00Z', yesterday: '2026-10-18T01:00:00Z' };
const response = (id, date = dates.today, status = 200) => ({
    status, ok: status === 200,
    json: async () => ({ id: Number(id), modelVersions: [{ id: Number(id) * 10, createdAt: date, images: ['discarded'] }] })
});
const field = (h, label) => h.document.querySelectorAll('input').find(node => node.getAttribute('aria-label') === label);
const hidden = record => record.card.classList.contains('civitai-date-filter-hidden');
const seenWrites = h => h.writes.filter(write => write.key === 'civitai_seen_models');

for (const host of ['civitai.com', 'civitai.red']) {
    test(`${host}: pending/hidden/error cards cannot become seen; matching cards are re-observed`, async () => {
        const pending = new Map();
        const h = createHarness(fixtureSource, { host, dateSettings: null, saved: ['99'], cards: ['1', '2', '3'],
            fetchImpl: url => new Promise(resolve => pending.set(url.split('/').pop(), resolve)) });
        for (const { link } of h.initialCards) h.enter(link);
        assert.equal(seenWrites(h).length, 0);
        await h.advance(0);
        assert.equal(pending.size, 2);
        pending.get('1')(response(1));
        pending.get('2')(response(2, dates.yesterday));
        await h.advance(0);
        pending.get('3')(response(3, dates.today, 403));
        await h.advance(0);
        assert.equal(hidden(h.initialCards[0]), false);
        assert.equal(hidden(h.initialCards[1]), true);
        assert.equal(hidden(h.initialCards[2]), false);
        assert.ok(h.intersections[0].calls.filter(link => link === h.initialCards[0].link).length >= 2);
        for (const { link } of h.initialCards) h.enter(link);
        assert.deepEqual(h.stored(), ['99', '1']);
        const cache = JSON.parse(h.values.get('civitai_model_date_cache'));
        assert.deepEqual(Object.keys(cache['1'].versions[0]), ['createdAt']);
        await h.advance(1500);
        assert.equal(h.button().disabled, true);
        await h.button().click();
        assert.equal(h.scrolls.length, 0);
    });

    test(`${host}: OFF restores cards and recording; ON cancels a running jump`, async () => {
        const h = createHarness(fixtureSource, { host, dateSettings: null, saved: ['99'], cards: ['1'],
            fetchImpl: async () => response(1, dates.yesterday) });
        h.initialCards[0].card.style.display = 'grid';
        await h.advance(1500);
        assert.equal(hidden(h.initialCards[0]), true);
        const toggle = field(h, '日付フィルターを有効にする');
        toggle.checked = false; await toggle.dispatch('change');
        assert.equal(hidden(h.initialCards[0]), false);
        assert.equal(h.initialCards[0].card.style.display, 'grid');
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['99', '1']);
        const jump = h.button().click();
        await h.advance(0);
        assert.equal(h.button().classList.contains('scrolling'), true);
        const count = h.scrolls.length;
        toggle.checked = true; await toggle.dispatch('change');
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.button().disabled, true);
        await h.advance(10000);
        await jump;
        assert.equal(h.scrolls.length, count);
    });

    test(`${host}: SPA teardown aborts requests, restores detached cards, and creates one UI on return`, async () => {
        let signal;
        let finish;
        const h = createHarness(fixtureSource, { host, dateSettings: null, cards: ['1'],
            fetchImpl: (_url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); } });
        await h.advance(0);
        h.history.pushState({}, '', '/user/example');
        assert.equal(signal.aborted, true);
        assert.equal(h.document.getElementById('civitai-date-filter-button'), null);
        assert.equal(h.document.head.querySelectorAll('style').length, 1);
        finish(response(1)); await h.advance(0);
        assert.equal(h.values.has('civitai_model_date_cache'), false);
        h.history.pushState({}, '', '/models?sort=Newest');
        await h.advance(0);
        assert.equal(h.document.querySelectorAll('#civitai-date-filter-button').length, 1);
        assert.equal(h.document.head.querySelectorAll('style').length, 2);
        h.history.pushState({}, '', '/models/123/detail');
        assert.equal(h.document.getElementById('civitai-date-filter-button'), null);
        h.pop('/models/');
        assert.equal(h.document.querySelectorAll('#civitai-date-filter-button').length, 1);
    });

    test(`${host}: delayed old selection responses cannot hide a newly matching selection`, async () => {
        const requests = [];
        const h = createHarness(fixtureSource, { host, dateSettings: null, cards: ['1'],
            fetchImpl: (_url, init) => new Promise(resolve => requests.push({ resolve, signal: init.signal })) });
        await h.advance(0);
        const input = field(h, '対象日'); input.value = '2026-10-18'; await input.dispatch('change');
        await h.advance(0);
        assert.equal(requests[0].signal.aborted, true);
        requests[1].resolve(response(1, dates.yesterday)); await h.advance(0);
        requests[0].resolve(response(1)); await h.advance(0);
        assert.equal(hidden(h.initialCards[0]), false);
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['1']);
    });

    test(`${host}: new cards preserve earlier hidden results; href recycling is gated again`, async () => {
        let calls = 0;
        const h = createHarness(fixtureSource, { host, dateSettings: null, cards: ['1'],
            fetchImpl: async url => { calls++; return response(url.split('/').pop(), dates.yesterday); } });
        await h.advance(0);
        assert.equal(hidden(h.initialCards[0]), true);
        const second = h.addCard('2'); h.added(second.card);
        assert.equal(hidden(h.initialCards[0]), true);
        await h.advance(0);
        assert.equal(hidden(second), true);
        assert.equal(calls, 2);
        second.link.setAttribute('href', '/models/3');
        h.mutations[0].callback([{ type: 'attributes', target: second.link, attributeName: 'href' }]);
        h.enter(second.link);
        assert.equal(seenWrites(h).length, 0);
        await h.advance(0);
        assert.equal(calls, 3);
        assert.equal(hidden(second), true);
    });

    test(`${host}: 429 stops queued work; no automatic retry and explicit refresh honors the wait`, async () => {
        let calls = 0;
        const h = createHarness(fixtureSource, { host, dateSettings: null, cards: ['1', '2', '3', '4'],
            fetchImpl: async url => { calls++; return response(url.split('/').pop(), dates.today, calls <= 2 ? 429 : 200); } });
        await h.advance(0);
        assert.equal(calls, 2);
        const refresh = h.document.querySelectorAll('button').find(button => button.textContent === '再取得');
        await refresh.click(); await h.advance(0);
        assert.equal(calls, 2);
        await h.advance(60000);
        assert.equal(calls, 2);
        await refresh.click(); await h.advance(0);
        assert.equal(calls, 6);
    });
}

test('the distributed file contains the current date module without an external runtime dependency', () => {
    execFileSync(process.execPath, ['scripts/build-userscript.cjs', '--check'], { cwd: root });
});

test('an unverified host does not fetch or hide cards and clearly reports the restriction', async () => {
    let calls = 0;
    const unverified = source.replace(/const DATE_API_CONTRACTS = [^;]+;/,
        "const DATE_API_CONTRACTS = { 'civitai.com': '', 'civitai.red': '' };");
    const h = createHarness(unverified, { dateSettings: null, cards: ['1'], fetchImpl: async () => { calls++; return response(1); } });
    await h.advance(0);
    assert.equal(calls, 0);
    assert.equal(hidden(h.initialCards[0]), false);
    h.enter(h.initialCards[0].link);
    assert.deepEqual(h.stored(), []);
    assert.ok(h.document.querySelectorAll('p').some(node => node.textContent.includes('未検証')));
});

test('the distributed configuration enables the user-verified API contract on both hosts', async () => {
    for (const host of ['civitai.com', 'civitai.red']) {
        let calls = 0;
        const h = createHarness(source, { host, dateSettings: null, cards: ['1'],
            fetchImpl: async () => { calls++; return response(1); } });
        await h.advance(0);
        assert.equal(calls, 1);
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['1']);
    }
});

test('a timed-out request releases a queue slot and remains visible and unrecorded', async () => {
    const pending = new Map();
    const h = createHarness(fixtureSource, { dateSettings: null, cards: ['1', '2', '3'],
        fetchImpl: url => new Promise(resolve => pending.set(url.split('/').pop(), resolve)) });
    await h.advance(0);
    assert.equal(pending.size, 2);
    await h.advance(15000);
    assert.equal(pending.size, 3);
    for (const { link } of h.initialCards) h.enter(link);
    assert.deepEqual(h.stored(), []);
    pending.get('3')(response(3)); await h.advance(0);
    h.enter(h.initialCards[2].link);
    assert.deepEqual(h.stored(), ['3']);
});

test('a shrinking feed cannot schedule more than 100 date requests without explicit refresh', async () => {
    let calls = 0;
    const h = createHarness(fixtureSource, { dateSettings: null, cards: Array.from({ length: 120 }, (_, i) => String(i + 1)),
        fetchImpl: async url => { calls++; return response(url.split('/').pop(), dates.yesterday); } });
    for (let i = 0; i < 80; i++) await h.advance(0);
    assert.equal(calls, 100);
    assert.equal(hidden(h.initialCards[119]), false);
    const refresh = h.document.querySelectorAll('button').find(button => button.textContent === '再取得');
    await refresh.click();
    for (let i = 0; i < 80; i++) await h.advance(0);
    assert.equal(calls, 200);
    assert.equal(hidden(h.initialCards[119]), true);
});

test('SPA re-entry across JST midnight keeps the original page selection', async () => {
    const h = createHarness(fixtureSource, { dateSettings: null, cards: ['1'], fetchImpl: async () => response(1) });
    await h.advance(24 * 60 * 60 * 1000);
    h.history.pushState({}, '', '/user/example');
    h.history.pushState({}, '', '/models');
    assert.equal(field(h, '対象日').value, '2026-10-19');
});

test('removed/recycled cards are restored and removed pending requests are aborted', async () => {
    let pendingSignal;
    const h = createHarness(fixtureSource, { dateSettings: null, cards: ['1', '2'], fetchImpl: async (url, init) => {
        if (url.endsWith('/2')) { pendingSignal = init.signal; return new Promise(() => {}); }
        return response(1, dates.yesterday);
    } });
    await h.advance(0);
    assert.equal(hidden(h.initialCards[0]), true);
    const removed = h.initialCards[1].card;
    removed.remove();
    h.mutations[0].callback([{ addedNodes: [], removedNodes: [removed] }]);
    assert.equal(pendingSignal.aborted, true);
    assert.equal(h.intersections[0].targets.has(h.initialCards[1].link), false);
    const first = h.initialCards[0];
    first.link.setAttribute('href', '/images/other');
    h.mutations[0].callback([{ type: 'attributes', target: first.link, attributeName: 'href' }]);
    assert.equal(hidden(first), false);
    assert.equal(h.intersections[0].targets.has(first.link), false);
});

test('an image inserted later into an existing link becomes a tracked and filtered card', async () => {
    let calls = 0;
    const h = createHarness(fixtureSource, { dateSettings: null, cards: [{ id: '1', image: false }],
        fetchImpl: async () => { calls++; return response(1, dates.yesterday); } });
    await h.advance(0);
    assert.equal(calls, 0);
    const link = h.initialCards[0].link;
    const image = link.appendChild(h.document.createElement('img'));
    h.mutations[0].callback([{ type: 'childList', target: link, addedNodes: [image] }]);
    assert.equal(h.intersections[0].targets.has(link), true);
    h.enter(link);
    assert.deepEqual(h.stored(), []);
    await h.advance(0);
    assert.equal(calls, 1);
    assert.equal(hidden(h.initialCards[0]), true);
});
