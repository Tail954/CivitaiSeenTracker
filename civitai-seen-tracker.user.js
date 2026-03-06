// ==UserScript==
// @name         Civitai Seen Tracker
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Tracks seen models on Civitai
// @author       Antigravity
// @match        https://civitai.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const SEEN_OPACITY = '0.3';
    const STORAGE_KEY = 'civitai_seen_models';

    let seenModels = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));

    const style = document.createElement('style');
    style.textContent = `
        .civitai-seen-card {
            opacity: ${SEEN_OPACITY} !important;
            transition: opacity 0.5s ease; 
            filter: grayscale(100%);
        }
        .civitai-seen-card:hover {
            opacity: 1 !important;
            filter: grayscale(0%);
        }
    `;
    document.head.appendChild(style);

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
            // リストに追加するだけ（まだ薄くしない）
            if (entry.isIntersecting) {
                if (!seenModels.has(modelId)) {
                    seenModels.add(modelId);
                    saveSeenModels();
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

    console.log('Civitai Seen Tracker v0.3 (Scroll-Out) started');
})();