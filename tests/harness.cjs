const vm = require('node:vm');

// A deterministic DOM/Observer/timer substitute. CSS rendering and layout are
// deliberately outside this harness; see the manual browser checklist.
function createHarness(source, { host = 'civitai.com', path = '/models', saved = [], cards = [],
    dateSettings = { enabled: false }, fetchImpl = async () => { throw new Error('Unexpected API request'); } } = {}) {
    const timers = new Map();
    const events = new Map();
    const intersections = [];
    const mutations = [];
    const writes = [];
    const alerts = [];
    const logs = [];
    const scrolls = [];
    let now = 0;
    let nextTimer = 0;
    let document;
    const epoch = Date.parse('2026-10-19T01:00:00.000Z');

    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase();
            this.nodeType = 1;
            this.children = [];
            this.parentElement = null;
            this.attributes = {};
            this.dataset = {};
            this.style = {};
            this.textContent = '';
            this.handlers = new Map();
            this.scrollTop = 0;
            this.scrollHeight = 12000;
            this.clientHeight = 1000;
            this.classList = {
                add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
                remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
                contains: name => this.className.split(/\s+/).includes(name),
                toggle: (name, enabled) => {
                    const add = enabled === undefined ? !this.classList.contains(name) : enabled;
                    this.classList[add ? 'add' : 'remove'](name);
                    return add;
                }
            };
        }
        get className() { return this.attributes.class || ''; }
        set className(value) { this.attributes.class = value; }
        get id() { return this.attributes.id || ''; }
        set id(value) { this.attributes.id = value; }
        get isConnected() {
            return this === document.documentElement || Boolean(this.parentElement?.isConnected);
        }
        get offsetParent() { return this.style.display === 'none' ? null : this.parentElement; }
        set innerHTML(value) {
            this.children = [];
            if (value.includes('btn-icon')) {
                const span = this.appendChild(new Element('span'));
                span.className = 'btn-icon';
                span.textContent = value.match(/>(.*?)</)[1];
            }
        }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        appendChild(child) {
            child.parentElement?.removeChild(child);
            this.children.push(child);
            child.parentElement = this;
            return child;
        }
        append(...children) { for (const child of children) this.appendChild(child); }
        remove() { this.parentElement?.removeChild(this); }
        removeChild(child) {
            this.children.splice(this.children.indexOf(child), 1);
            child.parentElement = null;
            return child;
        }
        matches(selector) {
            return selector.split(',').some(part => {
                const rule = part.trim();
                if (rule === 'a[href^="/models/"]') return this.tagName === 'A' && this.getAttribute('href')?.startsWith('/models/');
                if (rule === '.scroll-area[scrollable="true"]') return this.classList.contains('scroll-area') && this.getAttribute('scrollable') === 'true';
                if (rule === 'button[data-testid="loadMore"]') return this.tagName === 'BUTTON' && this.getAttribute('data-testid') === 'loadMore';
                if (rule === 'button:has(> span:only-child)') return this.tagName === 'BUTTON' && this.children.length === 1 && this.children[0].tagName === 'SPAN';
                if (rule === '.mantine-Notification-root button[aria-label="close"]') return this.tagName === 'BUTTON' && this.getAttribute('aria-label') === 'close' && this.parentElement?.closest('.mantine-Notification-root');
                if (rule === '.mantine-Notification-root [class*="closeButton"]') return this.className.includes('closeButton') && this.parentElement?.closest('.mantine-Notification-root');
                if (rule.startsWith('.')) return this.classList.contains(rule.slice(1));
                if (rule.startsWith('#')) return this.id === rule.slice(1);
                const role = rule.match(/^\[role="(.*?)"\]$/);
                if (role) return this.getAttribute('role') === role[1];
                const containsClass = rule.match(/^\[class\*="(.*?)"\]$/);
                if (containsClass) return this.className.includes(containsClass[1]);
                return this.tagName.toLowerCase() === rule;
            });
        }
        closest(selector) {
            for (let element = this; element; element = element.parentElement) {
                if (element.matches(selector)) return element;
            }
            return null;
        }
        querySelectorAll(selector) {
            const result = [];
            for (const child of this.children) {
                if (child.matches(selector)) result.push(child);
                result.push(...child.querySelectorAll(selector));
            }
            return result;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(type, handler) {
            const handlers = this.handlers.get(type) || [];
            handlers.push(handler);
            this.handlers.set(type, handlers);
        }
        click() {
            return this.dispatch('click');
        }
        dispatch(type) { return Promise.all((this.handlers.get(type) || []).map(handler => handler({ target: this }))); }
        scrollTo(options) { this.scrollTop = options.top; scrolls.push({ element: this, ...options }); }
        scrollBy(options) { this.scrollTop += options.top; scrolls.push({ element: this, by: true, ...options }); }
        scrollIntoView(options) { scrolls.push({ element: this, intoView: true, ...options }); }
    }

    document = {
        createElement: tag => new Element(tag),
        querySelectorAll: selector => document.documentElement.querySelectorAll(selector),
        querySelector: selector => document.documentElement.querySelector(selector),
        getElementById: id => document.documentElement.querySelector(`#${id}`)
    };
    document.documentElement = new Element('html');
    document.head = document.documentElement.appendChild(new Element('head'));
    document.body = document.documentElement.appendChild(new Element('body'));

    function addCard(id, { parent = document.body, image = true, className = '', href = `/models/${id}`, cardClass = 'mantine-Card-root', cardTag = 'article', nested = true } = {}) {
        const card = document.createElement(cardTag);
        card.className = cardClass;
        const link = document.createElement('a');
        link.setAttribute('href', href);
        link.className = className;
        if (image) link.appendChild(document.createElement('img'));
        if (nested) card.appendChild(document.createElement('div')).appendChild(link);
        else card.appendChild(link);
        parent.appendChild(card);
        return { card, link };
    }
    const initialCards = cards.map(card => typeof card === 'object' ? addCard(card.id, card) : addCard(card));
    const values = new Map(saved === null ? [] : [['civitai_seen_models', JSON.stringify(saved)]]);
    if (dateSettings) values.set('civitai_date_filter_settings', JSON.stringify({
        savedOn: '2026-10-19', day: '2026-10-19', ...dateSettings
    }));
    const window = {
        location: new URL(`https://${host}${path}`),
        innerHeight: 1000,
        fetch: fetchImpl,
        addEventListener(type, handler) {
            const handlers = events.get(type) || [];
            handlers.push(handler);
            events.set(type, handlers);
        }
    };
    const history = {};
    for (const method of ['pushState', 'replaceState']) {
        history[method] = function (_state, _title, url) {
            if (url !== undefined) window.location = new URL(url, window.location);
        };
    }
    const context = vm.createContext({
        window, document, history,
        localStorage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value); writes.push({ key, value }); }
        },
        IntersectionObserver: class {
            constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.calls = []; intersections.push(this); }
            observe(target) { this.targets.add(target); this.calls.push(target); }
            unobserve(target) { this.targets.delete(target); }
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.calls = []; mutations.push(this); }
            observe(target, options) { this.calls.push({ target, options }); }
        },
        setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout: id => timers.delete(id),
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [epoch + now])); }
            static now() { return epoch + now; }
        },
        AbortController,
        alert: message => alerts.push(message),
        console: { log: (...args) => logs.push(args.join(' ')) }
    });
    window.setTimeout = context.setTimeout;
    window.clearTimeout = context.clearTimeout;
    function run() { vm.runInContext(source, context, { filename: 'civitai-seen-tracker.user.js' }); }
    async function advance(ms) {
        const until = now + ms;
        for (let iterations = 0; iterations < 10000; iterations++) {
            for (let tick = 0; tick < 12; tick++) await Promise.resolve();
            const pending = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
            if (!pending.length) { now = until; await Promise.resolve(); return; }
            const [id, timer] = pending[0];
            now = timer.at;
            timers.delete(id);
            timer.callback();
        }
        throw new Error('Timer loop did not settle');
    }
    run();
    return {
        document, window, history, events, intersections, mutations, writes, alerts, logs, scrolls, initialCards, values,
        addCard, advance, run,
        stored: () => JSON.parse(values.get('civitai_seen_models') || '[]'),
        enter: link => intersections[0].callback([{ target: link, isIntersecting: true }]),
        leave: link => intersections[0].callback([{ target: link, isIntersecting: false }]),
        added: (...nodes) => mutations[0].callback([{ addedNodes: nodes }]),
        pop(pathname) { window.location = new URL(pathname, window.location); for (const handler of events.get('popstate') || []) handler(); },
        button: () => document.getElementById('civitai-jump-btn')
    };
}

module.exports = { createHarness };
