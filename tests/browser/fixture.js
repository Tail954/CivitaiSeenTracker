const area = document.querySelector('.scroll-area');
const results = document.querySelector('#results');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const readSeen = () => JSON.parse(localStorage.getItem('civitai_seen_models') || '[]');
function addCard(id) {
    const card = document.createElement('article');
    const link = card.appendChild(document.createElement('a'));
    link.className = 'AspectRatioImageCard';
    link.href = `/models/${id}`;
    link.textContent = `Synthetic model ${id}`;
    area.appendChild(card);
    return { card, link };
}
async function until(predicate) {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Browser state timed out');
        await wait(50);
    }
}
function check(name, condition) {
    const line = document.createElement('li');
    line.className = condition ? 'pass' : 'fail';
    line.textContent = `${condition ? 'PASS' : 'FAIL'} — ${name}`;
    results.appendChild(line);
    if (!condition) throw new Error(name);
}
async function loadTracker() {
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/tracker.js';
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}

document.querySelector('#run').addEventListener('click', async () => {
    document.querySelector('#run').disabled = true;
    const done = document.querySelector('#done');
    try {
        // This origin is a dedicated ephemeral loopback fixture, never a real site.
        localStorage.setItem('civitai_seen_models', '["99"]');
        history.replaceState({}, '', '/models');
        const first = addCard('1');
        for (let id = 2; id <= 6; id++) addCard(String(id));
        await loadTracker();
        await until(() => document.getElementById('civitai-jump-btn') && readSeen().includes('1'));
        const btn = document.getElementById('civitai-jump-btn');
        check('Real IntersectionObserver saves a card on entry; legacy ID survives', readSeen().includes('99') && readSeen().includes('1'));
        area.scrollTo({ top: 500, behavior: 'instant' });
        await until(() => first.card.classList.contains('civitai-seen-card'));
        await until(() => Math.abs(Number(getComputedStyle(first.card).opacity) - 0.3) < 0.01);
        check('Real exit applies dimming and grayscale', getComputedStyle(first.card).filter === 'grayscale(1)');

        const added = addCard('7');
        await until(() => added.link.dataset.civitaiSeenObserver === 'true');
        check('Real MutationObserver observes added cards without marking offscreen cards seen', !readSeen().includes('7'));
        area.scrollTo({ top: area.scrollHeight, behavior: 'instant' });
        await until(() => readSeen().includes('7'));
        area.scrollTo({ top: 0, behavior: 'instant' });
        await until(() => added.card.classList.contains('civitai-seen-card'));
        check('Dynamically added card is saved on entry and styled on exit', readSeen().includes('7'));

        history.pushState({}, '', '/user/fixture');
        check('v0.20 user page disables seen CSS and hides jump', getComputedStyle(first.card).opacity === '1' && getComputedStyle(btn).display === 'none');
        history.replaceState({}, '', '/images');
        await until(() => Math.abs(Number(getComputedStyle(first.card).opacity) - 0.3) < 0.01);
        check('v0.20 images page keeps seen CSS and hides jump', getComputedStyle(btn).display === 'none');
        history.pushState({}, '', '/models');
        check('SPA models route restores jump button', getComputedStyle(btn).display === 'flex');
        await loadTracker();
        check('Repeated load has one button and one injected style', document.querySelectorAll('#civitai-jump-btn').length === 1 && [...document.querySelectorAll('style')].filter(style => style.textContent.includes('civitai-highlight-fade')).length === 1);

        addCard('8');
        await wait(100);
        const scrollTo = area.scrollTo.bind(area);
        let scrollCalls = 0;
        area.scrollTo = options => { scrollCalls++; scrollTo(options); };
        btn.click();
        await wait(100);
        btn.click();
        check('Cancellation immediately restores jump UI', !btn.classList.contains('scrolling') && btn.querySelector('.btn-icon').textContent === '⏬');
        btn.click();
        await wait(2600);
        check('Rapid restart retains exactly one scrolling session', scrollCalls === 3 && btn.classList.contains('scrolling'));
        check('Real observer does not save cards passing during the jump', !readSeen().includes('8'));
        btn.click();
        const stoppedCalls = scrollCalls;
        await wait(2200);
        check('Retired sessions perform no later scroll or UI reset', scrollCalls === stoppedCalls && !btn.classList.contains('scrolling'));
        done.textContent = `${results.children.length}/${results.children.length} PASS — synthetic browser checks complete`;
    } catch (error) {
        done.textContent = `FAILED — ${error.message}`;
        done.className = 'fail';
    } finally {
        done.hidden = false;
    }
});
