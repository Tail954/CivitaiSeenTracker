// ==UserScript==
// @name         Civitai Seen Tracker
// @namespace    http://tampermonkey.net/
// @version      0.20
// @description  Tracks seen models on Civitai
// @author       Antigravity
// @match        https://civitai.com/*
// @match        https://civitai.red/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/Tail954/CivitaiSeenTracker/master/civitai-seen-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/Tail954/CivitaiSeenTracker/master/civitai-seen-tracker.user.js
// ==/UserScript==

(function () {
    'use strict';

    // SPA遷移や同一ページでの再実行で、UI・Observer・履歴フックを重複させない。
    const INSTANCE_KEY = Symbol.for('CivitaiSeenTracker.instance');
    if (window[INSTANCE_KEY]) return;

    const SEEN_OPACITY = '0.3';
    const STORAGE_KEY = 'civitai_seen_models';
    const BOUNDARY_WINDOW_SIZE = 20;    // スライディングウィンドウのカード数
    const BOUNDARY_THRESHOLD = 0.80;    // 既読率の閾値（80%）
    const MIN_CARDS_BEFORE_CHECK = 10;  // 境界チェック開始までの最小カード数
    const CARD_LINK_SELECTOR = 'a[href^="/models/"]';
    const OVERLAY_SELECTOR = '.mantine-Drawer-root, .mantine-Drawer-body, .mantine-Popover-dropdown, .mantine-Modal-root, [role="dialog"], [role="presentation"]';
    const JUMP_EXCLUSION_SELECTOR = `${OVERLAY_SELECTOR}, nav, header, footer`;

    const seenModels = createSeenStore();
    let activeScrollSession = null;
    const dateFilterApi = createCivitaiDateFilterModule();
    // 2026-10-19: user verified model 1593793 on both hosts against the detail UI.
    const DATE_API_CONTRACTS = { 'civitai.com': 'detail-v1-2026-10-19', 'civitai.red': 'detail-v1-2026-10-19' };
    const dateCardListeners = new Set();
    let dateFilter = null;
    let cardTracker = null;
    const dateFilterLoadDay = dateFilterApi.jstToday(new Date());

    function getDateCards() {
        const cards = new Map();
        const unsafe = new Set();
        for (const { modelId, link } of getModelCardLinks()) {
            const cardElement = getCardElement(link);
            if (cards.has(cardElement) && cards.get(cardElement).modelId !== modelId) unsafe.add(cardElement);
            cards.set(cardElement, { modelId, link, cardElement });
        }
        return [...cards.values()].filter(card => !unsafe.has(card.cardElement));
    }

    function cancelAutoScroll() {
        activeScrollSession = null;
        const btn = document.getElementById('civitai-jump-btn');
        if (btn) setJumpButtonScrolling(btn, false);
    }

    function updateJumpAvailability() {
        const btn = document.getElementById('civitai-jump-btn');
        if (!btn) return;
        btn.disabled = Boolean(dateFilter?.isEnabled());
        btn.setAttribute('aria-disabled', String(btn.disabled));
        btn.title = btn.disabled ? '日付フィルターをOFFにするとジャンプできます' : '前回の閲覧境界までスクロール';
    }

    function syncDateFilterPage() {
        if (!dateFilterApi.supportedPage(window.location)) {
            if (dateFilter) {
                dateFilter.destroy();
                dateFilter = null;
                cardTracker?.recheck();
            }
        } else if (!dateFilter) {
            dateFilter = dateFilterApi.createDateFilter({
                window, document, storage: localStorage, getCards: getDateCards,
                loadDay: dateFilterLoadDay,
                apiContractKey: DATE_API_CONTRACTS[window.location.hostname],
                isApiVersionListComplete(body, id) {
                    if (!DATE_API_CONTRACTS[window.location.hostname] || String(body?.id) !== id
                        || !Array.isArray(body.modelVersions) || !body.modelVersions.length) return false;
                    const ids = body.modelVersions.map(version => version?.id);
                    return ids.every(value => Number.isInteger(value) && value > 0) && new Set(ids).size === ids.length
                        && !body.metadata?.nextPage && body.hasMore !== true;
                },
                onCardsChanged(listener) {
                    dateCardListeners.add(listener);
                    return () => dateCardListeners.delete(listener);
                },
                shouldStopJump: cancelAutoScroll,
                onEligibilityChanged(modelId) {
                    cardTracker?.recheck(modelId);
                    updateJumpAvailability();
                }
            });
        }
        updateJumpAvailability();
    }

    // 永続化: 既存のJSON配列・ID型・保存順序を維持し、新規閲覧時のみ書き込む。
    function createSeenStore() {
        const models = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
        return {
            has: modelId => models.has(modelId),
            get size() { return models.size; },
            remember(modelId) {
                if (models.has(modelId)) return;
                models.add(modelId);
                localStorage.setItem(STORAGE_KEY, JSON.stringify([...models]));
            }
        };
    }

    // UI/CSS: 表示とジャンプ中のボタン状態だけを扱う。
    function installStyles() {
        const style = document.createElement('style');
        style.textContent = `
        body:not(.civitai-user-page) .civitai-seen-card {
            opacity: ${SEEN_OPACITY} !important;
            transition: opacity 0.5s ease; 
            filter: grayscale(100%);
        }
        body:not(.civitai-user-page) .civitai-seen-card:hover {
            opacity: 1 !important;
            filter: grayscale(0%);
        }
        #civitai-jump-btn {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 99999;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border: none;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
            font-size: 20px;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
            opacity: 0.85;
        }
        #civitai-jump-btn:hover {
            transform: scale(1.12);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.55);
            opacity: 1;
        }
        #civitai-jump-btn:active {
            transform: scale(0.95);
        }
        #civitai-jump-btn.scrolling {
            background: linear-gradient(135deg, #f59e0b, #ef4444);
            animation: civitai-pulse 1s infinite;
        }
        @keyframes civitai-pulse {
            0%, 100% { box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4); }
            50% { box-shadow: 0 6px 24px rgba(245, 158, 11, 0.7); }
        }
        #civitai-jump-btn .btn-icon {
            pointer-events: none;
        }
        #civitai-jump-tooltip {
            position: fixed;
            bottom: 136px;
            right: 20px;
            z-index: 99999;
            background: rgba(0, 0, 0, 0.8);
            color: #fff;
            font-size: 12px;
            padding: 6px 10px;
            border-radius: 6px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        #civitai-jump-btn:hover + #civitai-jump-tooltip {
            opacity: 1;
        }
        .civitai-last-seen-highlight {
            outline: 3px solid #6366f1 !important;
            outline-offset: 2px;
            animation: civitai-highlight-fade 3s ease forwards;
        }
        @keyframes civitai-highlight-fade {
            0% { outline-color: #6366f1; }
            70% { outline-color: #6366f1; }
            100% { outline-color: transparent; }
        }
    `;
        document.head.appendChild(style);
    }

    function setJumpButtonScrolling(btn, scrolling) {
        btn.classList.toggle('scrolling', scrolling);
        btn.querySelector('.btn-icon').textContent = scrolling ? '⏹' : '⏬';
    }

    function highlightCard(link) {
        const card = getCardElement(link);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('civitai-last-seen-highlight');
        setTimeout(() => card.classList.remove('civitai-last-seen-highlight'), 3500);
    }

    // v0.20では、既読CSSの対象とジャンプボタンの表示対象が異なる。
    function isJumpEnabledPage() {
        const path = window.location.pathname;
        return path === '/' || path.startsWith('/models');
    }

    function updatePageState() {
        document.body.classList.toggle('civitai-user-page', window.location.pathname.startsWith('/user/'));

        const btn = document.getElementById('civitai-jump-btn');
        if (btn) {
            btn.style.display = isJumpEnabledPage() ? 'flex' : 'none';
        }
        syncDateFilterPage();
    }

    function installPageLifecycle() {
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function () {
                original.apply(this, arguments);
                updatePageState();
            };
        }
        window.addEventListener('popstate', updatePageState);
        updatePageState();
    }

    // カード識別: 監視とジャンプは同じID/カード判定を使い、除外範囲だけを分ける。
    function getModelId(link) {
        const href = link.getAttribute('href');
        return href?.match(/\/models\/(\d+)/)?.[1] || null;
    }

    function isModelCardLink(link, exclusions = OVERLAY_SELECTOR) {
        if (link.tagName !== 'A' || !link.getAttribute('href')?.startsWith('/models/')) return false;
        if (link.closest(exclusions)) return false;
        const isImageCard = typeof link.className === 'string' && link.className.includes('AspectRatioImageCard');
        return isImageCard || link.querySelector('img') !== null;
    }

    function getCardElement(linkElement) {
        let card = linkElement.closest('.mantine-Card-root, .mantine-Paper-root, article');
        if (!card) card = linkElement.parentElement?.parentElement;
        return card || linkElement;
    }

    function applySeenStyle(cardElement) {
        cardElement.classList.add('civitai-seen-card');
    }

    // 閲覧登録: 画面進入で保存、退出で表示反映。ジャンプ中の進入は保存しない。
    function handleCardIntersections(entries) {
        entries.forEach(entry => {
            const element = entry.target; // <a> tag
            const modelId = getModelId(element);
            if (!modelId) return;

            // 画面に入った時 (Intersecting: true)
            if (entry.isIntersecting) {
                // 自動スクロール中は既読に追加しない（通過しただけのモデルを既読にしない）
                if (!activeScrollSession && (!dateFilter || dateFilter.canRecordSeen(modelId))) {
                    seenModels.remember(modelId);
                }
            }
            // 画面から出た時 (Intersecting: false)
            // ここでスタイルを適用する
            else {
                if (seenModels.has(modelId)) {
                    const card = getCardElement(element);
                    if (!card.classList.contains('civitai-seen-card')) {
                        applySeenStyle(card);
                    }
                }
            }
        });
    }

    // DOM追跡: Observerの生成・追加ノード走査・初回/遅延走査の所有者を一箇所にする。
    function startCardTracking() {
        const observedIds = new WeakMap();
        const observer = new IntersectionObserver(handleCardIntersections, {
            root: null,
            rootMargin: '0px',
            threshold: 0 // 1ピクセルでも見えなくなったら反応
        });

        function processNode(node) {
            if (!isModelCardLink(node)) {
                if (observedIds.has(node)) {
                    observer.unobserve(node);
                    observedIds.delete(node);
                    delete node.dataset.civitaiSeenObserver;
                    getCardElement(node).classList.remove('civitai-seen-card');
                }
                return;
            }

            const modelId = getModelId(node);
            if (node.dataset.civitaiSeenObserver) {
                if (observedIds.get(node) !== modelId) {
                    const card = getCardElement(node);
                    card.classList.toggle('civitai-seen-card', seenModels.has(modelId));
                    observedIds.set(node, modelId);
                    observer.unobserve(node);
                    observer.observe(node);
                }
                return;
            }
            node.dataset.civitaiSeenObserver = 'true';
            observedIds.set(node, modelId);

            // 過去に閲覧済みのものは、最初から薄くする
            if (modelId && seenModels.has(modelId)) {
                const card = getCardElement(node);
                applySeenStyle(card);
            }

            observer.observe(node);
        }

        function scanDocument(rootNode) {
            const links = rootNode.querySelectorAll ? rootNode.querySelectorAll(CARD_LINK_SELECTOR) : [];
            links.forEach(processNode);
            processNode(rootNode);
        }

        const mutationObserver = new MutationObserver((mutations) => {
            let changed = false;
            mutations.forEach(mutation => {
                if (mutation.type !== 'attributes') {
                    const enclosingLink = mutation.target?.closest?.(CARD_LINK_SELECTOR);
                    if (enclosingLink) { processNode(enclosingLink); changed = true; }
                }
                if (mutation.type === 'attributes') {
                    processNode(mutation.target);
                    changed = true;
                }
                (mutation.addedNodes || []).forEach(node => {
                    if (node.nodeType !== 1) return;
                    scanDocument(node);
                    if (node.matches?.(CARD_LINK_SELECTOR) || node.querySelector?.(CARD_LINK_SELECTOR)) changed = true;
                });
                (mutation.removedNodes || []).forEach(node => {
                    if (node.nodeType !== 1) return;
                    const links = [...(node.matches?.(CARD_LINK_SELECTOR) ? [node] : []), ...node.querySelectorAll(CARD_LINK_SELECTOR)];
                    if (links.length) changed = true;
                    for (const link of links) {
                        if (link.isConnected) continue;
                        observer.unobserve(link);
                        observedIds.delete(link);
                        delete link.dataset.civitaiSeenObserver;
                    }
                });
            });
            if (changed) for (const listener of dateCardListeners) listener();
        });

        mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

        // 遅延実行で確実にDOM取得
        setTimeout(() => scanDocument(document.body), 1000);
        scanDocument(document.body);
        return {
            recheck(modelId) {
                for (const link of document.querySelectorAll(CARD_LINK_SELECTOR)) {
                    if (!link.dataset.civitaiSeenObserver || (modelId && getModelId(link) !== modelId)) continue;
                    observer.unobserve(link);
                    observer.observe(link);
                }
            }
        };
    }

    // --- ジャンプボタン ---

    /**
     * DOM上のモデルカードリンクを取得（フィード上の画像カードのみ、DOM順）
     */
    function getModelCardLinks() {
        const links = document.querySelectorAll(CARD_LINK_SELECTOR);
        const result = [];
        for (const link of links) {
            if (!isModelCardLink(link, JUMP_EXCLUSION_SELECTOR)) continue;
            const modelId = getModelId(link);
            if (modelId) result.push({ modelId, link });
        }
        return result;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getScrollContainer() {
        return document.querySelector('.scroll-area[scrollable="true"], .scroll-area') || document.documentElement;
    }

    // 境界判定とエラー検出は、スクロールセッションの進行から分離する。
    function checkBoundary(cardSequence) {
        if (cardSequence.length < MIN_CARDS_BEFORE_CHECK) {
            return { found: false, ratio: 0, total: cardSequence.length };
        }
        const windowStart = Math.max(0, cardSequence.length - BOUNDARY_WINDOW_SIZE);
        const windowCards = cardSequence.slice(windowStart);
        const seenCount = windowCards.filter(c => seenModels.has(c.modelId)).length;
        const ratio = seenCount / windowCards.length;
        return { found: ratio >= BOUNDARY_THRESHOLD, ratio, total: cardSequence.length };
    }

    function detectFetchError() {
        const notifications = document.querySelectorAll('.mantine-Notification-root, [class*="Notification"], [role="alert"]');
        for (const n of notifications) {
            const text = n.textContent || '';
            if (text.includes('Failed to fetch') || text.includes('failed to fetch') || text.includes('エラー')) {
                return true;
            }
        }
        return false;
    }

    // スクロール: 収集順序・重複排除・待機・停止条件はセッションごとに保持する。
    async function autoScrollToBoundary() {
        if (dateFilter && !dateFilter.canJump()) return;
        if (seenModels.size === 0) {
            alert('まだ閲覧履歴がありません。');
            return;
        }

        const scrollContainer = getScrollContainer();
        const btn = document.getElementById('civitai-jump-btn');

        // スクロール中にもう一度押したら中止
        if (activeScrollSession) {
            cancelAutoScroll();
            return;
        }

        // 中止後すぐ再開しても、待機中の旧ループが新セッションに復帰しない。
        const session = {};
        const isCurrentSession = () => activeScrollSession === session;
        function finishScrolling() {
            if (!isCurrentSession()) return false;
            activeScrollSession = null;
            setJumpButtonScrolling(btn, false);
            return true;
        }

        const MAX_ATTEMPTS = 300;
        const SCROLL_STEP_PX = 3000;
        const SCROLL_WAIT_MS = 2000;
        const RETRY_WAIT_MS = 3500;
        const ERROR_WAIT_MS = 8000;
        const MAX_SAME_HEIGHT = 8;
        const HEIGHT_CHANGE_THRESHOLD = 200;
        const MAX_ELAPSED_MS = 90000;
        const MAX_STALE_ROUNDS = 5;

        let attempts = 0;
        let prevHeight = 0;
        let sameHeightCount = 0;
        const startTime = Date.now();
        let prevUniqueCount = 0;
        let staleUniqueCount = 0;

        // 境界検出用
        const cardSequence = [];              // DOM順に収集したカード { modelId, link }
        const collectedModelIds = new Set();  // 重複防止
        let lastUnseenCard = null;            // 最後に検出した未読カード { link, modelId }

        // 現在DOMにあるモデルカードを収集し、シーケンスに追加
        function collectNewCards() {
            const cards = getModelCardLinks();
            for (const { modelId, link } of cards) {
                if (collectedModelIds.has(modelId)) continue;
                collectedModelIds.add(modelId);
                cardSequence.push({ modelId, link });
                if (!seenModels.has(modelId)) {
                    lastUnseenCard = { link, modelId };
                }
            }
        }

        // スクロール停止のヘルパー関数
        function stopScrolling(message, logMessage) {
            if (!finishScrolling()) return;
            alert(message);
            console.log(`[Seen Tracker] ${logMessage}`);
        }

        // 境界到達時に最後の未読カードにスクロール＆ハイライト
        function scrollToLastUnseen(boundary) {
            if (!finishScrolling()) return;

            const elapsed = Date.now() - startTime;

            if (lastUnseenCard && lastUnseenCard.link.isConnected) {
                highlightCard(lastUnseenCard.link);
            } else if (lastUnseenCard) {
                console.log('[Seen Tracker] 最後の未読カードはDOMから離脱済み。現在位置で停止。');
            }

            console.log(`[Seen Tracker] 既読境界に到達: 既読率 ${(boundary.ratio * 100).toFixed(0)}%, ${boundary.total}枚チェック, ${attempts}回スクロール, ${Math.round(elapsed / 1000)}秒`);
            if (lastUnseenCard) {
                console.log(`[Seen Tracker] 最後の未読カード: Model #${lastUnseenCard.modelId}`);
            }
        }

        // === 開始前チェック: 画面上に既に境界がないか ===
        collectNewCards();
        const preCheck = checkBoundary(cardSequence);
        if (preCheck.found) {
            if (lastUnseenCard) {
                highlightCard(lastUnseenCard.link);
                console.log(`[Seen Tracker] スクロール不要: 既読境界は画面内に存在 (既読率: ${(preCheck.ratio * 100).toFixed(0)}%, 最後の未読: Model #${lastUnseenCard.modelId})`);
            } else {
                alert('新着コンテンツはありません。すべて閲覧済みです。');
                console.log(`[Seen Tracker] 新着なし: すべてのカードが既読 (${preCheck.total}枚チェック)`);
            }
            return;
        }

        // === メインスクロールループ開始 ===
        activeScrollSession = session;
        setJumpButtonScrolling(btn, true);

        console.log(`[Seen Tracker] 自動スクロール開始: 既読境界を検索 (既読数: ${seenModels.size})`);

        while (isCurrentSession() && attempts < MAX_ATTEMPTS) {
            attempts++;

            // エラートースト検知
            if (detectFetchError()) {
                console.log(`[Seen Tracker] [${attempts}] APIエラー検知 - ${ERROR_WAIT_MS}ms 待機します...`);
                await sleep(ERROR_WAIT_MS);
                if (!isCurrentSession()) return;
                const closeButtons = document.querySelectorAll('.mantine-Notification-root button[aria-label="close"], .mantine-Notification-root [class*="closeButton"]');
                closeButtons.forEach(b => b.click());
                await sleep(500);
                if (!isCurrentSession()) return;
                continue;
            }

            // 段階的にスクロール
            const currentScrollTop = scrollContainer.scrollTop || scrollContainer.scrollY || 0;
            const maxScroll = scrollContainer.scrollHeight - (scrollContainer.clientHeight || window.innerHeight);
            const targetScroll = Math.min(currentScrollTop + SCROLL_STEP_PX, maxScroll);
            scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
            await sleep(SCROLL_WAIT_MS);

            if (!isCurrentSession()) return;

            // 「Load More」系ボタンがあればクリック
            const loadMoreBtn = document.querySelector('button[data-testid="loadMore"], button:has(> span:only-child)');
            if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
                const btnText = loadMoreBtn.textContent.toLowerCase();
                if (btnText.includes('load more') || btnText.includes('もっと') || btnText.includes('show more')) {
                    loadMoreBtn.click();
                    console.log(`[Seen Tracker] [${attempts}] Load More ボタンをクリック`);
                    await sleep(RETRY_WAIT_MS);
                }
            }

            if (!isCurrentSession()) return;

            // 新しいカードを収集＆境界チェック
            collectNewCards();
            const boundary = checkBoundary(cardSequence);
            if (boundary.found) {
                scrollToLastUnseen(boundary);
                return;
            }

            // === 停止条件チェック ===
            const elapsed = Date.now() - startTime;

            // 停止条件1: 絶対タイムアウト
            if (elapsed >= MAX_ELAPSED_MS) {
                stopScrolling(
                    `既読境界が見つかりませんでした。\nタイムアウト（90秒）に到達しました。\n(${cardSequence.length}枚チェック済み)`,
                    `タイムアウト: ${Math.round(elapsed / 1000)}秒経過 (${attempts}回試行, ${cardSequence.length}枚チェック)。`
                );
                return;
            }

            // 停止条件2: ユニークモデル数が増えない
            if (collectedModelIds.size <= prevUniqueCount) {
                staleUniqueCount++;
            } else {
                staleUniqueCount = 0;
            }
            prevUniqueCount = collectedModelIds.size;

            if (staleUniqueCount >= MAX_STALE_ROUNDS) {
                stopScrolling(
                    '既読境界が見つかりませんでした。\nページの末尾に到達したか、閲覧履歴が不足しています。',
                    `ユニークモデル数停滞: ${staleUniqueCount}回連続変化なし (${cardSequence.length}枚チェック, ${attempts}回試行, ${Math.round(elapsed / 1000)}秒)。`
                );
                return;
            }

            // scrollHeight による停止条件（フォールバック）
            const currentHeight = scrollContainer.scrollHeight;
            const heightDiff = Math.abs(currentHeight - prevHeight);
            const isHeightUnchanged = heightDiff <= HEIGHT_CHANGE_THRESHOLD;

            if (isHeightUnchanged) {
                sameHeightCount++;
                if (sameHeightCount >= MAX_SAME_HEIGHT) {
                    stopScrolling(
                        '既読境界が見つかりませんでした。\nページの末尾に到達したか、閲覧履歴が不足しています。',
                        `高さ未変化: ${sameHeightCount}回連続 (${cardSequence.length}枚チェック, ${attempts}回試行, ${Math.round(elapsed / 1000)}秒)。`
                    );
                    return;
                }
                scrollContainer.scrollBy({ top: -300, behavior: 'instant' });
                await sleep(500);
                if (!isCurrentSession()) return;
                scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
                await sleep(RETRY_WAIT_MS);
                if (!isCurrentSession()) return;
            } else {
                sameHeightCount = 0;
            }
            prevHeight = currentHeight;

            // 定期ログ出力
            if (attempts % 5 === 0) {
                console.log(`[Seen Tracker] [${attempts}] 経過: ${Math.round(elapsed / 1000)}秒, チェック済み: ${cardSequence.length}枚, 既読率: ${(boundary.ratio * 100).toFixed(0)}%, 高さ停滞: ${sameHeightCount}/${MAX_SAME_HEIGHT}, モデル停滞: ${staleUniqueCount}/${MAX_STALE_ROUNDS}`);
            }
        }

        // ループを抜けた（中止または最大試行回数到達）
        if (!finishScrolling()) return;
        if (attempts >= MAX_ATTEMPTS) {
            console.log(`[Seen Tracker] 最大スクロール回数に到達しました。(${cardSequence.length}枚チェック)`);
        }
    }

    function createJumpButton() {
        const btn = document.createElement('button');
        btn.id = 'civitai-jump-btn';
        btn.title = '前回の閲覧境界までスクロール';
        btn.innerHTML = '<span class="btn-icon">⏬</span>';
        btn.addEventListener('click', () => autoScrollToBoundary());

        const tooltip = document.createElement('div');
        tooltip.id = 'civitai-jump-tooltip';
        tooltip.textContent = seenModels.size > 0
            ? `既読: ${seenModels.size}件`
            : '閲覧履歴なし';

        document.body.appendChild(btn);
        document.body.appendChild(tooltip);

        // ボタン生成時に表示状態を更新
        updatePageState();
    }

    // BEGIN GENERATED DATE FILTER MODULE
    /*
     * Civitai date filter. Sol-B supplies:
     * getCards() -> [{ modelId, link, cardElement }],
     * onCardsChanged(callback) -> unsubscribe function,
     * getCompletePageDates(card) -> { complete: true, versions: [{ createdAt }] } | null,
     * shouldStopJump(), onEligibilityChanged(modelId?), apiContractKey, loadDay,
     * and isApiVersionListComplete(responseBody, modelId).
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
                shouldStopJump = () => {}, onEligibilityChanged = () => {},
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
                element.classList.toggle('civitai-date-filter-hidden', !visible && state.enabled);
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
                const message = `読み込み済み ${cards.length}・表示 ${matching + pending + failed}・不一致 ${nonmatching}・判定待ち ${pending}・未判定 ${failed}${notice ? `・${notice}` : ''}`;
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
                        element.classList.remove('civitai-date-filter-hidden');
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
                for (const id of statuses.keys()) if (!currentIds.has(id)) statuses.delete(id);
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
                    for (const element of touchedCards) element.classList.remove('civitai-date-filter-hidden');
                    touchedCards.clear();
                    button?.remove(); panel?.remove(); styleNode?.remove();
                }
            };
        }

        return { createDateFilter, dateMatches, jstDayStart, jstToday, normalizeRange, supportedPage, validDate, versionsMatch };
    }
    // END GENERATED DATE FILTER MODULE

    // 起動順序と遅延時間を維持し、すべての初期化をこの入口に集約する。
    function initialize() {
        installStyles();
        installPageLifecycle();
        cardTracker = startCardTracking();
        window.addEventListener('pagehide', () => {
            cancelAutoScroll();
            dateFilter?.destroy();
            dateFilter = null;
        });
        window.addEventListener('pageshow', syncDateFilterPage);
        setTimeout(createJumpButton, 1500);
        window[INSTANCE_KEY] = true;
        console.log('Civitai Seen Tracker v0.20 (visibility-control) started');
    }

    initialize();
})();
