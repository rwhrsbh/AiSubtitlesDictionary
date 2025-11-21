// Word Popup Logic

window.openWordPopup = function (word, x, y) {
    // Remove existing popup
    const existing = document.querySelector('.aisub-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'aisub-popup';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    popup.innerHTML = `
        <div class="aisub-popup-header">
            <span class="aisub-popup-word">${word}</span>
            <span class="aisub-popup-close">✕</span>
        </div>
        <div class="aisub-popup-content">
            <div class="aisub-loading">Loading explanation...</div>
        </div>
        <div class="aisub-popup-actions">
            <button class="aisub-btn" id="aisub-learn-btn">Learn</button>
        </div>
    `;

    document.body.appendChild(popup);

    // Close handler
    popup.querySelector('.aisub-popup-close').addEventListener('click', () => popup.remove());

    // Fetch explanation from Gemini via Background
    const learnBtn = popup.querySelector('#aisub-learn-btn');
    learnBtn.disabled = true;
    learnBtn.style.opacity = '0.5';
    learnBtn.style.cursor = 'not-allowed';

    chrome.runtime.sendMessage({ type: 'EXPLAIN_WORD', word: word }, (response) => {
        const content = popup.querySelector('.aisub-popup-content');
        if (response && response.success) {
            content.innerHTML = `
                <div><strong>Trans:</strong> ${response.data.transcription || ''}</div>
                <div><strong>Translation:</strong> ${response.data.translation}</div>
                <div style="margin-top:8px; font-size:12px; color:#ccc;">${response.data.explanation}</div>
            `;

            // Inject word into data
            response.data.word = word;

            // Save context for learning
            popup.dataset.fullData = JSON.stringify(response.data);

            // Enable button
            learnBtn.disabled = false;
            learnBtn.style.opacity = '1';
            learnBtn.style.cursor = 'pointer';

            // Save to history
            saveToHistory(response.data);
        } else {
            content.innerHTML = `<div style="color:#ef4444;">Error: ${response.error || 'Unknown error'}</div>`;
        }
    });

    // Learn Handler
    popup.querySelector('#aisub-learn-btn').addEventListener('click', () => {
        const data = popup.dataset.fullData ? JSON.parse(popup.dataset.fullData) : {};
        data.word = word; // Ensure word is in the data
        console.log('[Save Word] Saving to learning list:', data);
        chrome.runtime.sendMessage({ type: 'ADD_TO_LEARN', data: data }, () => {
            alert('Added to learning list!');
            popup.remove();
        });
    });

    // Make popup draggable
    makeDraggable(popup, popup.querySelector('.aisub-popup-header'));
};

function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    if (handle) {
        handle.onmousedown = dragMouseDown;
        handle.style.cursor = 'grab';
    } else {
        element.onmousedown = dragMouseDown;
        element.style.cursor = 'grab';
    }

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
        if (handle) handle.style.cursor = 'grabbing';
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;

        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        if (handle) handle.style.cursor = 'grab';
    }
}

// Save word to history
async function saveToHistory(wordData) {
    const result = await chrome.storage.local.get(['wordHistory']);
    let history = result.wordHistory || [];

    // Check if word already in history
    const existingIndex = history.findIndex(w => w.word === wordData.word);

    if (existingIndex >= 0) {
        // Update existing entry
        history[existingIndex] = {
            ...history[existingIndex],
            lastViewed: Date.now(),
            viewCount: (history[existingIndex].viewCount || 1) + 1
        };
    } else {
        // Add new entry
        history.push({
            ...wordData,
            lastViewed: Date.now(),
            viewCount: 1
        });
    }

    // Keep only last 100 entries
    if (history.length > 100) {
        history = history.slice(-100);
    }

    await chrome.storage.local.set({ wordHistory: history });
}
