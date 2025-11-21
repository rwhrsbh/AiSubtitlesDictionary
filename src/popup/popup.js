import { StorageService } from '../services/storage.js';

const storage = new StorageService();

document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();

    // Restore active tab
    const { activeTab } = await chrome.storage.local.get('activeTab');
    if (activeTab) {
        switchTab(activeTab);
    } else {
        // Default to review
        await loadReviewTab();
    }

    await loadWordsTab();
    await loadSettings();

    document.getElementById('save-settings').addEventListener('click', saveSettings);
    document.getElementById('start-review-btn').addEventListener('click', startReview);
    document.getElementById('word-search').addEventListener('input', filterWords);
});

// Tab switching
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
            chrome.storage.local.set({ activeTab: tabName });
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => {
        if (t.dataset.tab === tabName) t.classList.add('active');
        else t.classList.remove('active');
    });

    document.querySelectorAll('.content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');

    if (tabName === 'words') loadWordsTab();
    if (tabName === 'history') loadHistoryTab();
    if (tabName === 'review') loadReviewTab();
}

// Review Tab
async function loadReviewTab() {
    const words = await storage.getWordsToReview();
    document.getElementById('words-count').textContent = `${words.length} words to review`;

    if (words.length === 0) {
        document.getElementById('no-review').classList.remove('hidden');
        document.getElementById('start-review-btn').disabled = true;
    } else {
        document.getElementById('no-review').classList.add('hidden');
        document.getElementById('start-review-btn').disabled = false;
    }
}

function startReview() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/review/review.html') });
}

// Words Tab
let allWords = [];

async function loadWordsTab() {
    allWords = await storage.getLearningList();
    document.getElementById('total-words').textContent = allWords.length;

    if (allWords.length === 0) {
        document.getElementById('no-words').classList.remove('hidden');
        document.getElementById('words-list').innerHTML = '';
    } else {
        document.getElementById('no-words').classList.add('hidden');
        renderWords(allWords);
    }
}

function renderWords(words) {
    const container = document.getElementById('words-list');
    container.innerHTML = words.map(w => `
        <div class="word-card" data-id="${w.id}">
            <div class="word-card-header">
                <div class="word-card-word">${w.word}</div>
                <div class="word-card-transcription">${w.transcription || ''}</div>
            </div>
            <div class="word-card-translation">${w.translation}</div>
            ${w.example ? `<div class="word-card-example">"${w.example}"</div>` : ''}
            <div class="word-card-stats">
                <span>✅ ${w.correctCount || 0}</span>
                <span>❌ ${w.wrongCount || 0}</span>
                <span>📅 ${new Date(w.addedAt).toLocaleDateString()}</span>
                <button class="delete-word-btn" onclick="deleteWord('${w.id}')">🗑️ Delete</button>
            </div>
        </div>
    `).join('');
}

function filterWords(e) {
    const query = e.target.value.toLowerCase();
    const filtered = allWords.filter(w =>
        w.word.toLowerCase().includes(query) ||
        w.translation.toLowerCase().includes(query)
    );
    renderWords(filtered);
}

window.deleteWord = async function (id) {
    if (confirm('Delete this word?')) {
        const list = await storage.getLearningList();
        const updated = list.filter(w => w.id !== id);
        await chrome.storage.local.set({ learningList: updated });
        await loadWordsTab();
        await loadReviewTab();
    }
};

// History Tab
let allHistory = [];

async function loadHistoryTab() {
    const result = await chrome.storage.local.get(['wordHistory']);
    allHistory = result.wordHistory || [];

    // Sort by last viewed
    allHistory.sort((a, b) => b.lastViewed - a.lastViewed);

    document.getElementById('total-history').textContent = allHistory.length;

    if (allHistory.length === 0) {
        document.getElementById('no-history').classList.remove('hidden');
        document.getElementById('history-list').innerHTML = '';
    } else {
        document.getElementById('no-history').classList.add('hidden');
        await renderHistory(allHistory);
    }

    document.getElementById('history-search').addEventListener('input', filterHistory);
}

