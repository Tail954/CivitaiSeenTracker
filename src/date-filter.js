/*
 * Civitai date filter. Sol-B supplies:
 * getCards() -> [{ modelId, link, cardElement }],
 * onCardsChanged(callback) -> unsubscribe function,
 * getCompletePageDates(card) -> { complete: true, versions: [{ createdAt }] } | null,
 * shouldStopJump(), onEligibilityChanged(modelId?), apiContractKey, loadDay,
 * isApiVersionListComplete(responseBody, modelId), and nonmatchingDisplay.
 */
function createCivitaiDateFilterModule() {
    'use strict';

    const SETTINGS_KEY = 'civitai_date_filter_settings';
    const CACHE_KEY = 'civitai_model_date_cache';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const RECENT_CACHE_TTL = 15 * 60 * 1000;
    const CACHE_TTL = DAY_MS;

    function timestamp(value) {
        return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
            ? Date.parse(value) : NaN;
    }

    function jstToday(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(now);
        const part = type => parts.find(item => item.type === type).value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    }

    function validDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function jstDayStart(value) {
        if (!validDate(value)) return NaN;
        return Date.parse(`${value}T00:00:00.000+09:00`);
    }

    function normalizeRange(start, end) {
        if (!validDate(start) || !validDate(end)) return null;
        return start <= end ? [start, end] : [end, start];
    }

    function dateMatches(timestamp, selection) {
        const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
        if (!Number.isFinite(value)) return false;
        const startDate = selection.range ? selection.startDate : selection.date;
        const endDate = selection.range ? selection.endDate : selection.date;
        if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return false;
        return value >= jstDayStart(startDate) && value < jstDayStart(endDate) + DAY_MS;
    }

    function versionsMatch(versions, selection, mode) {
        if (!Array.isArray(versions) || versions.length === 0) return null;
        const timestamps = versions.map(version => version && version.createdAt)
            .filter(value => Number.isFinite(timestamp(value)));
        if (!timestamps.length || timestamps.length !== versions.length) return null;
        if (mode === 'registered') {
            const earliest = Math.min(...timestamps.map(Date.parse));
            return dateMatches(earliest, selection);
        }
        return timestamps.some(timestamp => dateMatches(timestamp, selection));
    }

    function supportedPage(location) {
        return ['civitai.com', 'civitai.red'].includes(location.hostname)
            && /^\/models\/?$/.test(location.pathname);
    }

    function defaultSettings(today) {
        return {
            day: today, mode: 'updated', range: false, startDay: today, endDay: today,
            enabled: true, savedOn: today
        };
    }

    function readSettings(storage, today) {
        try {
            const value = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
            if (!value || typeof value !== 'object') return defaultSettings(today);
            const sameDay = value.savedOn === today;
            const settings = defaultSettings(today);
            settings.mode = value.mode === 'registered' ? 'registered' : 'updated';
            settings.enabled = value.enabled !== false;
            settings.range = sameDay && value.range === true;
            if (sameDay && validDate(value.day)) settings.day = value.day;
            if (sameDay && validDate(value.startDay)) settings.startDay = value.startDay;
            if (sameDay && validDate(value.endDay)) settings.endDay = value.endDay;
            return settings;
        } catch (_) {
            return defaultSettings(today);
        }
    }

    function createDateFilter(options) {
        const { window: win, document: doc, storage, getCards, onCardsChanged,
            getCompletePageDates, isApiVersionListComplete = () => false, apiContractKey = '',
            shouldStopJump = () => {}, onEligibilityChanged = () => {}, nonmatchingDisplay = 'hide',
            fetchImpl = (...args) => win.fetch(...args),
            now = () => new Date() } = options;
        if (!win || !doc || !storage || typeof getCards !== 'function') {
            throw new TypeError('window, document, storage and getCards are required');
        }
        if (!supportedPage(win.location)) return { supported: false, destroy() {} };

        const today = options.loadDay || jstToday(now());
        const state = readSettings(storage, today);
        const statuses = new Map();
        const cache = readCache(storage);
        for (const [id, entry] of Object.entries(cache)) {
            if (!Number.isFinite(entry && entry.savedAt) || now().getTime() - entry.savedAt >= CACHE_TTL) delete cache[id];
        }
        const inflight = new Map();
        const queue = [];
        const activeTasks = new Set();
        const touchedCards = new Set();
        let generation = 0;
        let destroyed = false;
        let retryAfter = 0;
        let notice = '';
        let panel;
        let statusNode;
        let button;
        let unsubscribeCards;
        let styleNode;
        let retryTimer;
        let lastSelection = '';
        let currentCards = [];
        let requestsScheduled = 0;

        function persistSettings() {
            state.savedOn = today;
            try { storage.setItem(SETTINGS_KEY, JSON.stringify(state)); }
            catch (_) { notice = '設定を保存できません'; }
        }

        function persistCache() {
            try { storage.setItem(CACHE_KEY, JSON.stringify(cache)); }
            catch (_) { notice = '日付キャッシュを保存できません'; }
        }

        function readCache(source) {
            try {
                const value = JSON.parse(source.getItem(CACHE_KEY) || '{}');
                return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            } catch (_) { return {}; }
        }

        function selection() {
            if (!state.range) return { range: false, date: state.day };
            const range = normalizeRange(state.startDay, state.endDay);
            if (!range) return null;
            state.startDay = range[0]; state.endDay = range[1];
            return { range: true, startDate: range[0], endDate: range[1] };
        }

        function cardId(card) { return String(card.modelId); }

        function cacheValid(entry, selectedDay) {
            if (!apiContractKey || !entry || entry.contract !== apiContractKey || entry.schema !== 1
                || !Number.isFinite(entry.savedAt) || !Array.isArray(entry.versions)) return false;
            const latestSelectedDay = state.range ? state.endDay : selectedDay;
            const yesterday = jstToday(new Date(jstDayStart(today) - DAY_MS));
            const ttl = latestSelectedDay >= yesterday ? RECENT_CACHE_TTL : CACHE_TTL;
            const age = now().getTime() - entry.savedAt;
            return age >= 0 && age < ttl;
        }

        function evaluate(card) {
            const id = cardId(card);
            let fromPage = null;
            try { fromPage = typeof getCompletePageDates === 'function' ? getCompletePageDates(card) : null; }
            catch (_) { return Promise.resolve(null); }
            if (fromPage && fromPage.complete === true && Array.isArray(fromPage.versions)) {
                return Promise.resolve(fromPage.versions);
            }
            const hit = cacheValid(cache[id], state.range ? state.startDay : state.day) ? cache[id] : null;
            if (hit) return Promise.resolve(hit.versions);
            if (!apiContractKey) {
                notice = 'このドメインの日付APIは未検証のため、カードを表示したままにします';
                return Promise.resolve(null);
            }
            return enqueue(id);
        }

        function enqueue(id) {
            if (inflight.has(id)) return inflight.get(id).promise;
            if (retryAfter > now().getTime()) return Promise.resolve(null);
            if (requestsScheduled >= 100) {
                notice = '取得上限に達しました。未判定カードを表示しています。必要なら「再取得」を押してください';
                return Promise.resolve(null);
            }
            requestsScheduled++;
            let resolve;
            const promise = new Promise(done => { resolve = done; });
            const controller = new AbortController();
            const task = { id, promise, resolve, controller, done: false, timeout: null };
            inflight.set(id, task);
            queue.push(task);
            pump();
            return promise;
        }

        function finishTask(task, versions) {
            if (task.done) return;
            task.done = true;
            win.clearTimeout(task.timeout);
            activeTasks.delete(task);
            if (inflight.get(task.id) === task) inflight.delete(task.id);
            task.resolve(versions);
            pump();
        }

        function cancelRequests() {
            queue.length = 0;
            for (const task of [...inflight.values()]) {
                task.controller.abort();
                finishTask(task, null);
            }
            win.clearTimeout(retryTimer);
        }

        function pauseForRateLimit(response) {
            notice = 'API制限中です。カードを表示したまま取得を停止しています';
            const header = response.headers?.get('Retry-After');
            const seconds = header != null && /^\d+$/.test(header) ? Number(header) : null;
            const specified = seconds == null ? Date.parse(header) : now().getTime() + seconds * 1000;
            retryAfter = Math.max(now().getTime() + 60_000, Number.isFinite(specified) ? specified : 0);
            // No automatic retry: explicitly retry with the panel's refresh control.
            for (const task of queue.splice(0)) finishTask(task, null);
            win.clearTimeout(retryTimer);
            retryTimer = win.setTimeout(() => {
                if (now().getTime() >= retryAfter) {
                    retryAfter = 0;
                    notice = 'API制限の待機が終わりました。「再取得」で再開できます';
                }
                renderCounts(currentCards);
            }, Math.min(2_147_483_647, retryAfter - now().getTime()));
        }

        function pump() {
            while (!destroyed && state.enabled && activeTasks.size < 2 && queue.length && now().getTime() >= retryAfter) {
                const task = queue.shift();
                if (task.done || inflight.get(task.id) !== task || task.controller.signal.aborted) continue;
                activeTasks.add(task);
                task.timeout = win.setTimeout(() => {
                    task.controller.abort();
                    notice = '日付情報の取得がタイムアウトしました';
                    finishTask(task, null);
                }, 15_000);
                Promise.resolve().then(() => {
                    if (task.done || destroyed || !state.enabled) return null;
                    return fetchImpl(`/api/v1/models/${encodeURIComponent(task.id)}`, { signal: task.controller.signal });
                })
                    .then(async response => {
                        if (task.done || !response) return null;
                        if (response.status === 429) {
                            pauseForRateLimit(response);
                            return null;
                        }
                        if (!response.ok) { notice = '日付情報を取得できないモデルがあります'; return null; }
                        const body = await response.json();
                        return !task.done && String(body && body.id) === task.id
                            && isApiVersionListComplete(body, task.id) && Array.isArray(body && body.modelVersions)
                            ? body.modelVersions : null;
                    })
                    .then(versions => {
                        if (!task.done && versions && versions.length && versionsMatch(versions, { range: false, date: today }, 'updated') !== null) {
                            versions = versions.map(({ createdAt }) => ({ createdAt }));
                            cache[task.id] = { schema: 1, contract: apiContractKey, versions, savedAt: now().getTime() };
                            const entries = Object.keys(cache).sort((a, b) => cache[b].savedAt - cache[a].savedAt);
                            for (const id of entries.slice(500)) delete cache[id];
                            persistCache();
                            return versions;
                        }
                        return null;
                    })
                    .catch(() => { if (!task.done) notice = '通信に失敗したモデルがあります'; return null; })
                    .then(versions => finishTask(task, versions));
            }
        }

        function setVisibility(card, visible) {
            const element = card.cardElement;
            if (!element || !element.classList) return;
            touchedCards.add(element);
            const excluded = !visible && state.enabled;
            element.classList.toggle('civitai-date-filter-hidden', excluded && nonmatchingDisplay !== 'dim');
            element.classList.toggle('civitai-date-filter-dim', excluded && nonmatchingDisplay === 'dim');
        }

        function restoreCard(element) {
            element.classList.remove('civitai-date-filter-hidden');
            element.classList.remove('civitai-date-filter-dim');
        }

        function renderCounts(cards) {
            if (!statusNode) return;
            let matching = 0, pending = 0, failed = 0, nonmatching = 0;
            for (const card of cards) {
                const value = statuses.get(cardId(card));
                if (value === 'matching') matching++;
                else if (value === 'nonmatching') nonmatching++;
                else if (value === 'pending') pending++;
                else if (value === 'unknown') failed++;
            }
            const displayed = nonmatchingDisplay === 'dim' ? cards.length : matching + pending + failed;
            const mode = state.enabled && nonmatchingDisplay === 'dim' ? '・不一致は黄枠の薄表示（クリック可能）' : '';
            const message = `読み込み済み ${cards.length}・表示 ${displayed}・一致 ${matching}・不一致 ${nonmatching}・判定待ち ${pending}・未判定 ${failed}${mode}${notice && cards.length ? `・${notice}` : ''}`;
            if (statusNode.textContent !== message) statusNode.textContent = message;
        }

        function apply(force = false) {
            if (destroyed) return;
            const cards = getCards().filter(card => card && card.modelId != null && card.cardElement);
            if (force) cards.sort((a, b) => Number(statuses.get(cardId(b)) === 'unknown') - Number(statuses.get(cardId(a)) === 'unknown'));
            currentCards = cards;
            const elements = new Set(cards.map(card => card.cardElement));
            for (const element of touchedCards) {
                if (!elements.has(element)) {
                    restoreCard(element);
                    touchedCards.delete(element);
                }
            }
            const selected = selection();
            const signature = JSON.stringify([state.enabled, state.mode, selected]);
            const changed = force || signature !== lastSelection;
            if (changed) {
                generation++;
                lastSelection = signature;
                cancelRequests();
                statuses.clear();
            }
            const currentIds = new Set(cards.map(cardId));
            // A virtualized list can remove and reinsert the same model. Retain
            // failed/incomplete results until explicit retry/selection change.
            // Other results are reused from the date cache with its normal TTL.
            const absent = [...statuses.keys()].filter(id => !currentIds.has(id));
            absent.forEach((id, index) => {
                if (statuses.get(id) !== 'unknown' || index < absent.length - 500) statuses.delete(id);
            });
            const obsolete = [...inflight.values()].filter(task => !currentIds.has(task.id));
            for (const task of obsolete) {
                const index = queue.indexOf(task);
                if (index >= 0) queue.splice(index, 1);
            }
            for (const task of obsolete) { task.controller.abort(); finishTask(task, null); }
            const token = generation;
            for (const card of cards) {
                const id = cardId(card);
                if (!state.enabled) {
                    statuses.set(id, 'matching');
                    setVisibility(card, true);
                    continue;
                }
                if (!selected) {
                    statuses.set(id, 'unknown');
                    setVisibility(card, true);
                    continue;
                }
                if (statuses.has(id)) {
                    setVisibility(card, statuses.get(id) !== 'nonmatching');
                    continue;
                }
                statuses.set(id, 'pending');
                setVisibility(card, true);
                evaluate(card).then(versions => {
                    if (destroyed || token !== generation || !currentCards.some(current => cardId(current) === id)) return;
                    const matched = versions && versionsMatch(versions, selected, state.mode);
                    statuses.set(id, matched === null ? 'unknown' : matched ? 'matching' : 'nonmatching');
                    for (const current of currentCards) {
                        if (cardId(current) === id) setVisibility(current, matched !== false);
                    }
                    onEligibilityChanged(id);
                    renderCounts(currentCards);
                });
            }
            if (changed) onEligibilityChanged();
            renderCounts(cards);
        }

        function make(tag, attrs = {}) {
            const node = doc.createElement(tag);
            for (const [key, value] of Object.entries(attrs)) {
                if (key === 'text') node.textContent = value;
                else if (key === 'className') node.className = value;
                else node.setAttribute(key, value);
            }
            return node;
        }

        function addControl(parent, labelText, control) {
            const label = make('label');
            label.append(make('span', { text: labelText }), control);
            parent.append(label);
        }

        function buildUi() {
            const style = make('style');
            styleNode = style;
            style.textContent = `
                #civitai-date-filter-button { position:fixed; right:76px; bottom:80px; z-index:100000; }
                #civitai-date-filter-panel { position:fixed; right:20px; bottom:190px; z-index:100001; width:min(320px,calc(100vw - 40px)); padding:14px; border-radius:10px; background:#202124; color:#fff; box-shadow:0 4px 20px #0008; font:14px/1.4 sans-serif; }
                #civitai-date-filter-panel[hidden] { display:none; }
                #civitai-date-filter-panel label { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:8px 0; }
                #civitai-date-filter-panel button { margin:3px; }
                .civitai-date-filter-hidden { display:none !important; }
                body .civitai-date-filter-dim.civitai-date-filter-dim {
                    opacity:0.45 !important; filter:none !important;
                    outline:2px dashed #e9a23b !important; outline-offset:-2px;
                }
                body .civitai-date-filter-dim.civitai-date-filter-dim:hover { opacity:0.85 !important; }
            `;
            doc.head.append(style);
            button = make('button', { id: 'civitai-date-filter-button', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'civitai-date-filter-panel', text: '' });
            panel = make('section', { id: 'civitai-date-filter-panel', role: 'region', 'aria-label': 'モデルの日付フィルター' });
            panel.hidden = true;
            button.addEventListener('click', () => {
                panel.hidden = !panel.hidden;
                button.setAttribute('aria-expanded', String(!panel.hidden));
            });
            const refreshButtonLabel = () => {
                if (state.range) {
                    const normalized = normalizeRange(state.startDay, state.endDay);
                    if (normalized) {
                        const changed = state.startDay !== normalized[0] || state.endDay !== normalized[1];
                        [state.startDay, state.endDay] = normalized;
                        if (typeof start !== 'undefined') start.value = state.startDay;
                        if (typeof end !== 'undefined') end.value = state.endDay;
                        if (changed) persistSettings();
                    }
                }
                const selectedDate = state.range ? `${state.startDay}〜${state.endDay}` : state.day;
                button.textContent = `${selectedDate} · ${state.mode === 'updated' ? '更新日' : '登録日'} · ${state.enabled ? 'ON' : 'OFF'}`;
            };
            doc.body.append(button, panel);

            const enabled = make('input', { type: 'checkbox', 'aria-label': '日付フィルターを有効にする' });
            enabled.checked = state.enabled;
            enabled.addEventListener('change', () => {
                state.enabled = enabled.checked;
                if (state.enabled) shouldStopJump();
                else {
                    cancelRequests();
                    notice = '';
                    for (const card of getCards()) setVisibility(card, true);
                }
                persistSettings(); refreshButtonLabel(); apply();
            });
            addControl(panel, 'フィルター ON', enabled);

            const mode = make('select', { 'aria-label': '日付の種類' });
            for (const [value, text] of [['updated', '更新日'], ['registered', '登録日']]) {
                const option = make('option', { value, text }); option.value = value; mode.append(option);
            }
            mode.value = state.mode;
            mode.addEventListener('change', () => { state.mode = mode.value; persistSettings(); refreshButtonLabel(); apply(); });
            addControl(panel, '判定方法', mode);

            const single = make('input', { type: 'date', 'aria-label': '対象日' }); single.value = state.day;
            const start = make('input', { type: 'date', 'aria-label': '開始日' }); start.value = state.startDay;
            const end = make('input', { type: 'date', 'aria-label': '終了日' }); end.value = state.endDay;
            const rangeToggle = make('input', { type: 'checkbox', 'aria-label': '期間を指定する' }); rangeToggle.checked = state.range;
            const dates = make('div');
            function updateDateControls() {
                single.hidden = state.range; start.hidden = !state.range; end.hidden = !state.range;
            }
            rangeToggle.addEventListener('change', () => { state.range = rangeToggle.checked; updateDateControls(); persistSettings(); refreshButtonLabel(); apply(); });
            addControl(panel, '期間指定', rangeToggle);
            single.addEventListener('change', () => { if (validDate(single.value)) { state.day = single.value; persistSettings(); refreshButtonLabel(); apply(); } });
            start.addEventListener('change', () => { if (validDate(start.value)) { state.startDay = start.value; persistSettings(); refreshButtonLabel(); apply(); } });
            end.addEventListener('change', () => { if (validDate(end.value)) { state.endDay = end.value; persistSettings(); refreshButtonLabel(); apply(); } });
            dates.append(single, start, end); panel.append(dates); updateDateControls();

            const nav = make('div');
            const move = (amount, base = state.day) => {
                const next = new Date(`${base}T12:00:00.000Z`);
                next.setUTCDate(next.getUTCDate() + amount);
                return next.toISOString().slice(0, 10);
            };
            function selectDay(day) {
                if (state.range) { state.startDay = day; state.endDay = day; start.value = day; end.value = day; }
                else { state.day = day; single.value = day; }
            }
            for (const [text, action] of [
                ['昨日', () => selectDay(move(-1, today))], ['今日', () => selectDay(today)],
                ['前日', () => {
                    if (state.range) { state.startDay = move(-1, state.startDay); state.endDay = move(-1, state.endDay); start.value = state.startDay; end.value = state.endDay; }
                    else selectDay(move(-1));
                }],
                ['翌日', () => {
                    if (state.range) { state.startDay = move(1, state.startDay); state.endDay = move(1, state.endDay); start.value = state.startDay; end.value = state.endDay; }
                    else selectDay(move(1));
                }]
            ]) {
                const control = make('button', { type: 'button', text });
                control.addEventListener('click', () => { action(); single.value = state.day; persistSettings(); refreshButtonLabel(); apply(); });
                nav.append(control);
            }
            panel.append(nav);
            const refresh = make('button', { type: 'button', text: '再取得' });
            refresh.addEventListener('click', () => {
                if (!state.enabled) return;
                if (retryAfter > now().getTime()) { notice = 'API制限の待機中です'; renderCounts(currentCards); return; }
                for (const card of getCards()) delete cache[cardId(card)];
                requestsScheduled = 0;
                notice = '';
                apply(true);
            });
            panel.append(refresh);
            refreshButtonLabel();
            statusNode = make('p', { 'aria-live': 'polite', text: '' });
            panel.append(statusNode);
        }

        function onSelectionChanged() { apply(); }
        buildUi();
        apply();
        if (typeof onCardsChanged === 'function') unsubscribeCards = onCardsChanged(onSelectionChanged);

        return {
            supported: true,
            getStatus(modelId) { return statuses.get(String(modelId)) || 'pending'; },
            canRecordSeen(modelId) {
                if (!state.enabled) return true;
                return statuses.get(String(modelId)) === 'matching';
            },
            canJump() { return !state.enabled; },
            isEnabled() { return state.enabled; },
            destroy() {
                destroyed = true;
                generation++;
                if (typeof unsubscribeCards === 'function') unsubscribeCards();
                cancelRequests();
                for (const element of touchedCards) restoreCard(element);
                touchedCards.clear();
                button?.remove(); panel?.remove(); styleNode?.remove();
            }
        };
    }

    return { createDateFilter, dateMatches, jstDayStart, jstToday, normalizeRange, supportedPage, validDate, versionsMatch };
}

// CommonJS export is excluded from the single-file userscript build.
if (typeof module === 'object' && module.exports) module.exports = createCivitaiDateFilterModule();
