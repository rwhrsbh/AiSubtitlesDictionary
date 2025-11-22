// Rezka.ag Injector

// 1. Inject the network interceptor into the main world
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/network_interceptor.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// 2. State Variables
let capturedSubtitleUrl = null;
let isAiSubtitlesActive = false;
let nativeSubObserver = null;

// 3. Message Listener for Intercepted URL
window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data.type && event.data.type === 'AISUB_INTERCEPT_URL') {
        console.log('[AiSub] Captured Subtitle URL:', event.data.url);
        capturedSubtitleUrl = event.data.url;

        // If active, immediately use the new URL
        if (isAiSubtitlesActive) {
            fetchAndRenderSubtitles(capturedSubtitleUrl);
        }
    }
});

// 4. Main Toggle Logic
async function toggleAiSubtitles() {
    isAiSubtitlesActive = !isAiSubtitlesActive;
    updateButtonState();

    if (isAiSubtitlesActive) {
        console.log('[AiSub] Activated');

        if (capturedSubtitleUrl) {
            fetchAndRenderSubtitles(capturedSubtitleUrl);
        } else {
            console.log('[AiSub] No URL yet, waiting...');
            showNotification('Waiting for subtitles...');

            // Check after delay
            setTimeout(() => {
                if (!capturedSubtitleUrl && isAiSubtitlesActive) {
                    checkNativeSubtitlesStatus();
                }
            }, 3000);
        }
    } else {
        console.log('[AiSub] Deactivated');
        if (window.stopRenderingSubtitles) {
            window.stopRenderingSubtitles();
        }
        restoreNativeSubtitles();
    }
}

function checkNativeSubtitlesStatus() {
    const nativeIcon = document.getElementById('cdnplayer_control_cc_icon0');
    if (nativeIcon && nativeIcon.classList.contains('none')) {
        showNotification('Please enable subtitles in the player to capture them.');
    } else {
        showNotification('Subtitles enabled but not detected. Please toggle them OFF and ON again.');
    }
}

// 5. Subtitle Fetching and Rendering
async function fetchAndRenderSubtitles(url) {
    try {
        const response = await fetch(url);
        const text = await response.text();
        const events = parseVTT(text);

        if (window.startRenderingSubtitles) {
            window.startRenderingSubtitles(events);
        }

        hideNativeSubtitles();
    } catch (e) {
        console.error('[AiSub] Failed to fetch subtitles', e);
        showNotification('Error loading subtitles');
    }
}

// 6. Native Subtitle Management (Hide/Show)
function hideNativeSubtitles() {
    // A. Try to turn off via controls (preferred)
    const nativeIcon = document.getElementById('cdnplayer_control_cc_icon0');
    if (nativeIcon && !nativeIcon.classList.contains('none')) {
        const ccContainer = document.getElementById('cdnplayer_control_cc');
        if (ccContainer && ccContainer.lastElementChild) {
            // ccContainer.lastElementChild.click(); // Optional: might stop stream? User said just hide.
        }
    }

    // B. CSS Injection to hide elements
    const styleId = 'aisub-hide-native-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            pjsdiv[style*="bottom: 50px"],
            pjsdiv[style*="bottom:50px"],
            pjsdiv[style*="text-align: center"] > span[style*="background-color:rgba(0,0,0,0.7)"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // C. MutationObserver for dynamic elements
    if (nativeSubObserver) nativeSubObserver.disconnect();

    nativeSubObserver = new MutationObserver((mutations) => {
        if (!isAiSubtitlesActive) return;

        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeName && node.nodeName.toLowerCase() === 'pjsdiv') {
                    if (isNativeSubtitleElement(node)) {
                        hideElement(node);
                    }
                }
            });
        });
    });

    const player = document.getElementById('cdnplayer') || document.body || document.documentElement;
    if (player) {
        nativeSubObserver.observe(player, { childList: true, subtree: true });
    }

    // D. Hide existing ones immediately
    document.querySelectorAll('pjsdiv').forEach(node => {
        if (isNativeSubtitleElement(node)) {
            hideElement(node);
        }
    });
}

function restoreNativeSubtitles() {
    // A. Remove CSS
    const style = document.getElementById('aisub-hide-native-style');
    if (style) style.remove();

    // B. Disconnect Observer
    if (nativeSubObserver) {
        nativeSubObserver.disconnect();
        nativeSubObserver = null;
    }

    // C. Restore visibility of hidden elements
    document.querySelectorAll('pjsdiv').forEach(node => {
        if (node.dataset.aisubHidden) {
            node.style.display = '';
            node.style.visibility = '';
            node.style.opacity = '';
            delete node.dataset.aisubHidden;
        }
    });
}

function isNativeSubtitleElement(node) {
    if (!node.style) return false;
    return node.style.bottom === '50px' ||
        (node.innerHTML && node.innerHTML.includes('background-color:rgba(0,0,0,0.7)'));
}

function hideElement(node) {
    node.style.display = 'none';
    node.style.visibility = 'hidden';
    node.dataset.aisubHidden = 'true'; // Mark as hidden by us
}

