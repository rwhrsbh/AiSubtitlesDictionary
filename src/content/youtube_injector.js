// Main content script

// Inject the network interceptor into the main world
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/network_interceptor.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

let capturedSubtitleUrl = null;
let isAiSubtitlesActive = false;

// Listen for the intercepted URL
window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data.type && event.data.type === 'AISUB_INTERCEPT_URL') {
        console.log('Captured Subtitle URL:', event.data.url);
        capturedSubtitleUrl = event.data.url;

        // If we are active, fetch and render immediately
        if (isAiSubtitlesActive) {
            fetchAndRenderSubtitles(capturedSubtitleUrl);
        }
    }
});

function waitForElement(selector, callback) {
    const element = document.querySelector(selector);
    if (element) {
        callback(element);
        return;
    }

    const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
            obs.disconnect();
            callback(element);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function createAiButton() {
    const btn = document.createElement('button');
    btn.className = 'ytp-button aisub-toggle-btn';
    btn.dataset.title = 'AI Subtitles';
    btn.setAttribute('aria-label', 'AI Subtitles');
    btn.setAttribute('title', 'AI Subtitles');
    btn.innerHTML = `
        <svg height="100%" version="1.1" viewBox="6 6 24 24" width="100%">
            <path d="M11,11 L25,11 L25,25 L11,25 Z" fill="none" stroke="currentColor" stroke-width="2" />
            <text x="13" y="22" font-size="10" fill="currentColor" font-weight="bold">AI</text>
        </svg>
    `;

    btn.onclick = toggleAiSubtitles;
    return btn;
}

async function toggleAiSubtitles() {
    isAiSubtitlesActive = !isAiSubtitlesActive;
    const btn = document.querySelector('.aisub-toggle-btn');
    if (btn) {
        btn.classList.toggle('aisub-active', isAiSubtitlesActive);
    }

    if (isAiSubtitlesActive) {
        console.log('AI Subtitles Activated');
        // 1. Check if native subs are on
        const nativeBtn = document.querySelector('.ytp-subtitles-button');
        if (nativeBtn) {
            const isPressed = nativeBtn.getAttribute('aria-pressed') === 'true';

            if (!isPressed) {
                // If off, click to trigger request
                console.log('Native subs off, clicking to trigger request...');
                nativeBtn.click();

                // Wait a bit for request to fire, then turn off if we want to hide native
                // But we need to wait for the URL capture first.
                // The interceptor will catch it.

                // We want to hide native subs eventually.
                setTimeout(() => {
                    if (document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed') === 'true') {
                        document.querySelector('.ytp-subtitles-button').click();
                    }
                }, 2000); // Wait 2s for fetch to happen?
            } else {
                // If already on, we might already have the URL? 
                // If not, we might need to toggle off and on to re-trigger?
                // Or just assume we missed it and ask user to toggle?
                // Let's try toggling off then on.
                console.log('Native subs on, toggling to re-capture...');
                nativeBtn.click(); // Off
                setTimeout(() => {
                    nativeBtn.click(); // On
                    setTimeout(() => {
                        nativeBtn.click(); // Off again
                    }, 2000);
                }, 500);
            }
        }
    } else {
        console.log('AI Subtitles Deactivated');
        // Clear our subtitles
        const container = document.getElementById('aisub-container');
        if (container) {
            container.innerHTML = '';
            container.style.display = 'none';
        }
        // Stop rendering
        if (window.stopRenderingSubtitles) {
            window.stopRenderingSubtitles();
        }
    }
}

async function fetchAndRenderSubtitles(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();

        let events = [];
        if (url.includes('json3')) {
            const data = JSON.parse(text);
            events = data.events;
        } else {
            // XML Parser
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName('text');
            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                // Handle HTML entities and line breaks in XML
                let content = node.textContent;

                events.push({
                    tStartMs: parseFloat(node.getAttribute('start')) * 1000,
                    dDurationMs: parseFloat(node.getAttribute('dur')) * 1000,
                    segs: [{ utf8: content }]
                });
            }
        }

        // Normalize events structure
        const normalizedEvents = events.map(e => ({
            start: e.tStartMs || (e.start * 1000) || 0,
            end: (e.tStartMs || (e.start * 1000) || 0) + (e.dDurationMs || (e.dur * 1000) || 0),
            text: e.segs ? e.segs.map(s => s.utf8).join('') : (e.text || '')
        })).filter(e => e.text && e.text.trim().length > 0); // Filter empty

        window.startRenderingSubtitles(normalizedEvents);

    } catch (e) {
        console.error('Failed to fetch subtitles', e);
    }
}

// Inject button
waitForElement('.ytp-right-controls', (controls) => {
    const existing = document.querySelector('.aisub-toggle-btn');
    if (!existing) {
        const btn = createAiButton();
        // Just prepend to the beginning of right controls
        controls.insertBefore(btn, controls.firstChild);
    }
});

// Monitor URL changes (YouTube SPA navigation)
let lastVideoId = null;

function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
}

function onUrlChange() {
    const currentVideoId = getVideoId();

    // Check if video changed
    if (lastVideoId && currentVideoId !== lastVideoId) {
        console.log('[AI Subtitles] Video changed, resetting subtitles...');

        // Clear captured subtitle URL
        capturedSubtitleUrl = null;

        // Stop and clear current subtitles
        if (window.stopRenderingSubtitles) {
            window.stopRenderingSubtitles();
        }

        // If AI subtitles were active, try to load new ones
        if (isAiSubtitlesActive) {
            // Reset the button state and reactivate
            console.log('[AI Subtitles] Reactivating for new video...');
            const btn = document.querySelector('.aisub-toggle-btn');
            if (btn) {
                // Temporarily deactivate
                isAiSubtitlesActive = false;
                // Then reactivate to trigger subtitle loading
                setTimeout(() => {
                    toggleAiSubtitles();
                }, 5000); // Give YouTube time to load
            }
        }
    }

    lastVideoId = currentVideoId;
}

// Initialize
lastVideoId = getVideoId();

// Watch for URL changes using both popstate and YouTube's navigation events
window.addEventListener('popstate', onUrlChange);
window.addEventListener('yt-navigate-finish', onUrlChange);

// Also use MutationObserver on URL as fallback
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        onUrlChange();
    }
}).observe(document, { subtree: true, childList: true });
