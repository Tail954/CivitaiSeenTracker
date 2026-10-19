const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const source = process.env.SEEN_TRACKER_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.SEEN_TRACKER_SOURCE_REF}:civitai-seen-tracker.user.js`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'civitai-seen-tracker.user.js'), 'utf8');
const reply = (id, status = 200) => ({ status, ok: status === 200,
    json: async () => ({ id: Number(id), modelVersions: [{ id: Number(id) * 10,
        createdAt: id === '1' ? '2026-10-19T01:00:00Z' : '2026-10-17T01:00:00Z' }] }) });

for (const host of ['civitai.com', 'civitai.red']) {
    test(`${host}: exclusions cannot collapse virtualized tiles and trigger repeated remounts`, async () => {
        let requests = 0;
        const h = createHarness(source, { host, dateSettings: null, cards: ['1', '2', '3'],
            fetchImpl: async url => { requests++; return reply(url.split('/').pop()); } });
        await h.advance(0);
        let remounts = 0;
        // Layout surrogate: a virtualizer discards/recreates zero-size tiles.
        // Real geometry/React are outside this harness; browser retest is required.
        for (let cycle = 0; cycle < 5; cycle++) {
            const collapsed = h.document.querySelectorAll('article')
                .filter(card => card.classList.contains('civitai-date-filter-hidden'));
            for (const card of collapsed) {
                const id = card.querySelector('a').getAttribute('href').split('/').pop();
                card.remove();
                h.mutations[0].callback([{ type: 'childList', target: h.document.body, removedNodes: [card], addedNodes: [] }]);
                const replacement = h.addCard(id);
                h.added(replacement.card);
                remounts++;
            }
            await h.advance(0);
        }
        assert.equal(remounts, 0, 'filter must preserve tile dimensions');
        assert.equal(requests, 3);
        assert.equal(h.document.querySelectorAll('article').length, 3);
        for (const { link } of h.initialCards) h.enter(link);
        assert.deepEqual(h.stored(), ['1']);
        assert.ok(h.initialCards[1].card.classList.contains('civitai-date-filter-dim'));
        assert.ok(h.document.querySelectorAll('p').some(node => node.textContent.includes('黄枠')));
    });

    test(`${host}: transient remounts retain completed unknown results instead of repeating failed requests`, async () => {
        let requests = 0;
        const h = createHarness(source, { host, dateSettings: null, cards: ['2'],
            fetchImpl: async () => { requests++; return reply('2', 403); } });
        await h.advance(0);
        for (let cycle = 0; cycle < 5; cycle++) {
            const card = h.document.querySelector('article');
            card.remove();
            h.mutations[0].callback([{ type: 'childList', target: h.document.body, removedNodes: [card], addedNodes: [] }]);
            const replacement = h.addCard('2');
            h.added(replacement.card);
            await h.advance(0);
            h.enter(replacement.link);
        }
        assert.equal(requests, 1);
        assert.deepEqual(h.stored(), []);
    });
}
