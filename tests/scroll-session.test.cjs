const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHarness } = require('./harness.cjs');

const root = path.join(__dirname, '..');
const ref = process.env.SEEN_TRACKER_SOURCE_REF;
const source = ref
    ? execFileSync('git', ['show', `${ref}:civitai-seen-tracker.user.js`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'civitai-seen-tracker.user.js'), 'utf8');

for (const host of ['civitai.com', 'civitai.red']) {
    function scenario(name, run) {
        test(`${host}: session cancellation: ${name}`, async () => {
            const h = createHarness(source, { host, saved: ['99'], cards: ['1'] });
            await h.advance(1500);
            await run(h);
        });
    }
    function assertActive(h) {
        assert.equal(h.button().classList.contains('scrolling'), true);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏹');
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['99'], 'the active jump must continue suppressing seen writes');
    }
    async function cancelAndDrain(h, ...runs) {
        await h.button().click();
        assert.equal(h.button().classList.contains('scrolling'), false);
        assert.equal(h.button().querySelector('.btn-icon').textContent, '⏬');
        const calls = h.scrolls.length;
        await h.advance(12000);
        await Promise.all(runs);
        assert.equal(h.scrolls.length, calls, 'cancelled sessions must not scroll again');
        assert.equal(h.alerts.length, 0);
        h.enter(h.initialCards[0].link);
        assert.deepEqual(h.stored(), ['99', '1']);
    }
    function addError(h) {
        const notice = h.document.body.appendChild(h.document.createElement('div'));
        notice.className = 'mantine-Notification-root';
        notice.textContent = 'Failed to fetch';
        const close = notice.appendChild(h.document.createElement('button'));
        close.setAttribute('aria-label', 'close');
        let closed = 0;
        close.addEventListener('click', () => { closed++; notice.parentElement.removeChild(notice); });
        return { get closed() { return closed; } };
    }

    scenario('restart during normal scroll wait retires the old loop without resetting new UI', async h => {
        const first = h.button().click();
        await h.advance(100);
        await h.button().click();
        const second = h.button().click();
        assert.equal(h.scrolls.length, 2);
        await h.advance(1900); // Only the old session's 2000ms wait has expired.
        assert.equal(h.scrolls.length, 2);
        assertActive(h);
        await first;
        await h.advance(100); // The new session now performs exactly one next step.
        assert.equal(h.scrolls.length, 3);
        await cancelAndDrain(h, second);
    });

    scenario('restart during fetch-error wait lets only the new session dismiss the toast', async h => {
        const error = addError(h);
        const first = h.button().click();
        await h.advance(100);
        await h.button().click();
        const second = h.button().click();
        await h.advance(7900);
        assert.equal(error.closed, 0);
        assert.equal(h.scrolls.length, 0);
        assertActive(h);
        await first;
        await h.advance(600);
        assert.equal(error.closed, 1);
        assert.equal(h.scrolls.length, 1);
        await cancelAndDrain(h, second);
    });

    scenario('restart during post-toast pause cannot resume the old error loop', async h => {
        const error = addError(h);
        const first = h.button().click();
        await h.advance(8000);
        assert.equal(error.closed, 1);
        await h.button().click();
        const second = h.button().click();
        assert.equal(h.scrolls.length, 1);
        await h.advance(500);
        assert.equal(h.scrolls.length, 1);
        assertActive(h);
        await first;
        await cancelAndDrain(h, second);
    });

    scenario('restart during Load More wait prevents stale collection and cleanup', async h => {
        const loadMore = h.document.body.appendChild(h.document.createElement('button'));
        loadMore.setAttribute('data-testid', 'loadMore');
        loadMore.textContent = 'Load More';
        let clicks = 0;
        loadMore.addEventListener('click', () => { clicks++; });
        h.document.body.appendChild(h.button()); // Site content precedes the injected fixed button.
        const first = h.button().click();
        await h.advance(2000);
        assert.equal(clicks, 1);
        await h.advance(50);
        await h.button().click();
        loadMore.style.display = 'none';
        const second = h.button().click();
        await h.advance(3450);
        assert.equal(h.scrolls.length, 3);
        assert.equal(clicks, 1);
        assertActive(h);
        await first;
        await cancelAndDrain(h, second);
    });

    scenario('restart during height-retry pause prevents the stale jump to page bottom', async h => {
        const first = h.button().click();
        await h.advance(4000);
        assert.equal(h.scrolls.at(-1).by, true);
        await h.advance(50);
        await h.button().click();
        const second = h.button().click();
        const calls = h.scrolls.length;
        await h.advance(450);
        assert.equal(h.scrolls.length, calls);
        assertActive(h);
        await first;
        await cancelAndDrain(h, second);
    });

    scenario('restart during height-retry load wait prevents stale continuation', async h => {
        const first = h.button().click();
        await h.advance(4500);
        assert.equal(h.scrolls.at(-1).top, h.document.documentElement.scrollHeight);
        await h.advance(100);
        await h.button().click();
        const second = h.button().click();
        const calls = h.scrolls.length;
        await h.advance(3400);
        assert.equal(h.scrolls.length, calls + 1);
        assertActive(h);
        await first;
        await cancelAndDrain(h, second);
    });
}