async function renderHistory(words) {
    const container = document.getElementById('history-list');
    const list = await storage.getLearningList();

    container.innerHTML = words.map(w => {
        if (!w || !w.word) return ''; // Skip invalid entries

        const isAdded = list.some(item => item.word === w.word);
        const safeWord = w.word.replace(/'/g, "\\'");

        return `
            <div class="word-card">
                <div class="word-card-header">
                    <div class="word-card-word">${w.word}</div>
                    <div class="word-card-transcription">${w.transcription || ''}</div>
                </div>
                <div class="word-card-translation">${w.translation || ''}</div>
                ${w.example ? `<div class="word-card-example">"${w.example}"</div>` : ''}
                <div class="word-card-stats">
                    <span>👁️ ${w.viewCount || 1}</span>
                    <span>📅 ${new Date(w.lastViewed).toLocaleDateString()}</span>
                    ${isAdded
                ? `<span style="color:#22c55e; margin-left:auto; font-size:11px;">✅ Added</span>`
                : `<button class="add-history-btn" onclick="addFromHistory('${safeWord}')">➕ Add to Learn</button>`
            }
                </div>
            </div>
        `;
    }).join('');
}

function filterHistory(e) {
    const query = e.target.value.toLowerCase();
    const filtered = allHistory.filter(w =>
        (w.word && w.word.toLowerCase().includes(query)) ||
        (w.translation && w.translation.toLowerCase().includes(query))
    );
    renderHistory(filtered);
}

window.addFromHistory = async function (word) {
    const historyWord = allHistory.find(w => w.word === word);
    if (!historyWord) return;

    const list = await storage.getLearningList();
    if (list.some(w => w.word === word)) {
        alert('Word already in your learning list!');
        return;
    }

    await storage.addToLearningList(historyWord);

    // Refresh UI
    await loadHistoryTab(); // Will re-render with "Added" status
    await loadWordsTab();   // Update words count
    await loadReviewTab();  // Update review count
};

// Settings Tab
async function loadSettings() {
    const apiKey = await storage.getApiKey();
    if (apiKey) {
        document.getElementById('api-key').value = apiKey;
        await populateModels();
    }

    const settings = await chrome.storage.local.get(['geminiModel', 'quizTranslation', 'quizTranscription']);

    if (settings.geminiModel) {
        const select = document.getElementById('gemini-model');
        // If model exists in list, select it. If not (and list populated), add it or warn?
        // For now just set value, if it's not in list it might show empty or default
        if (select.querySelector(`option[value="${settings.geminiModel}"]`)) {
            select.value = settings.geminiModel;
        } else {
            // If custom model or not in list, maybe add it? 
            // Let's just set it, browser handles invalid value by showing first or empty
            // But we should probably ensure it's selected if we just fetched
            select.value = settings.geminiModel;
        }
    }

    document.getElementById('quiz-translation').checked = settings.quizTranslation !== false;
    document.getElementById('quiz-transcription').checked = settings.quizTranscription !== false;

    // Add listener to fetch models when API key changes (on blur)
    document.getElementById('api-key').addEventListener('blur', async (e) => {
        if (e.target.value) {
            await chrome.storage.local.set({ GEMINI_API_KEY: e.target.value });
            await populateModels();
        }
    });
}

async function populateModels() {
    const select = document.getElementById('gemini-model');
    const apiKey = document.getElementById('api-key').value;

    if (!apiKey) {
        select.innerHTML = '<option value="">Please enter API Key first</option>';
        return;
    }

    select.innerHTML = '<option>Loading...</option>';

    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_MODELS' });
        if (response && response.success) {
            select.innerHTML = response.models.map(m =>
                `<option value="${m.name}">${m.displayName} (${m.name})</option>`
            ).join('');

            // Restore selection if possible, or default
            const settings = await chrome.storage.local.get(['geminiModel']);
            if (settings.geminiModel && select.querySelector(`option[value="${settings.geminiModel}"]`)) {
                select.value = settings.geminiModel;
            } else if (select.options.length > 0) {
                // Default to first or specific if available
                const flash = Array.from(select.options).find(o => o.value.includes('flash'));
                if (flash) select.value = flash.value;
            }
        } else {
            select.innerHTML = '<option value="gemini-2.5-flash">Gemini 1.5 Flash (Default)</option>';
            console.error('Failed to fetch models:', response.error);
        }
    } catch (e) {
        select.innerHTML = '<option value="gemini-2.5-flash">Gemini 1.5 Flash (Default)</option>';
        console.error('Error fetching models:', e);
    }
}

async function saveSettings() {
    const btn = document.getElementById('save-settings');
    const originalText = btn.textContent;

    const apiKey = document.getElementById('api-key').value;
    const model = document.getElementById('gemini-model').value;
    const quizTranslation = document.getElementById('quiz-translation').checked;
    const quizTranscription = document.getElementById('quiz-transcription').checked;

    if (!quizTranslation && !quizTranscription) {
        alert('Select at least one quiz type!');
        return;
    }

    // Save API key via storage service (handles empty string)
    if (apiKey) {
        await storage.setApiKey(apiKey);
    } else {
        await chrome.storage.local.remove('apiKey'); // Remove if empty
        await chrome.storage.local.remove('GEMINI_API_KEY'); // Legacy cleanup
    }

    await chrome.storage.local.set({
        geminiModel: model,
        quizTranslation,
        quizTranscription
    });

    // Visual feedback instead of alert
    btn.textContent = '✅ Saved!';
    btn.style.background = '#22c55e';

    // Refresh models list if key changed (or cleared)
    await populateModels();

    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
    }, 1500);
}
