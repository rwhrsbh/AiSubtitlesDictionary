// Subtitle Renderer

let currentEvents = [];
let renderInterval = null;

window.startRenderingSubtitles = async function (events) {
    console.log('[Subtitle Renderer] Starting with', events.length, 'events');
    await window.AiSubtitlesI18n.init();
    currentEvents = events;

    // Create container if not exists
    let container = document.getElementById('aisub-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'aisub-container';
        // Insert into video container so it scales with video
        const videoContainer = document.querySelector('.html5-video-player');
        if (videoContainer) {
            videoContainer.appendChild(container);
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
};

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
                    span.addEventListener('click', async (e) => {
                        e.stopPropagation();

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
};

// Draggable Logic
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    if (handle) {
        handle.onmousedown = dragMouseDown;
    } else {
        element.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
        element.style.transform = 'none'; // Disable transform centering
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
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

    const videoContainer = document.querySelector('.html5-video-player') || document.body;
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
        }
    });

    // Make panel draggable
    makeDraggable(panel, panel.querySelector('.aisub-settings-header'));
}