// 7. UI: Button Creation and Injection
function createAiButton() {
    const btn = document.createElement('div');
    btn.className = 'aisub-rezka-btn';
    btn.style.cssText = `
        position: absolute;
        top: 15px;
        right: 15px;
        width: 30px;
        height: 30px;
        cursor: pointer;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        opacity: 0.8;
        transition: opacity 0.2s;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 4px;
    `;

    btn.innerHTML = `
        <svg height="20" version="1.1" viewBox="6 6 24 24" width="20">
            <path d="M11,11 L25,11 L25,25 L11,25 Z" fill="none" stroke="currentColor" stroke-width="2" />
            <text x="13" y="22" font-size="10" fill="currentColor" font-weight="bold">AI</text>
        </svg>
    `;

    btn.onmouseenter = () => btn.style.opacity = '1';
    btn.onmouseleave = () => btn.style.opacity = isAiSubtitlesActive ? '1' : '0.8';
    btn.onclick = toggleAiSubtitles;

    return btn;
}

function updateButtonState() {
    const btn = document.querySelector('.aisub-rezka-btn');
    if (btn) {
        btn.style.color = isAiSubtitlesActive ? '#4ade80' : 'white';
        btn.style.opacity = isAiSubtitlesActive ? '1' : '0.8';
    }
}

const injectButton = () => {
    const playerContainer = document.getElementById('cdnplayer');
    if (playerContainer) {
        const existing = document.querySelector('.aisub-rezka-btn');
        if (!existing) {
            const btn = createAiButton();

            // Ensure container is relative for absolute positioning
            const style = window.getComputedStyle(playerContainer);
            if (style.position === 'static') {
                playerContainer.style.position = 'relative';
            }

            playerContainer.appendChild(btn);
            updateButtonState(); // Ensure correct state on re-injection

            // Auto-hide logic for AI button
            let hideTimeout;
            const hideBtn = () => {
                if (!isAiSubtitlesActive) {
                    btn.style.opacity = '0';
                } else {
                    btn.style.opacity = '0';
                }
            };
            const showBtn = () => {
                btn.style.opacity = isAiSubtitlesActive ? '1' : '0.8';
                clearTimeout(hideTimeout);
                hideTimeout = setTimeout(hideBtn, 3000);
            };

            // Initial
            showBtn();

            // Listen to player container
            playerContainer.addEventListener('mousemove', showBtn);
            playerContainer.addEventListener('mouseenter', showBtn);
            playerContainer.addEventListener('mouseleave', hideBtn);

            // Ensure button itself triggers show
            btn.addEventListener('mouseenter', () => {
                clearTimeout(hideTimeout);
                btn.style.opacity = '1';
            });
        }
    }
};

// 8. Observers for Injection
// Watch for player creation
waitForElement('#cdnplayer', (player) => {
    injectButton();

    // Watch for button removal (e.g. player update)
    const buttonObserver = new MutationObserver((mutations) => {
        let shouldInject = false;
        mutations.forEach(m => {
            if (m.removedNodes.length > 0) {
                m.removedNodes.forEach(node => {
                    if (node.classList && node.classList.contains('aisub-rezka-btn')) {
                        shouldInject = true;
                    }
                });
            }
        });

        if (shouldInject || !document.querySelector('.aisub-rezka-btn')) {
            injectButton();
        }
    });

    buttonObserver.observe(player, { childList: true });
});


// 9. Helpers
function showNotification(msg) {
    const existing = document.getElementById('aisub-toast');
    if (existing) existing.remove();

    let toast = document.createElement('div');
    toast.id = 'aisub-toast';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 2147483647;
        font-family: sans-serif;
        pointer-events: none;
        transition: opacity 0.5s;
        font-size: 14px;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

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

    const target = document.body || document.documentElement;
    if (target) {
        observer.observe(target, { childList: true, subtree: true });
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            waitForElement(selector, callback);
        });
    }
}

function parseVTT(text) {
    const lines = text.split('\n');
    const events = [];
    let currentEvent = null;

    for (let line of lines) {
        line = line.trim();
        if (line === 'WEBVTT' || line.startsWith('NOTE') || !line) {
            if (currentEvent && !line) {
                if (currentEvent.text) events.push(currentEvent);
                currentEvent = null;
            }
            continue;
        }

        if (line.includes('-->')) {
            if (currentEvent && currentEvent.text) {
                events.push(currentEvent);
            }
            const [start, end] = line.split('-->').map(t => t.trim());
            currentEvent = {
                start: parseTime(start),
                end: parseTime(end),
                text: ''
            };
        } else if (currentEvent) {
            currentEvent.text += (currentEvent.text ? '\n' : '') + line;
        }
    }
    if (currentEvent && currentEvent.text) events.push(currentEvent);
    return events;
}

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    let seconds = 0;
    if (parts.length === 3) {
        seconds += parseInt(parts[0]) * 3600;
        seconds += parseInt(parts[1]) * 60;
        seconds += parseFloat(parts[2]);
    } else if (parts.length === 2) {
        seconds += parseInt(parts[0]) * 60;
        seconds += parseFloat(parts[1]);
    }
    return seconds * 1000;
}
