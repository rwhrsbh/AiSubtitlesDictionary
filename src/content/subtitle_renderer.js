// Subtitle Renderer

let currentEvents = [];
let renderInterval = null;
let selectionStartWord = null;
let isSelecting = false;

window.startRenderingSubtitles = async function (events) {
    console.log('[Subtitle Renderer] Starting with', events.length, 'events');
    await window.AiSubtitlesI18n.init();
    currentEvents = events;

    // Create container if not exists
    let container = document.getElementById('aisub-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'aisub-container';

        // Try to find the best container
        const video = document.querySelector('video');
        const youtubeContainer = document.querySelector('.html5-video-player');
        const rezkaContainer = document.getElementById('cdnplayer') || (video ? video.parentElement : null);

        if (youtubeContainer) {
            youtubeContainer.appendChild(container);
        } else if (rezkaContainer) {
            rezkaContainer.appendChild(container);
            // Ensure relative positioning for absolute child
            const style = window.getComputedStyle(rezkaContainer);
            if (style.position === 'static') {
                rezkaContainer.style.position = 'relative';
            }
        } else {
            document.body.appendChild(container);
        }
    }

    container.style.display = 'block';

    // Make draggable
    container.classList.add('aisub-draggable');
    makeDraggable(container);

    // Initialize Settings
    initSettings(container);
    const settingsBtn = document.getElementById('aisub-settings-btn');
    if (settingsBtn) settingsBtn.style.display = 'flex';

    if (renderInterval) clearInterval(renderInterval);
    renderInterval = setInterval(updateSubtitles, 100);

    // Reset positions on start
    positions = { windowed: null, fullscreen: null };

    // Handle Fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange); // Safari/Old Chrome
    document.addEventListener('mozfullscreenchange', handleFullscreenChange); // Firefox
    document.addEventListener('MSFullscreenChange', handleFullscreenChange); // IE/Edge
};

function handleFullscreenChange() {
    const fullscreenElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    const container = document.getElementById('aisub-container');
    const settingsBtn = document.getElementById('aisub-settings-btn');
    const settingsPanel = document.getElementById('aisub-settings-panel');

    if (fullscreenElement) {
        // Move elements to fullscreen container
        if (container) fullscreenElement.appendChild(container);
        if (settingsBtn) fullscreenElement.appendChild(settingsBtn);
        if (settingsPanel) fullscreenElement.appendChild(settingsPanel);
    } else {
        // Move back to default video container
        const video = document.querySelector('video');
        const defaultContainer = document.querySelector('.html5-video-player') ||
            document.getElementById('cdnplayer') ||
            (video ? video.parentElement : null) ||
            document.body;

        if (container) defaultContainer.appendChild(container);
        if (settingsBtn) defaultContainer.appendChild(settingsBtn);
        if (settingsPanel) defaultContainer.appendChild(settingsPanel);

        // Fix for Rezka relative positioning if needed
        if (defaultContainer.id === 'cdnplayer') {
            const style = window.getComputedStyle(defaultContainer);
            if (style.position === 'static') {
                defaultContainer.style.position = 'relative';
            }
        }
    }

    // Apply position for the new state
    applyPositionState();
}

