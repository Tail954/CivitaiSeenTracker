const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('./harness.cjs');

const root = path.join(__dirname, '..');
const baselineRef = process.env.SEEN_TRACKER_SOURCE_REF;
const source = baselineRef
    ? execFileSync('git', ['show', `${baselineRef}:civitai-seen-tracker.user.js`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'civitai-seen-tracker.user.js'), 'utf8');

for (const host of ['civitai.com', 'civitai.red']) {
    function scenario(name, run) {
        test(`${host}: ${name}`, async () => run(options => createHarness(source, { host, ...options })));
    }

    scenario('existing string IDs load without writes; viewport entry saves once, exit applies style', make => {
        const h = make({ saved: ['1', 'legacy'], cards: ['1', '2', '3'] });
        const [old, fresh, outside] = h.initialCards;
        assert.equal(old.card.classList.contains('civitai-seen-card'), true);
        assert.equal(fresh.card.classList.contains('civitai-seen-card'), false);
        assert.equal(h.writes.length, 0);
        h.leave(outside.link);
        assert.equal(h.writes.length, 0);
        h.enter(fresh.link);
        assert.deepEqual(h.stored(), ['1', 'legacy', '2']);
        assert.equal(fresh.card.classList.contains('civitai-seen-card'), false);
        h.enter(fresh.link);
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0].key, 'civitai_seen_models');
        h.leave(fresh.link);
        assert.equal(fresh.card.classList.contains('civitai-seen-card'), true);
        assert.equal(outside.card.classList.contains('civitai-seen-card'), false);
    });

    scenario('absent history is not initialized or cleared; mixed legacy values retain type/order', make => {
        const empty = make({ saved: null });
        assert.equal(empty.writes.length, 0);
        const h = make({ saved: [5, '5', 'older', 'older'], cards: ['5', '6'] });
        h.enter(h.initialCards[1].link);
        assert.deepEqual(h.stored(), [5, '5', 'older', '6']);
    });

    scenario('card discovery excludes overlays/text/absolute links and accepts image-card classes', make => {
        const h = make({ saved: [] });
        const valid = h.addCard('10', { image: false, className: 'foo-AspectRatioImageCard-root' });
        const text = h.addCard('11', { image: false });
        const absolute = h.addCard('12', { href: `https://${host}/models/12` });
        const malformed = h.addCard('bad');
        const overlayClasses = ['mantine-Drawer-root', 'mantine-Drawer-body', 'mantine-Popover-dropdown', 'mantine-Modal-root'];
        const excluded = overlayClasses.map((className, index) => {
            const parent = h.document.createElement('div');
            parent.className = className;
            h.document.body.appendChild(parent);
            return h.addCard(String(20 + index), { parent });
        });
        for (const role of ['dialog', 'presentation']) {
            const parent = h.document.createElement('div');
            parent.setAttribute('role', role);
            h.document.body.appendChild(parent);
            excluded.push(h.addCard('30', { parent }));
        }
        h.added(h.document.body);
        const observer = h.intersections[0];
        assert.equal(observer.targets.has(valid.link), true);
        assert.equal(observer.targets.has(malformed.link), true); // Historical selector accepts nonnumeric IDs; callback ignores them.
        for (const item of [text, absolute, ...excluded]) assert.equal(observer.targets.has(item.link), false);
        h.enter(malformed.link);
        assert.equal(h.writes.length, 0);
        h.enter(valid.link);
        assert.deepEqual(h.stored(), ['10']);
    });

    scenario('initial/delayed/mutation scans observe each link once, including added anchor roots', async make => {
        const h = make({ saved: ['2'], cards: ['1'] });
        const added = h.addCard('2');
        h.added(added.card, added.link, { nodeType: 3 });
        h.added(added.card);
        await h.advance(1000);
        assert.equal(h.intersections.length, 1);
        assert.equal(h.mutations.length, 1);
        assert.equal(h.intersections[0].calls.length, 2);
        assert.equal(added.card.classList.contains('civitai-seen-card'), true);
        assert.equal(h.mutations[0].calls[0].target, h.document.body);
        assert.equal(h.mutations[0].calls[0].options.subtree, true);
        assert.deepEqual(JSON.parse(JSON.stringify(h.intersections[0].options)), { root: null, rootMargin: '0px', threshold: 0 });
    });

    scenario('card style targets Mantine Card/Paper/article, then grandparent or anchor fallback', make => {
        const h = make({ saved: ['1', '2', '3', '4', '5'] });
        const items = [
            h.addCard('1'),
            h.addCard('2', { cardClass: 'mantine-Paper-root', cardTag: 'section' }),
            h.addCard('3', { cardClass: '', cardTag: 'article' }),
            h.addCard('4', { cardClass: '', cardTag: 'section' })
        ];
        h.added(...items.map(item => item.card));
        for (const { card } of items) assert.equal(card.classList.contains('civitai-seen-card'), true);
        const detached = h.document.createElement('a');
        detached.setAttribute('href', '/models/5');
        detached.className = 'AspectRatioImageCard';
        h.added(detached);
        assert.equal(detached.classList.contains('civitai-seen-card'), true);
    });

    scenario('SPA push/replace/pop control CSS and button without recreating observers or UI', async make => {
        const h = make({ path: '/user/example' });
        await h.advance(1500);
        assert.equal(h.button().style.display, 'none');
        for (const pathname of ['/', '/models', '/models?sort=Newest', '/models/123', '/models-other']) {
            h.history.pushState({}, '', pathname);
            assert.equal(h.document.body.classList.contains('civitai-seen-enabled'), true);
            assert.equal(h.button().style.display, 'flex');
        }
        h.history.replaceState({}, '', '/images');
        assert.equal(h.button().style.display, 'none');
        assert.equal(h.document.body.classList.contains('civitai-seen-enabled'), false);
        h.pop('/models');
        assert.equal(h.button().style.display, 'flex');
        assert.equal(h.events.get('popstate').length, 1);
        assert.equal(h.intersections.length, 1);
        assert.equal(h.document.querySelectorAll('#civitai-jump-btn').length, 1);
        assert.equal(h.writes.length, 0);
    });

    scenario('existing non-list pages keep their original history registration behavior', async make => {
        const h = make({ path: '/user/example', cards: ['1'] });
        await h.advance(1500);
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['1']);
        assert.equal(h.document.body.classList.contains('civitai-seen-enabled'), false);
    });

    scenario('stylesheet retains dimming, grayscale, hover restoration and highlight rules', make => {
        const h = make();
        const css = h.document.head.querySelector('style').textContent;
        assert.match(css, /body\.civitai-seen-enabled \.civitai-seen-card\s*\{[^}]*opacity: 0\.3 !important;[^}]*filter: grayscale\(100%\)/);
        assert.match(css, /body\.civitai-seen-enabled \.civitai-seen-card:hover\s*\{[^}]*opacity: 1 !important;[^}]*filter: grayscale\(0%\)/);
        assert.match(css, /\.civitai-last-seen-highlight\s*\{/);
        assert.match(source, new RegExp(`// @match\\s+https://${host.replace('.', '\\.')}\x2f\\*`));
    });

    scenario('jump with no history alerts and leaves scroll/storage untouched', async make => {
        const h = make();
        await h.advance(1500);
        await h.button().click();
        assert.deepEqual(h.alerts, ['まだ閲覧履歴がありません。']);
        assert.equal(h.scrolls.length, 0);
        assert.equal(h.writes.length, 0);
        assert.equal(h.document.getElementById('civitai-jump-tooltip').textContent, '閲覧履歴なし');
    });

    scenario('preloaded boundary needs ten cards and 80% seen; highlights last unseen and clears', async make => {
        const h = make({ saved: Array.from({ length: 8 }, (_, i) => String(i + 1)), cards: Array.from({ length: 10 }, (_, i) => String(i + 1)) });
        await h.advance(1500);
        await h.button().click();
        const last = h.initialCards[9].card;
        assert.equal(h.scrolls.length, 1);
        assert.equal(h.scrolls[0].element, last);
        assert.equal(h.scrolls[0].intoView, true);
        assert.equal(last.classList.contains('civitai-last-seen-highlight'), true);
        await h.advance(3500);
        assert.equal(last.classList.contains('civitai-last-seen-highlight'), false);
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.writes.length, 0);
        assert.equal(h.document.getElementById('civitai-jump-tooltip').textContent, '既読: 8件');
    });

    scenario('all-seen preloaded boundary reports no new content', async make => {
        const ids = Array.from({ length: 10 }, (_, i) => String(i + 1));
        const h = make({ saved: ids, cards: ids });
        await h.advance(1500);
        await h.button().click();
        assert.deepEqual(h.alerts, ['新着コンテンツはありません。すべて閲覧済みです。']);
        assert.equal(h.scrolls.length, 0);
    });

    scenario('fewer than ten cards or less than 80% seen cannot stop the jump early', async make => {
        for (const [seenCount, cardCount] of [[9, 9], [7, 10]]) {
            const h = make({
                saved: Array.from({ length: seenCount }, (_, i) => String(i + 1)),
                cards: Array.from({ length: cardCount }, (_, i) => String(i + 1))
            });
            await h.advance(1500);
            const pending = h.button().click();
            assert.equal(h.button().classList.contains('scrolling'), true);
            assert.equal(h.scrolls[0].intoView, undefined);
            await h.button().click();
            await h.advance(2000);
            await pending;
            assert.equal(h.alerts.length, 0);
        }
    });

    scenario('jump uses the site scroll area and clamps movement at its maximum', async make => {
        const h = make({ saved: ['99'], cards: ['1'] });
        const area = h.document.body.appendChild(h.document.createElement('div'));
        area.className = 'scroll-area';
        area.setAttribute('scrollable', 'true');
        area.scrollTop = 8000;
        area.scrollHeight = 10000;
        area.clientHeight = 1000;
        await h.advance(1500);
        const pending = h.button().click();
        assert.equal(h.scrolls[0].element, area);
        assert.equal(h.scrolls[0].top, 9000);
        await h.button().click();
        await h.advance(2000);
        await pending;
    });

    scenario('jump excludes nav/header/footer candidates but tracking keeps existing broader scope', async make => {
        const ids = Array.from({ length: 10 }, (_, i) => String(i + 1));
        const h = make({ saved: ids });
        const excluded = [];
        for (const tag of ['nav', 'header', 'footer']) {
            const parent = h.document.body.appendChild(h.document.createElement(tag));
            for (const id of ids) excluded.push(h.addCard(id, { parent }));
        }
        h.added(h.document.body);
        assert.equal(h.intersections[0].targets.size, 30);
        await h.advance(1500);
        const pending = h.button().click();
        assert.equal(h.button().classList.contains('scrolling'), true);
        assert.equal(h.scrolls[0].intoView, undefined);
        await h.button().click();
        await h.advance(2000);
        await pending;
    });

    scenario('jump suspends new seen registration; second click cancels and restores button', async make => {
        const h = make({ saved: ['99'], cards: ['1'] });
        await h.advance(1500);
        const pending = h.button().click();
        assert.equal(h.button().classList.contains('scrolling'), true);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏹');
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['99']);
        await h.button().click();
        await h.advance(2000);
        await pending;
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏬');
        assert.equal(h.scrolls.length, 1);
        assert.equal(h.alerts.length, 0);
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['99', '1']);
    });

    scenario('infinite-scroll additions reach boundary using last twenty unique IDs', async make => {
        const ids = Array.from({ length: 16 }, (_, i) => String(i + 100));
        const h = make({ saved: ids, cards: ['1', '2', '3', '4'] });
        await h.advance(1500);
        const pending = h.button().click();
        const added = ids.map(id => h.addCard(id));
        h.added(...added.map(item => item.card));
        h.added(h.addCard('100').card); // Duplicate ID must not inflate the boundary window.
        await h.advance(2000);
        await pending;
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.scrolls.at(-1).element, h.initialCards[3].card);
        assert.match(h.logs.at(-2), /80%, 20枚チェック/);
        assert.equal(h.writes.length, 0);
    });

    scenario('boundary window drops older unseen cards; disconnected last unseen is safe', async make => {
        const ids = Array.from({ length: 20 }, (_, i) => String(i + 100));
        const h = make({ saved: ids, cards: Array.from({ length: 10 }, (_, i) => String(i + 1)) });
        await h.advance(1500);
        const pending = h.button().click();
        h.initialCards[9].card.parentElement.removeChild(h.initialCards[9].card);
        const added = ids.map(id => h.addCard(id));
        h.added(...added.map(item => item.card));
        await h.advance(2000);
        await pending;
        assert.equal(h.scrolls.filter(item => item.intoView).length, 0);
        assert.ok(h.logs.some(message => message.includes('DOMから離脱済み')));
        assert.equal(h.button().classList.contains('scrolling'), false);
    });

    scenario('visible Load More is clicked; delayed cards are collected after retry wait', async make => {
        const ids = Array.from({ length: 8 }, (_, i) => String(i + 100));
        const h = make({ saved: ids, cards: ['1', '2'] });
        const loadMore = h.document.body.appendChild(h.document.createElement('button'));
        loadMore.setAttribute('data-testid', 'loadMore');
        loadMore.textContent = 'Load More';
        let clicks = 0;
        loadMore.addEventListener('click', () => {
            clicks++;
            h.added(...ids.map(id => h.addCard(id).card));
        });
        await h.advance(1500);
        const pending = h.button().click();
        await h.advance(2000);
        assert.equal(clicks, 1);
        assert.equal(h.button().classList.contains('scrolling'), true);
        await h.advance(3500);
        await pending;
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.scrolls.at(-1).element, h.initialCards[1].card);
    });

    scenario('end of content stops on stale IDs and restores button', async make => {
        const h = make({ saved: ['99'], cards: ['1'] });
        await h.advance(1500);
        const pending = h.button().click();
        await h.advance(60000);
        await pending;
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏬');
        assert.match(h.alerts[0], /ページの末尾/);
        assert.ok(h.logs.some(message => message.includes('ユニークモデル数停滞')));
        assert.equal(h.writes.length, 0);
    });

    scenario('continuous new content without a boundary stops at the 90-second timeout', async make => {
        const h = make({ saved: ['99'], cards: ['1'] });
        await h.advance(1500);
        const pending = h.button().click();
        for (let round = 0; round < 45; round++) {
            h.added(h.addCard(String(1000 + round)).card);
            h.document.documentElement.scrollHeight += 3000;
            await h.advance(2000);
        }
        await pending;
        assert.match(h.alerts[0], /タイムアウト（90秒）/);
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏬');
        assert.equal(h.writes.length, 0);
    });

    scenario('fetch-error toast waits then closes and resumes; cancellation settles cleanly', async make => {
        const h = make({ saved: ['99'], cards: ['1'] });
        const notice = h.document.body.appendChild(h.document.createElement('div'));
        notice.className = 'mantine-Notification-root';
        notice.textContent = 'Failed to fetch';
        const close = notice.appendChild(h.document.createElement('button'));
        close.setAttribute('aria-label', 'close');
        close.addEventListener('click', () => notice.parentElement.removeChild(notice));
        await h.advance(1500);
        const pending = h.button().click();
        assert.equal(h.scrolls.length, 0);
        await h.advance(7999);
        assert.equal(notice.isConnected, true);
        await h.advance(501);
        assert.equal(notice.isConnected, false);
        assert.equal(h.scrolls.length, 1);
        await h.button().click();
        await h.advance(2000);
        await pending;
        assert.equal(h.button().classList.contains('scrolling'), false);
    });
}

