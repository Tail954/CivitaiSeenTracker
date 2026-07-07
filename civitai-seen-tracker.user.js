// ==UserScript==
// @name         Civitai Seen Tracker
// @namespace    http://tampermonkey.net/
<<<<<<< HEAD
// @version      0.20
=======
// @version      0.9
>>>>>>> e24eae9d5e4530fedd7b2821540fa2600cd2fb65
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

    const SEEN_OPACITY = '0.3';
    const STORAGE_KEY = 'civitai_seen_models';
    const BOUNDARY_WINDOW_SIZE = 20;    // スライディングウィンドウのカード数
    const BOUNDARY_THRESHOLD = 0.80;    // 既読率の閾値（80%）
    const MIN_CARDS_BEFORE_CHECK = 10;  // 境界チェック開始までの最小カード数

    let seenModels = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    let isAutoScrolling = false;

    const style = document.createElement('style');
    style.textContent = `
        body.civitai-enable-seen .civitai-seen-card {
            opacity: ${SEEN_OPACITY} !important;
            transition: opacity 0.5s ease; 
            filter: grayscale(100%);
        }
        body.civitai-enable-seen .civitai-seen-card:hover {
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

    function updatePageState() {
        const path = window.location.pathname;
<<<<<<< HEAD

        if (path.startsWith('/user/')) {
            document.body.classList.add('civitai-user-page');
=======
        if (path.startsWith('/models')) {
            document.body.classList.add('civitai-enable-seen');
>>>>>>> e24eae9d5e4530fedd7b2821540fa2600cd2fb65
        } else {
            document.body.classList.remove('civitai-enable-seen');
        }

        const btn = document.getElementById('civitai-jump-btn');
        if (btn) {
            // トップページ または /models ページでのみボタンを表示
            if (path === '/' || path.startsWith('/models')) {
                btn.style.display = 'flex';
            } else {
                btn.style.display = 'none';
            }
        }
    }

    // SPAのURL変更を監視
    const originalPushState = history.pushState;
    history.pushState = function () {
        originalPushState.apply(this, arguments);
        updatePageState();
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
        originalReplaceState.apply(this, arguments);
        updatePageState();
    };
    window.addEventListener('popstate', updatePageState);
    updatePageState();

    function saveSeenModels() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...seenModels]));
    }
    function getCardElement(linkElement) {
        let card = linkElement.closest('.mantine-Card-root, .mantine-Paper-root, article');
        if (!card) card = linkElement.parentElement?.parentElement;
        return card || linkElement;
    }

    function applySeenStyle(cardElement) {
        cardElement.classList.add('civitai-seen-card');
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const element = entry.target; // <a> tag
            const href = element.getAttribute('href');
            if (!href) return;

            const match = href.match(/\/models\/(\d+)/);
            if (!match) return;
            const modelId = match[1];

            // 画面に入った時 (Intersecting: true)
            if (entry.isIntersecting) {
                // 自動スクロール中は既読に追加しない（通過しただけのモデルを既読にしない）
                if (!isAutoScrolling) {
                    if (!seenModels.has(modelId)) {
                        seenModels.add(modelId);
                        saveSeenModels();
                    }
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
    }, {
        root: null,
        rootMargin: '0px',
        threshold: 0 // 1ピクセルでも見えなくなったら反応
    });

    function processNode(node) {
        if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('/models/')) {
            // 通知パネル（ドロワーやダイアログ）の中にあるリンクは対象外にする
            if (node.closest('.mantine-Drawer-root, .mantine-Drawer-body, .mantine-Popover-dropdown, .mantine-Modal-root, [role="dialog"], [role="presentation"]')) return;

            // 画像カード以外のリンク（サイドバーの詳細用テキストリンクなど）を除外
            const isImageCard = typeof node.className === 'string' && node.className.includes('AspectRatioImageCard');
            const hasImage = node.querySelector('img') !== null;
            if (!isImageCard && !hasImage) return;

            if (node.dataset.civitaiSeenObserver) return;
            node.dataset.civitaiSeenObserver = 'true';

            const href = node.getAttribute('href');
            const match = href.match(/\/models\/(\d+)/);

            // 過去に閲覧済みのものは、最初から薄くする
            if (match && seenModels.has(match[1])) {
                const card = getCardElement(node);
                applySeenStyle(card);
            }

            observer.observe(node);
        }
    }

    function scanDocument(rootNode) {
        const links = rootNode.querySelectorAll ? rootNode.querySelectorAll('a[href^="/models/"]') : [];
        links.forEach(processNode);
        if (rootNode.tagName === 'A' && rootNode.getAttribute('href')?.startsWith('/models/')) {
            processNode(rootNode);
        }
    }

    const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) scanDocument(node);
            });
        });
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });

    // 遅延実行で確実にDOM取得
    setTimeout(() => scanDocument(document.body), 1000);
    scanDocument(document.body);

<<<<<<< HEAD
    // --- ジャンプボタン ---

    /**
     * DOM上のモデルカードリンクを取得（フィード上の画像カードのみ、DOM順）
     */
    function getModelCardLinks() {
        const links = document.querySelectorAll('a[href^="/models/"]');
        const result = [];
        for (const link of links) {
            if (link.closest('.mantine-Drawer-root, .mantine-Drawer-body, .mantine-Popover-dropdown, .mantine-Modal-root, [role="dialog"], [role="presentation"], nav, header, footer')) continue;
            const isImageCard = typeof link.className === 'string' && link.className.includes('AspectRatioImageCard');
            const hasImage = link.querySelector('img') !== null;
            if (!isImageCard && !hasImage) continue;
            const href = link.getAttribute('href');
            const match = href && href.match(/\/models\/(\d+)/);
            if (match) result.push({ modelId: match[1], link });
        }
        return result;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getScrollContainer() {
        return document.querySelector('.scroll-area[scrollable="true"], .scroll-area') || document.documentElement;
    }

    async function autoScrollToBoundary() {
        if (seenModels.size === 0) {
            alert('まだ閲覧履歴がありません。');
            return;
        }

        const scrollContainer = getScrollContainer();
        const btn = document.getElementById('civitai-jump-btn');

        // スクロール中にもう一度押したら中止
        if (isAutoScrolling) {
            isAutoScrolling = false;
            return;
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

        // 境界チェック: スライディングウィンドウの既読率を計算
        function checkBoundary() {
            if (cardSequence.length < MIN_CARDS_BEFORE_CHECK) {
                return { found: false, ratio: 0, total: cardSequence.length };
            }
            const windowStart = Math.max(0, cardSequence.length - BOUNDARY_WINDOW_SIZE);
            const windowCards = cardSequence.slice(windowStart);
            const seenCount = windowCards.filter(c => seenModels.has(c.modelId)).length;
            const ratio = seenCount / windowCards.length;
            return { found: ratio >= BOUNDARY_THRESHOLD, ratio, total: cardSequence.length };
        }

        // Civitaiのエラートーストを検知
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

        // スクロール停止のヘルパー関数
        function stopScrolling(message, logMessage) {
            isAutoScrolling = false;
            btn.classList.remove('scrolling');
            btn.querySelector('.btn-icon').textContent = '⏬';
            alert(message);
            console.log(`[Seen Tracker] ${logMessage}`);
        }

        // 境界到達時に最後の未読カードにスクロール＆ハイライト
        function scrollToLastUnseen(boundary) {
            isAutoScrolling = false;
            btn.classList.remove('scrolling');
            btn.querySelector('.btn-icon').textContent = '⏬';

            const elapsed = Date.now() - startTime;

            if (lastUnseenCard && lastUnseenCard.link.isConnected) {
                const card = getCardElement(lastUnseenCard.link);
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('civitai-last-seen-highlight');
                setTimeout(() => card.classList.remove('civitai-last-seen-highlight'), 3500);
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
        const preCheck = checkBoundary();
        if (preCheck.found) {
            if (lastUnseenCard) {
                const card = getCardElement(lastUnseenCard.link);
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('civitai-last-seen-highlight');
                setTimeout(() => card.classList.remove('civitai-last-seen-highlight'), 3500);
                console.log(`[Seen Tracker] スクロール不要: 既読境界は画面内に存在 (既読率: ${(preCheck.ratio * 100).toFixed(0)}%, 最後の未読: Model #${lastUnseenCard.modelId})`);
            } else {
                alert('新着コンテンツはありません。すべて閲覧済みです。');
                console.log(`[Seen Tracker] 新着なし: すべてのカードが既読 (${preCheck.total}枚チェック)`);
            }
            return;
        }

        // === メインスクロールループ開始 ===
        isAutoScrolling = true;
        btn.classList.add('scrolling');
        btn.querySelector('.btn-icon').textContent = '⏹';

        console.log(`[Seen Tracker] 自動スクロール開始: 既読境界を検索 (既読数: ${seenModels.size})`);

        while (isAutoScrolling && attempts < MAX_ATTEMPTS) {
            attempts++;

            // エラートースト検知
            if (detectFetchError()) {
                console.log(`[Seen Tracker] [${attempts}] APIエラー検知 - ${ERROR_WAIT_MS}ms 待機します...`);
                await sleep(ERROR_WAIT_MS);
                const closeButtons = document.querySelectorAll('.mantine-Notification-root button[aria-label="close"], .mantine-Notification-root [class*="closeButton"]');
                closeButtons.forEach(b => b.click());
                await sleep(500);
                continue;
            }

            // 段階的にスクロール
            const currentScrollTop = scrollContainer.scrollTop || scrollContainer.scrollY || 0;
            const maxScroll = scrollContainer.scrollHeight - (scrollContainer.clientHeight || window.innerHeight);
            const targetScroll = Math.min(currentScrollTop + SCROLL_STEP_PX, maxScroll);
            scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
            await sleep(SCROLL_WAIT_MS);

            if (!isAutoScrolling) break;

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

            if (!isAutoScrolling) break;

            // 新しいカードを収集＆境界チェック
            collectNewCards();
            const boundary = checkBoundary();
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
                scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
                await sleep(RETRY_WAIT_MS);
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
        isAutoScrolling = false;
        btn.classList.remove('scrolling');
        btn.querySelector('.btn-icon').textContent = '⏬';
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

    // ページ読み込み後にボタン追加
    setTimeout(createJumpButton, 1500);

    console.log('Civitai Seen Tracker v0.20 (visibility-control) started');
=======
    console.log('Civitai Seen Tracker v0.9 (Scroll-Out) started');
>>>>>>> e24eae9d5e4530fedd7b2821540fa2600cd2fb65
})();