function updateSubtitles() {
    const video = document.querySelector('video');
    if (!video) return;

    const currentTimeMs = video.currentTime * 1000;
    const container = document.getElementById('aisub-container');
    if (!container) return;

    // Find ALL active events (handling overlaps)
    const activeEvents = currentEvents.filter(evt => {
        return currentTimeMs >= evt.start && currentTimeMs < evt.end;
    });

    if (activeEvents.length > 0) {
        // Sort by start time to maintain order
        activeEvents.sort((a, b) => a.start - b.start);

        // Generate HTML for all lines
        // We use a unique key based on content to check if update is needed
        const combinedText = activeEvents.map(e => e.text).join('\n');

        if (container.dataset.lastText !== combinedText) {
            container.innerHTML = ''; // Clear

            // Load learned words asynchronously
            loadLearnedWords().then(learnedWords => {
                activeEvents.forEach(evt => {
                    const lines = evt.text.split(/\n|<br>/);

                    lines.forEach(lineText => {
                        if (!lineText.trim()) return;

                        const lineDiv = document.createElement('div');
                        lineDiv.className = 'aisub-line';

                        const words = lineText.trim().split(/\s+/);
                        const html = words.map(w => {
                            const cleanWord = w.replace(/[^\p{L}\p{N}''-]/gu, '').toLowerCase();
                            const learned = learnedWords[cleanWord];

                            let classes = 'aisub-word';
                            if (learned) {
                                classes += ' learned';
                                if (learned.status === 'success') {
                                    classes += ' learned-success';
                                } else if (learned.status === 'progress') {
                                    classes += ' learned-progress';
                                } else {
                                    classes += ' learned-not-started';
                                }
                            }

                            return `<span class="${classes}" data-word="${cleanWord}">${w}</span>`;
                        }).join(' ');
                        lineDiv.innerHTML = html;

                        container.appendChild(lineDiv);
                    });
                });

                container.dataset.lastText = combinedText;

                // Add click listeners
                const spans = container.querySelectorAll('.aisub-word');
                spans.forEach(span => {
                    // Left Click - Single Word
                    span.addEventListener('click', async (e) => {
                        e.stopPropagation();

                        // If we were selecting, a left click cancels it
                        if (isSelecting) {
                            clearSelection();
                            return;
                        }

                        // Extract clean word (remove punctuation)
                        const rawText = span.textContent;
                        const cleanWord = rawText.replace(/[^\p{L}\p{N}''-]/gu, '');

                        // Only open popup if it's an actual word (contains letters)
                        if (cleanWord && /\p{L}/u.test(cleanWord)) {
                            video.pause();

                            // Check if word is learned
                            const wordData = span.dataset.word;
                            const learnedWord = learnedWords[wordData];

                            if (learnedWord) {
                                // Show saved data instead of making API request
                                window.openSavedWordPopup(cleanWord, e.clientX, e.clientY, learnedWord.data);
                            } else {
                                // Make API request for new word
                                window.openWordPopup(cleanWord, e.clientX, e.clientY);
                            }
                        }
                    });

                    // Right Click - Range Selection
                    span.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        if (!isSelecting) {
                            // Clear any previous permanent selection
                            clearSelection();

                            // Start selection
                            isSelecting = true;
                            selectionStartWord = span;
                            span.classList.add('aisub-selecting');
                            video.pause();
                        } else {
                            // End selection
                            const allWords = Array.from(container.querySelectorAll('.aisub-word'));
                            const startIndex = allWords.indexOf(selectionStartWord);
                            const endIndex = allWords.indexOf(span);

                            if (startIndex !== -1 && endIndex !== -1) {
                                const start = Math.min(startIndex, endIndex);
                                const end = Math.max(startIndex, endIndex);

                                const selectedWords = allWords.slice(start, end + 1);

                                // Apply permanent highlight
                                selectedWords.forEach(w => {
                                    w.classList.remove('aisub-selecting');
                                    w.classList.remove('aisub-selected-range');
                                    w.classList.add('aisub-highlighted-permanent');
                                });

                                // Extract text preserving spaces
                                const phrase = selectedWords.map(w => w.textContent).join(' ');
                                // Clean up but keep structure
                                const cleanPhrase = phrase.replace(/[^\p{L}\p{N}\s''-]/gu, '').trim();

                                if (cleanPhrase) {
                                    window.openWordPopup(cleanPhrase, e.clientX, e.clientY);
                                }
                            }

                            // Reset selection state but keep highlight
                            isSelecting = false;
                            selectionStartWord = null;
                        }
                    });

                    // Hover effect during selection
                    span.addEventListener('mouseover', () => {
                        if (isSelecting && selectionStartWord) {
                            const allWords = Array.from(container.querySelectorAll('.aisub-word'));
                            const startIndex = allWords.indexOf(selectionStartWord);
                            const currentIndex = allWords.indexOf(span);

                            if (startIndex !== -1 && currentIndex !== -1) {
                                const start = Math.min(startIndex, currentIndex);
                                const end = Math.max(startIndex, currentIndex);

                                allWords.forEach((w, i) => {
                                    if (i >= start && i <= end) {
                                        w.classList.add('aisub-selected-range');
                                    } else {
                                        w.classList.remove('aisub-selected-range');
                                    }
                                });
                            }
                        }
                    });
                });
            });
        }
    } else {
        container.innerHTML = '';
        container.dataset.lastText = '';
    }
}