test('domains retain separate origin-local histories', () => {
    const com = createHarness(source, { host: 'civitai.com', saved: ['1'], cards: ['2'] });
    const red = createHarness(source, { host: 'civitai.red', saved: ['3'], cards: ['4'] });
    com.enter(com.initialCards[0].link);
    assert.deepEqual(com.stored(), ['1', '2']);
    assert.deepEqual(red.stored(), ['3']);
    red.enter(red.initialCards[0].link);
    assert.deepEqual(com.stored(), ['1', '2']);
    assert.deepEqual(red.stored(), ['3', '4']);
});

// This is an intentional Phase 0 lifecycle improvement, separate from the
// characterization cases above, which must also pass on the supplied baseline.
if (!baselineRef) {
    test('distribution metadata and entire injected CSS match the supplied v0.21 baseline', () => {
        const original = execFileSync('git', ['show', '9e7072364a9f64ccc17869eb4a02b5bfa05d9007:civitai-seen-tracker.user.js'], { cwd: root, encoding: 'utf8' });
        const metadata = script => script.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0].replace(/\r\n/g, '\n');
        assert.equal(metadata(source), metadata(original));
        const before = createHarness(original);
        const after = createHarness(source);
        assert.equal(after.document.head.querySelector('style').textContent, before.document.head.querySelector('style').textContent);
    });

    test('repeated script initialization creates no duplicate UI, observers, timers or history hooks', async () => {
        const h = createHarness(source, { saved: ['1'], cards: ['1'] });
        const pushState = h.history.pushState;
        const replaceState = h.history.replaceState;
        h.run();
        await h.advance(2000);
        h.run();
        assert.equal(h.history.pushState, pushState);
        assert.equal(h.history.replaceState, replaceState);
        assert.equal(h.events.get('popstate').length, 1);
        assert.equal(h.intersections.length, 1);
        assert.equal(h.mutations.length, 1);
        assert.equal(h.intersections[0].calls.length, 1);
        assert.equal(h.document.head.querySelectorAll('style').length, 1);
        assert.equal(h.document.querySelectorAll('#civitai-jump-btn').length, 1);
        assert.equal(h.document.querySelectorAll('#civitai-jump-tooltip').length, 1);
        assert.equal(h.writes.length, 0);
    });
}
