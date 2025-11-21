// Subtitle Renderer

let currentEvents = [];
let renderInterval = null;

window.startRenderingSubtitles = function (events) {
    console.log('[Subtitle Renderer] Starting with', events.length, 'events');
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

            activeEvents.forEach(evt => {
                // Handle newlines within a single event text (replace \n with <br>)
                // But usually we want to split by words for interactivity
                // If text contains \n, treat as separate lines
                const lines = evt.text.split(/\n|<br>/);

                lines.forEach(lineText => {
                    if (!lineText.trim()) return;

                    const lineDiv = document.createElement('div');
                    lineDiv.className = 'aisub-line';

                    const words = lineText.trim().split(/\s+/);
                    const html = words.map(w => `<span class="aisub-word">${w}</span>`).join(' ');
                    lineDiv.innerHTML = html;

                    container.appendChild(lineDiv);
                });
            });

            container.dataset.lastText = combinedText;

            // Add click listeners
            const spans = container.querySelectorAll('.aisub-word');
            spans.forEach(span => {
                span.addEventListener('click', (e) => {
                    e.stopPropagation();
                    video.pause();
                    window.openWordPopup(span.textContent, e.clientX, e.clientY);
                });
            });
        }
    } else {
        container.innerHTML = '';
        container.dataset.lastText = '';
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
    btn.title = 'Subtitle Settings';

    const videoContainer = document.querySelector('.html5-video-player') || document.body;
    videoContainer.appendChild(btn);

    // Settings Panel
    const panel = document.createElement('div');
    panel.id = 'aisub-settings-panel';
    panel.className = 'aisub-settings-panel';
    panel.innerHTML = `
        <div class="aisub-settings-header">
            <span>Subtitle Settings</span>
            <span style="cursor:pointer" id="aisub-close-settings">✕</span>
        </div>
        
        <div class="aisub-settings-row">
            <label class="aisub-settings-label">Text Color</label>
            <input type="color" id="aisub-text-color" class="aisub-color-picker" value="#f1f5f9">
        </div>
        
        <div class="aisub-settings-row">
            <label class="aisub-settings-label">Text Opacity</label>
            <input type="range" id="aisub-text-opacity" class="aisub-slider" min="0" max="1" step="0.1" value="1">
        </div>

        <div class="aisub-settings-row">
            <label class="aisub-settings-label">Background Color</label>
            <input type="color" id="aisub-bg-color" class="aisub-color-picker" value="#0f172a">
        </div>

        <div class="aisub-settings-row">
            <label class="aisub-settings-label">Background Opacity</label>
            <input type="range" id="aisub-bg-opacity" class="aisub-slider" min="0" max="1" step="0.1" value="0.85">
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

        // Convert hex to rgba for background
        const r = parseInt(bgColor.substr(1, 2), 16);
        const g = parseInt(bgColor.substr(3, 2), 16);
        const b = parseInt(bgColor.substr(5, 2), 16);
        const bgRgba = `rgba(${r},${g},${b},${bgOpacity})`;

        const style = document.createElement('style');
        style.id = 'aisub-dynamic-style';
        style.innerHTML = `
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
            subSettings: { textColor, textOpacity, bgColor, bgOpacity }
        });
    }

    ['aisub-text-color', 'aisub-text-opacity', 'aisub-bg-color', 'aisub-bg-opacity'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateStyles);
    });

    // Load saved settings
    chrome.storage.local.get('subSettings', (res) => {
        if (res.subSettings) {
            document.getElementById('aisub-text-color').value = res.subSettings.textColor;
            document.getElementById('aisub-text-opacity').value = res.subSettings.textOpacity;
            document.getElementById('aisub-bg-color').value = res.subSettings.bgColor;
            document.getElementById('aisub-bg-opacity').value = res.subSettings.bgOpacity;
            updateStyles();
        }
    });

    // Make panel draggable
    makeDraggable(panel, panel.querySelector('.aisub-settings-header'));
}