// Load learned words from storage
async function loadLearnedWords() {
    try {
        const result = await chrome.storage.local.get(['learningList']);
        const list = result.learningList || [];

        const learnedWords = {};
        list.forEach(word => {
            const key = word.word.toLowerCase();
            const correctCount = word.correctCount || 0;
            const wrongCount = word.wrongCount || 0;
            const totalCount = correctCount + wrongCount;

            let status = 'not-started';
            if (totalCount > 0) {
                const successRate = correctCount / totalCount;
                if (successRate >= 0.7) {
                    status = 'success'; // 70%+ correct - green
                } else {
                    status = 'progress'; // Below 70% - orange
                }
            }

            learnedWords[key] = {
                data: word,
                status: status
            };
        });

        return learnedWords;
    } catch (error) {
        console.error('Error loading learned words:', error);
        return {};
    }
}

function clearSelection() {
    isSelecting = false;
    selectionStartWord = null;
    const container = document.getElementById('aisub-container');
    if (container) {
        const words = container.querySelectorAll('.aisub-word');
        words.forEach(w => {
            w.classList.remove('aisub-selecting');
            w.classList.remove('aisub-selected-range');
            w.classList.remove('aisub-highlighted-permanent');
        });
    }
}

// Clear selection on outside click
document.addEventListener('click', (e) => {
    if (isSelecting) {
        // If clicking inside container but not on a word, we still clear
        // If clicking on a word, the word's click handler handles it (and clears it)
        // But we need to make sure we don't double clear or interfere
        const container = document.getElementById('aisub-container');
        if (!container || !container.contains(e.target)) {
            clearSelection();
        } else if (!e.target.classList.contains('aisub-word')) {
            clearSelection();
        }
    }
});

window.stopRenderingSubtitles = function () {
    console.log('[Subtitle Renderer] Stopping...');
    if (renderInterval) {
        clearInterval(renderInterval);
        renderInterval = null;
    }
    currentEvents = [];
    const container = document.getElementById('aisub-container');
    if (container) {
        container.innerHTML = '';
        container.dataset.lastText = '';
        container.style.display = 'none';
    }
    const settingsBtn = document.getElementById('aisub-settings-btn');
    if (settingsBtn) settingsBtn.style.display = 'none';

    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
};

// Position state
let positions = {
    windowed: null,
    fullscreen: null
};

function updatePositionState() {
    const container = document.getElementById('aisub-container');
    if (!container) return;

    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    const mode = isFullscreen ? 'fullscreen' : 'windowed';

    // Save current position if it has been moved (i.e. has top/left set)
    if (container.style.top && container.style.left) {
        positions[mode] = {
            top: container.style.top,
            left: container.style.left
        };
    }
}

function applyPositionState() {
    const container = document.getElementById('aisub-container');
    if (!container) return;

    const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    const mode = isFullscreen ? 'fullscreen' : 'windowed';
    const saved = positions[mode];

    if (saved) {
        container.style.top = saved.top;
        container.style.left = saved.left;
        container.style.transform = 'none';
        container.style.bottom = 'auto'; // Override CSS bottom
    } else {
        // Reset to default (Center Bottom)
        container.style.top = '';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.bottom = '12%';
    }
}

