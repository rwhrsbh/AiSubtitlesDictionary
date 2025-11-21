// Word Popup Logic

window.openWordPopup = async function (word, x, y) {
    await window.AiSubtitlesI18n.init();
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
            <div class="aisub-loading">${window.AiSubtitlesI18n.getMessage('popup_loading_explanation')}</div>
        </div>
        <div class="aisub-popup-actions">
            <div style="display: flex; gap: 8px; width: 100%;">
                <select id="aisub-category-select" class="aisub-category-select" style="flex: 1;">
                    <option value="default">${window.AiSubtitlesI18n.getMessage('category_default') || 'Default'}</option>
                </select>
                <button class="aisub-btn" id="aisub-learn-btn">${window.AiSubtitlesI18n.getMessage('popup_learn_btn')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    // Load categories
    loadCategories(popup);

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
                <div><strong>${window.AiSubtitlesI18n.getMessage('popup_transcription')}:</strong> ${response.data.transcription || ''}</div>
                <div><strong>${window.AiSubtitlesI18n.getMessage('popup_translation')}:</strong> ${response.data.translation}</div>
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
            content.innerHTML = `<div style="color:#ef4444;">${window.AiSubtitlesI18n.getMessage('error_prefix')} ${response.error || window.AiSubtitlesI18n.getMessage('error_unknown')}</div>`;
        }
    });

    // Learn Handler
    popup.querySelector('#aisub-learn-btn').addEventListener('click', () => {
        const data = popup.dataset.fullData ? JSON.parse(popup.dataset.fullData) : {};
        data.word = word; // Ensure word is in the data

        // Get selected category
        const categorySelect = popup.querySelector('#aisub-category-select');
        data.category = categorySelect.value;

        console.log('[Save Word] Saving to learning list:', data);
        chrome.runtime.sendMessage({ type: 'ADD_TO_LEARN', data: data }, () => {
            alert(`${window.AiSubtitlesI18n.getMessage('popup_added_to_category')} "${data.category}"!`);
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

// Load categories into select dropdown
async function loadCategories(popup) {
    const result = await chrome.storage.local.get(['categories']);
    const categories = result.categories || ['default'];

    const select = popup.querySelector('#aisub-category-select');
    select.innerHTML = categories.map(cat =>
        `<option value="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`
    ).join('');

    // Add option to create new category
    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = window.AiSubtitlesI18n.getMessage('category_new');
    select.appendChild(newOption);

    // Handle new category creation
    select.addEventListener('change', async (e) => {
        if (e.target.value === '__new__') {
            const newCategory = prompt('Enter new category name:');
            if (newCategory && newCategory.trim()) {
                const categoryName = newCategory.trim().toLowerCase();

                // Add to storage
                const cats = result.categories || ['default'];
                if (!cats.includes(categoryName)) {
                    cats.push(categoryName);
                    await chrome.storage.local.set({ categories: cats });
                }

                // Add to select and select it
                const option = document.createElement('option');
                option.value = categoryName;
                option.textContent = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
                select.insertBefore(option, select.lastChild); // Insert before "+ New Category"
                select.value = categoryName;
            } else {
                select.value = 'default';
            }
        }
    });
}

// Open popup for already learned word (no API call)
window.openSavedWordPopup = function (word, x, y, wordData) {
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
            <div><strong>${window.AiSubtitlesI18n.getMessage('popup_transcription')}:</strong> ${wordData.transcription || ''}</div>
            <div><strong>${window.AiSubtitlesI18n.getMessage('popup_translation')}:</strong> ${wordData.translation}</div>
            <div style="margin-top:8px; font-size:12px; color:#ccc;">${wordData.explanation || ''}</div>
            <div style="margin-top:12px; padding:8px; background:rgba(59,130,246,0.1); border-radius:6px; font-size:12px;">
                <div style="color:#60a5fa; font-weight:600; margin-bottom:4px;">📊 ${window.AiSubtitlesI18n.getMessage('popup_progress')}:</div>
                <div style="display:flex; gap:12px;">
                    <span style="color:#22c55e;">✅ ${wordData.correctCount || 0}</span>
                    <span style="color:#ef4444;">❌ ${wordData.wrongCount || 0}</span>
                </div>
            </div>
        </div>
        <div class="aisub-popup-actions">
            <button class="aisub-btn aisub-btn-secondary" id="aisub-close-btn" style="width:100%;">${window.AiSubtitlesI18n.getMessage('flashcards_close')}</button>
        </div>
    `;

    document.body.appendChild(popup);

    // Close handlers
    popup.querySelector('.aisub-popup-close').addEventListener('click', () => popup.remove());
    popup.querySelector('#aisub-close-btn').addEventListener('click', () => popup.remove());

    // Make popup draggable
    makeDraggable(popup, popup.querySelector('.aisub-popup-header'));
};