// Draggable Logic
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    if (handle) {
        handle.onmousedown = dragMouseDown;
    } else {
        element.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        // Allow clicking on controls/inputs inside if any (though currently just text)
        // But preventing default is needed to stop text selection during drag
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') {
            return;
        }

        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;

        // Convert to absolute position to prevent jumping when removing transform
        // and to prepare for constrained dragging
        const rect = element.getBoundingClientRect();
        const parent = element.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();

        const borderLeft = parent.clientLeft || 0;
        const borderTop = parent.clientTop || 0;

        const currentLeft = rect.left - parentRect.left - borderLeft;
        const currentTop = rect.top - parentRect.top - borderTop;

        element.style.left = currentLeft + 'px';
        element.style.top = currentTop + 'px';
        element.style.transform = 'none';
        element.style.bottom = 'auto';
        element.style.right = 'auto';

        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        let newTop = element.offsetTop - pos2;
        let newLeft = element.offsetLeft - pos1;

        const parent = element.offsetParent || document.body;
        // Use clientWidth/Height to exclude borders/scrollbars of parent
        const maxLeft = parent.clientWidth - element.offsetWidth;
        const maxTop = parent.clientHeight - element.offsetHeight;

        // Clamp to parent boundaries
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        // Save position when drag ends
        updatePositionState();
    }
}

// Settings Logic
function initSettings(container) {
    if (document.getElementById('aisub-settings-panel')) return;

    // Settings Button
    const btn = document.createElement('div');
    btn.id = 'aisub-settings-btn';
    btn.className = 'aisub-settings-btn';
    btn.innerHTML = '⚙️';
    btn.title = window.AiSubtitlesI18n.getMessage('settings_title');

    const video = document.querySelector('video');
    const videoContainer = document.querySelector('.html5-video-player') ||
        document.getElementById('cdnplayer') ||
        (video ? video.parentElement : null) ||
        document.body;
    videoContainer.appendChild(btn);

    // Settings Panel
    const panel = document.createElement('div');
    panel.id = 'aisub-settings-panel';
    panel.className = 'aisub-settings-panel';
    panel.innerHTML = `
        <div class="aisub-settings-header">
            <span>${window.AiSubtitlesI18n.getMessage('settings_title')}</span>
            <span style="cursor:pointer" id="aisub-close-settings">✕</span>
        </div>
        
        <div class="aisub-settings-row">
            <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_text_color')}</label>
            <input type="color" id="aisub-text-color" class="aisub-color-picker" value="#f1f5f9">
        </div>
        
        <div class="aisub-settings-row">
            <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_text_opacity')}</label>
            <input type="range" id="aisub-text-opacity" class="aisub-slider" min="0" max="1" step="0.1" value="1">
        </div>

        <div class="aisub-settings-row">
            <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_bg_color')}</label>
            <input type="color" id="aisub-bg-color" class="aisub-color-picker" value="#0f172a">
        </div>

        <div class="aisub-settings-row">
            <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_bg_opacity')}</label>
            <input type="range" id="aisub-bg-opacity" class="aisub-slider" min="0" max="1" step="0.1" value="0.85">
        </div>

        <div style="border-top: 1px solid #334155; margin: 16px 0; padding-top: 16px;">
            <div style="font-weight: 600; margin-bottom: 12px; color: #94a3b8; font-size: 13px;">${window.AiSubtitlesI18n.getMessage('settings_learned_words')}</div>
            
            <div class="aisub-settings-row">
                <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_success_color')}</label>
                <input type="color" id="aisub-learned-success-color" class="aisub-color-picker" value="#22c55e">
            </div>

            <div class="aisub-settings-row">
                <label class="aisub-settings-label">${window.AiSubtitlesI18n.getMessage('settings_progress_color')}</label>
                <input type="color" id="aisub-learned-progress-color" class="aisub-color-picker" value="#f59e0b">
            </div>
        </div>
    `;
    videoContainer.appendChild(panel);

    // Event Listeners
    btn.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });

    document.getElementById('aisub-close-settings').addEventListener('click', () => {
        panel.style.display = 'none';
    });

    // Apply Settings
    function updateStyles() {
        const textColor = document.getElementById('aisub-text-color').value;
        const textOpacity = document.getElementById('aisub-text-opacity').value;
        const bgColor = document.getElementById('aisub-bg-color').value;
        const bgOpacity = document.getElementById('aisub-bg-opacity').value;
        const learnedSuccessColor = document.getElementById('aisub-learned-success-color').value;
        const learnedProgressColor = document.getElementById('aisub-learned-progress-color').value;

        // Convert hex to rgba for background
        const r = parseInt(bgColor.substr(1, 2), 16);
        const g = parseInt(bgColor.substr(3, 2), 16);
        const b = parseInt(bgColor.substr(5, 2), 16);
        const bgRgba = `rgba(${r},${g},${b},${bgOpacity})`;

        const style = document.createElement('style');
        style.id = 'aisub-dynamic-style';
        style.innerHTML = `
            :root {
                --learned-success-color: ${learnedSuccessColor};
                --learned-progress-color: ${learnedProgressColor};
            }
            .aisub-line {
                background: ${bgRgba} !important;
                color: ${textColor} !important;
                opacity: ${textOpacity};
            }
            .aisub-selecting {
                background-color: rgba(255, 215, 0, 0.9) !important;
                color: black !important;
                border-radius: 4px;
            }
            .aisub-selected-range {
                background-color: rgba(255, 215, 0, 0.4) !important;
                border-radius: 4px;
            }
            .aisub-highlighted-permanent {
                background-color: rgba(255, 215, 0, 0.9) !important;
                color: black !important;
                border-radius: 4px;
            }
        `;

        const oldStyle = document.getElementById('aisub-dynamic-style');
        if (oldStyle) oldStyle.remove();
        document.head.appendChild(style);

        // Save settings
        chrome.storage.local.set({
            subSettings: {
                textColor,
                textOpacity,
                bgColor,
                bgOpacity,
                learnedSuccessColor,
                learnedProgressColor
            }
        });
    }

    ['aisub-text-color', 'aisub-text-opacity', 'aisub-bg-color', 'aisub-bg-opacity',
        'aisub-learned-success-color', 'aisub-learned-progress-color'].forEach(id => {
            document.getElementById(id).addEventListener('input', updateStyles);
        });

    // Load saved settings
    chrome.storage.local.get('subSettings', (res) => {
        if (res.subSettings) {
            document.getElementById('aisub-text-color').value = res.subSettings.textColor;
            document.getElementById('aisub-text-opacity').value = res.subSettings.textOpacity;
            document.getElementById('aisub-bg-color').value = res.subSettings.bgColor;
            document.getElementById('aisub-bg-opacity').value = res.subSettings.bgOpacity;

            if (res.subSettings.learnedSuccessColor) {
                document.getElementById('aisub-learned-success-color').value = res.subSettings.learnedSuccessColor;
            }
            if (res.subSettings.learnedProgressColor) {
                document.getElementById('aisub-learned-progress-color').value = res.subSettings.learnedProgressColor;
            }

            updateStyles();
        } else {
            // Apply defaults if no settings saved
            updateStyles();
        }
    });

    // Make panel draggable
    makeDraggable(panel, panel.querySelector('.aisub-settings-header'));

    // Auto-hide settings button logic
    let hideTimeout;
    const hideSettingsBtn = () => {
        if (panel.style.display !== 'block') { // Don't hide if panel is open
            btn.style.opacity = '0';
        }
    };
    const showSettingsBtn = () => {
        btn.style.opacity = '1';
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hideSettingsBtn, 3000);
    };

    // Initial state
    btn.style.transition = 'opacity 0.3s';
    showSettingsBtn();

    // Listen to mouse movement on container
    videoContainer.addEventListener('mousemove', showSettingsBtn);
    videoContainer.addEventListener('mouseenter', showSettingsBtn);
    videoContainer.addEventListener('mouseleave', hideSettingsBtn);

    // Also listen on document for fullscreen cases where container might be different
    document.addEventListener('mousemove', (e) => {
        // Only trigger if mouse is over the video area
        const rect = videoContainer.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
            showSettingsBtn();
        }
    });
}
