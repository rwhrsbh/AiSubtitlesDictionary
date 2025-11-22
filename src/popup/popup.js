import { StorageService } from '../services/storage.js';
import { I18nService } from '../services/i18n.js';

const storage = new StorageService();
const i18n = new I18nService();

// Helper function to extract translation based on user language
function getTranslationForUser(translation) {
    if (!translation) return '';

    // If translation is a string, try to parse it as JSON first
    if (typeof translation === 'string') {
        // Check if it looks like JSON (starts with { or [)
        const trimmed = translation.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                translation = JSON.parse(trimmed);
            } catch (e) {
                // Not valid JSON, return as-is
                return translation;
            }
        } else {
            // Regular string, return as-is
            return translation;
        }
    }

    // If translation is an object, extract based on user language
    if (typeof translation === 'object' && translation !== null) {
        const userLang = i18n.language || 'ru';

        if (userLang === 'en') {
            return translation.english || translation.English || Object.values(translation)[0] || '';
        } else if (userLang === 'uk') {
            return translation.ukrainian || translation.Ukrainian || translation.russian || Object.values(translation)[0] || '';
        } else {
            // Default to Russian
            return translation.russian || translation.Russian || Object.values(translation)[0] || '';
        }
    }

    return '';
}

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    setupTabs();
    localizeHtml();

    // Restore active tab
    const { activeTab } = await chrome.storage.local.get('activeTab');
    if (activeTab) {
        switchTab(activeTab);
    } else {
        // Default to review
        await loadReviewTab();
    }

    await loadSettings();

    document.getElementById('save-settings').addEventListener('click', saveSettings);
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    document.getElementById('start-review-btn').addEventListener('click', startReview);
    document.getElementById('start-flashcards-btn').addEventListener('click', startFlashcards);
    document.getElementById('start-context-cards-btn').addEventListener('click', startContextCards);
    document.getElementById('start-definition-cards-btn').addEventListener('click', startDefinitionCards);
    document.getElementById('add-category-btn').addEventListener('click', addNewCategory);
    document.getElementById('word-search').addEventListener('input', filterWords);
    document.getElementById('export-data-btn').addEventListener('click', handleExportData);
    document.getElementById('import-data-btn').addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', handleImportData);
});

function localizeHtml() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });

    // Also localize placeholders
    const searchInput = document.getElementById('word-search');
    if (searchInput) searchInput.placeholder = i18n.getMessage('search_words');

    const historySearch = document.getElementById('history-search');
    if (historySearch) historySearch.placeholder = i18n.getMessage('search_words');

    const apiKeyInput = document.getElementById('api-key');
    if (apiKeyInput) apiKeyInput.placeholder = i18n.getMessage('settings_api_key_placeholder');
}

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
let reviewMode = 'due';

async function loadReviewTab() {
    const words = await storage.getWordsToReview();
    const allWordsList = await storage.getLearningList();
    const problemWords = await storage.getProblemWords();
    const wordsToReviewText = i18n.getMessage('words_to_review');

    const btn = document.getElementById('start-review-btn');
    const noReviewMsg = document.getElementById('no-review');
    const countText = document.getElementById('words-count');

    if (words.length > 0) {
        // Words due
        countText.textContent = `${words.length} ${wordsToReviewText}`;
        btn.textContent = i18n.getMessage('start_review');
        btn.disabled = false;
        noReviewMsg.classList.add('hidden');
        reviewMode = 'due';
    } else {
        // No words due
        if (problemWords.length > 0) {
            // Problem words exist
            const problemWordsText = i18n.getMessage('words_with_errors');
            countText.textContent = `${problemWords.length} ${problemWordsText}`;
            btn.textContent = i18n.getMessage('review_problem_words');
            btn.disabled = false;
            noReviewMsg.classList.add('hidden'); // Hide "All caught up" if showing problem words count
            reviewMode = 'problem';
        } else if (allWordsList.length > 0) {
            // No problem words, review all
            const totalWordsText = i18n.getMessage('words_total');
            countText.textContent = `${allWordsList.length} ${totalWordsText}`;
            btn.textContent = i18n.getMessage('review_all_words');
            btn.disabled = false;
            noReviewMsg.classList.add('hidden');
            reviewMode = 'all';
        } else {
            // No words at all
            countText.textContent = '0 words';
            btn.disabled = true;
            noReviewMsg.classList.add('hidden');
        }
    }
}

function startReview() {
    let url = chrome.runtime.getURL('src/review/review.html');
    if (reviewMode === 'all') url += '?mode=all';
    if (reviewMode === 'problem') url += '?mode=problem';
    chrome.tabs.create({ url });
}

function startFlashcards() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/flashcards/flashcards.html') });
}

function startContextCards() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/context-cards/context-cards.html') });
}

function startDefinitionCards() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/definition-cards/definition-cards.html') });
}

// Words Tab
let allWords = [];
let expandedCategories = new Set(); // Track expanded state

async function loadWordsTab() {
    allWords = await storage.getLearningList();
    const categories = await storage.getCategories();

    const totalWordsText = i18n.getMessage('total_words');
    document.getElementById('word-stats').innerHTML = `${totalWordsText} <span id="total-words">${allWords.length}</span>`;

    if (allWords.length === 0 && categories.length <= 1) { // Only default category and no words
        document.getElementById('no-words').classList.remove('hidden');
        document.getElementById('words-list').innerHTML = '';
    } else {
        document.getElementById('no-words').classList.add('hidden');
        renderCategories(categories, allWords);
    }
}

async function renderCategories(categories, words) {
    const container = document.getElementById('words-list');
    container.innerHTML = '';

    for (const category of categories) {
        const categoryWords = words.filter(w => (w.category || 'default') === category);
        const isActive = await storage.isCategoryActive(category);
        const isExpanded = expandedCategories.has(category);

        const categoryEl = document.createElement('div');
        categoryEl.className = 'category-block';
        categoryEl.dataset.category = category;

        categoryEl.innerHTML = `
            <div class="category-header">
                <div class="category-header-left">
                    <input type="checkbox" class="category-active-checkbox" ${isActive ? 'checked' : ''} title="Include in review">
                    <span class="category-toggle-icon">${isExpanded ? '▼' : '▶'}</span>
                    <span class="category-name">${category.charAt(0).toUpperCase() + category.slice(1)}</span>
                    <span class="category-count">(${categoryWords.length})</span>
                </div>
                <div class="category-header-right">
                    ${category !== 'default' ? `<button class="category-rename-btn" title="Rename">✏️</button>` : ''}
                    ${category !== 'default' ? `<button class="category-delete-btn" title="Delete">🗑️</button>` : ''}
                </div>
            </div>
            <div class="category-words ${isExpanded ? '' : 'hidden'}">
                <!-- Words injected here -->
            </div>
        `;

        // Render words inside
        const wordsContainer = categoryEl.querySelector('.category-words');
        if (categoryWords.length > 0) {
            wordsContainer.innerHTML = categoryWords.map(w => renderWordCard(w)).join('');
        } else {
            wordsContainer.innerHTML = `<div class="empty-category-msg">No words in this category</div>`;
        }

        container.appendChild(categoryEl);

        // Event Listeners
        const header = categoryEl.querySelector('.category-header');
        const checkbox = categoryEl.querySelector('.category-active-checkbox');
        const toggleIcon = categoryEl.querySelector('.category-toggle-icon');
        const renameBtn = categoryEl.querySelector('.category-rename-btn');
        const deleteBtn = categoryEl.querySelector('.category-delete-btn');

        // Toggle Expand/Collapse (clicking header, excluding controls)
        header.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target === renameBtn || e.target === deleteBtn) return;

            const isHidden = wordsContainer.classList.contains('hidden');
            if (isHidden) {
                wordsContainer.classList.remove('hidden');
                toggleIcon.textContent = '▼';
                expandedCategories.add(category);
            } else {
                wordsContainer.classList.add('hidden');
                toggleIcon.textContent = '▶';
                expandedCategories.delete(category);
            }
        });

        // Toggle Active Status
        checkbox.addEventListener('change', async (e) => {
            await storage.setCategoryActive(category, e.target.checked);
            // Reload review tab to update counts
            await loadReviewTab();
        });

        // Rename Category
        if (renameBtn) {
            renameBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newName = prompt('Rename category:', category);
                if (newName && newName.trim() && newName !== category) {
                    await storage.renameCategory(category, newName.trim().toLowerCase());
                    await loadWordsTab();
                }
            });
        }

        // Delete Category (only if empty)
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete category "${category}"?`)) {
                    await storage.deleteCategory(category);
                    await loadWordsTab();
                }
            });
        }

        // Word Delete Listeners
        wordsContainer.querySelectorAll('.delete-word-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wordId = btn.dataset.wordId;
                await deleteWord(wordId);
            });
        });

        // Word Detail Listeners
        wordsContainer.querySelectorAll('.word-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                showWordDetails(card.dataset.word);
            });
        });
    }
}

function renderWordCard(w) {
    const needsPractice = (w.wrongCount || 0) > 0;
    const cardClass = needsPractice ? 'word-card needs-practice' : 'word-card';

    return `
        <div class="${cardClass}" data-id="${w.id}" data-word="${w.word}">
            <div class="word-card-header">
                <div class="word-card-word">${w.word}</div>
                <div class="word-card-transcription">${w.transcription || ''}</div>
            </div>
            <div class="word-card-translation">${getTranslationForUser(w.translation)}</div>
            <div class="word-card-stats">
                <span>✅ ${w.correctCount || 0}</span>
                <span>❌ ${w.wrongCount || 0}</span>
                <button class="delete-word-btn" data-word-id="${w.id}" title="Delete Word">🗑️</button>
            </div>
        </div>
    `;
}

async function addNewCategory() {
    const name = prompt('Enter new category name:');
    if (name && name.trim()) {
        await storage.addCategory(name.trim().toLowerCase());
        await loadWordsTab();
    }
}

function filterWords() {
    const searchQuery = document.getElementById('word-search').value.toLowerCase();
    const container = document.getElementById('words-list');

    container.querySelectorAll('.category-block').forEach(block => {
        const words = block.querySelectorAll('.word-card');
        let hasVisibleWords = false;

        words.forEach(card => {
            const wordText = card.dataset.word.toLowerCase();
            const translation = card.querySelector('.word-card-translation').textContent.toLowerCase();

            if (wordText.includes(searchQuery) || translation.includes(searchQuery)) {
                card.style.display = 'flex';
                hasVisibleWords = true;
            } else {
                card.style.display = 'none';
            }
        });

        if (hasVisibleWords) {
            block.style.display = 'block';
            // Expand if searching
            if (searchQuery) {
                block.querySelector('.category-words').classList.remove('hidden');
                block.querySelector('.category-toggle-icon').textContent = '▼';
            }
        } else {
            block.style.display = 'none';
        }
    });
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

    const totalHistoryText = i18n.getMessage('total_history');
    document.getElementById('history-stats').innerHTML = `${totalHistoryText} <span id="total-history">${allHistory.length}</span>`;

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
    const categories = await storage.getCategories();

    container.innerHTML = words.map(w => {
        if (!w || !w.word) return ''; // Skip invalid entries

        const isAdded = list.some(item => item.word === w.word);
        const wordId = `history-${w.word.replace(/[^a-zA-Z0-9]/g, '_')}`;

        return `
            <div class="word-card" data-word="${w.word}">
                <div class="word-card-header">
                    <div class="word-card-word">${w.word}</div>
                    <div class="word-card-transcription">${w.transcription || ''}</div>
                </div>
                <div class="word-card-translation">${getTranslationForUser(w.translation)}</div>
                ${w.example ? `<div class="word-card-example">"${w.example}"</div>` : ''}
                <div class="word-card-stats">
                    <span>👁️ ${w.viewCount || 1}</span>
                    <span>📅 ${new Date(w.lastViewed).toLocaleDateString()}</span>
                    ${isAdded
                ? `<span style="color:#22c55e; margin-left:auto; font-size:11px;">✅ Added</span>`
                : `
                    <select id="cat-${wordId}" class="history-category-select" data-word="${w.word}">
                        ${categories.map(cat => `<option value="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('')}
                        <option value="__new__">+ New Category</option>
                    </select>
                    <button class="add-history-btn" data-word="${w.word}" data-select-id="cat-${wordId}">➕ Add</button>
                `
            }
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners for add buttons
    container.querySelectorAll('.add-history-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const word = btn.dataset.word;
            const selectId = btn.dataset.selectId;
            await addFromHistory(word, selectId);
        });
    });

    // Add click handler for word cards to show details
    container.querySelectorAll('.word-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger if clicking on select or buttons
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.closest('select') || e.target.closest('button')) {
                return;
            }
            const wordText = card.dataset.word;
            showWordDetails(wordText);
        });
    });

    // Add event listeners for category selects
    container.querySelectorAll('.history-category-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            if (e.target.value === '__new__') {
                const newCategory = prompt('Enter new category name:');
                if (newCategory && newCategory.trim()) {
                    const categoryName = newCategory.trim().toLowerCase();
                    await storage.addCategory(categoryName);

                    // Save the word to restore selection after reload
                    const word = select.dataset.word;

                    // Reload history to refresh dropdowns
                    await loadHistoryTab();

                    // Find and select the new category in the reloaded dropdown
                    const newSelect = document.querySelector(`.history-category-select[data-word="${word}"]`);
                    if (newSelect) {
                        newSelect.value = categoryName;
                    }
                } else {
                    e.target.value = 'default';
                }
            }
        });
    });
}

function filterHistory(e) {
    const query = e.target.value.toLowerCase();
    const filtered = allHistory.filter(w =>
        (w.word && w.word.toLowerCase().includes(query)) ||
        (w.translation && w.translation.toLowerCase().includes(query))
    );
    renderHistory(filtered);
}

async function addFromHistory(word, selectId) {
    const historyWord = allHistory.find(w => w.word === word);
    if (!historyWord) return;

    const list = await storage.getLearningList();
    if (list.some(w => w.word === word)) {
        alert('Word already in your learning list!');
        return;
    }

    // Get selected category
    const categorySelect = document.getElementById(selectId);
    const category = categorySelect ? categorySelect.value : 'default';

    // Don't add if "__new__" is selected
    if (category === '__new__') {
        alert('Please select a category first!');
        return;
    }

    // Add category to word data
    historyWord.category = category;

    await storage.addToLearningList(historyWord);

    // Refresh UI
    await loadHistoryTab(); // Will re-render with "Added" status
    await loadWordsTab();   // Update words count
    await loadReviewTab();  // Update review count
}

// Settings Tab
async function loadSettings() {
    const apiKey = await storage.getApiKey();
    if (apiKey) {
        document.getElementById('api-key').value = apiKey;
        await populateModels();
    }

    const settings = await chrome.storage.local.get([
        'geminiModel',
        'quizTranslation',
        'quizTranscription',
        'appLanguage',
        'tasksLimit',
        'simpleFlashcardsWordsLimit',
        'simpleFlashcardsExercisesLimit',
        'flashcardsWordsLimit',
        'flashcardsExercisesLimit',
        'defCardsWordsLimit',
        'defCardsExercisesLimit'
    ]);

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
    document.getElementById('flashcards-include-history').checked = settings.flashcardsIncludeHistory !== false;

    // Load word limits
    document.getElementById('tasks-limit').value = settings.tasksLimit || 20;
    document.getElementById('simple-flashcards-words-limit').value = settings.simpleFlashcardsWordsLimit || 25;
    document.getElementById('simple-flashcards-exercises-limit').value = settings.simpleFlashcardsExercisesLimit || 25;
    document.getElementById('flashcards-words-limit').value = settings.flashcardsWordsLimit || 25;
    document.getElementById('flashcards-exercises-limit').value = settings.flashcardsExercisesLimit || 25;
    document.getElementById('def-cards-words-limit').value = settings.defCardsWordsLimit || 10;
    document.getElementById('def-cards-exercises-limit').value = settings.defCardsExercisesLimit || 10;

    const uiLang = chrome.i18n.getUILanguage();
    let defaultLang = 'en';
    if (uiLang.startsWith('ru')) defaultLang = 'ru';
    else if (uiLang.startsWith('uk')) defaultLang = 'uk';

    document.getElementById('app-language').value = settings.appLanguage || defaultLang;

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
            select.innerHTML = '<option value="gemini-2.5-flash">Gemini 2.5 Flash (Default)</option>';
            console.error('Failed to fetch models:', response.error);
        }
    } catch (e) {
        select.innerHTML = '<option value="gemini-2.5-flash">Gemini 2.5 Flash (Default)</option>';
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
    const flashcardsIncludeHistory = document.getElementById('flashcards-include-history').checked;
    const appLanguage = document.getElementById('app-language').value;
    const tasksLimit = parseInt(document.getElementById('tasks-limit').value) || 20;
    const simpleFlashcardsWordsLimit = parseInt(document.getElementById('simple-flashcards-words-limit').value) || 25;
    const simpleFlashcardsExercisesLimit = parseInt(document.getElementById('simple-flashcards-exercises-limit').value) || 25;
    const flashcardsWordsLimit = parseInt(document.getElementById('flashcards-words-limit').value) || 25;
    const flashcardsExercisesLimit = parseInt(document.getElementById('flashcards-exercises-limit').value) || 25;
    const defCardsWordsLimit = parseInt(document.getElementById('def-cards-words-limit').value) || 10;
    const defCardsExercisesLimit = parseInt(document.getElementById('def-cards-exercises-limit').value) || 10;

    if (!quizTranslation && !quizTranscription) {
        alert('Select at least one quiz type!');
        return;
    }

    // Save API key via storage service (handles empty string)
    if (apiKey) {
        await storage.setApiKey(apiKey);
    } else {
        await chrome.storage.local.remove('apiKey'); // Remove if empty
    }
    // Save
    await chrome.storage.local.set({
        GEMINI_API_KEY: apiKey, // Keep GEMINI_API_KEY for direct access in some parts, though storage.setApiKey is preferred
        geminiModel: model,
        flashcardsIncludeHistory: flashcardsIncludeHistory,
        appLanguage: appLanguage,
        quizTranslation: quizTranslation,
        quizTranscription: quizTranscription,
        tasksLimit: tasksLimit,
        simpleFlashcardsWordsLimit: simpleFlashcardsWordsLimit,
        simpleFlashcardsExercisesLimit: simpleFlashcardsExercisesLimit,
        flashcardsWordsLimit: flashcardsWordsLimit,
        flashcardsExercisesLimit: flashcardsExercisesLimit,
        defCardsWordsLimit: defCardsWordsLimit,
        defCardsExercisesLimit: defCardsExercisesLimit
    });

    // Update language immediately
    await i18n.setLanguage(appLanguage);
    localizeHtml();

    // Visual feedback
    btn.textContent = i18n.getMessage('settings_saved') || '✅ Saved!';
    btn.style.background = '#22c55e';
    btn.disabled = true;

    // Refresh models list if key changed (or cleared)
    await populateModels();

    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.disabled = false;
    }, 2000);
}

async function handleExportData() {
    try {
        const json = await storage.exportData();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-subtitles-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const btn = document.getElementById('export-data-btn');
        const originalText = btn.textContent;
        btn.textContent = i18n.getMessage('settings_export_success') || 'Exported!';
        setTimeout(() => btn.textContent = originalText, 2000);
    } catch (e) {
        console.error(e);
        alert('Export failed: ' + e.message);
    }
}

async function handleImportData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const result = await storage.importData(e.target.result);
            if (result.success) {
                const btn = document.getElementById('import-data-btn');
                const originalText = btn.textContent;
                btn.textContent = i18n.getMessage('settings_import_success') || 'Imported!';
                setTimeout(() => btn.textContent = originalText, 2000);

                // Reload data to reflect changes
                await loadWordsTab();
                // If loadHistoryTab exists, call it. It's not in the snippet I saw but probably exists.
                // I'll check if loadHistoryTab is defined in the file.
                // Step 808 showed `if (tabName === 'history') loadHistoryTab();` so it exists.
                if (typeof loadHistoryTab === 'function') await loadHistoryTab();
                await loadSettings();
            } else {
                alert((i18n.getMessage('settings_import_error') || 'Import error') + ': ' + result.error);
            }
        } catch (err) {
            console.error(err);
            alert('Invalid file format');
        }
        // Reset input
        event.target.value = '';
    };
    reader.readAsText(file);
}

// Show detailed word popup
async function showWordDetails(word) {
    // Find word data from learning list or history
    const learningWord = allWords.find(w => w.word === word);
    const historyWord = allHistory.find(w => w.word === word);
    const wordData = learningWord || historyWord;

    if (!wordData) {
        console.error('Word not found:', word);
        return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'word-detail-overlay';
    overlay.innerHTML = `
        <div class="word-detail-modal">
            <button class="word-detail-close">×</button>
            <div class="word-detail-content">
                <div class="word-detail-header">
                    <h2>${wordData.word}</h2>
                    <p class="word-detail-transcription">${wordData.transcription || ''}</p>
                </div>
                <div class="word-detail-translation">
                    <strong>${i18n.getMessage('word_detail_translation')}</strong> ${getTranslationForUser(wordData.translation)}
                </div>
                ${wordData.explanation ? `
                    <div class="word-detail-explanation">
                        <strong>${i18n.getMessage('word_detail_explanation')}</strong> ${wordData.explanation}
                    </div>
                ` : ''}
                ${wordData.examples && wordData.examples.length > 0 ? `
                    <div class="word-detail-examples">
                        <strong>${i18n.getMessage('word_detail_examples')}</strong>
                        <ul>
                            ${wordData.examples.map(ex => `<li>${ex}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                ${wordData.example ? `
                    <div class="word-detail-example">
                        <strong>${i18n.getMessage('word_detail_example')}</strong> "${wordData.example}"
                    </div>
                ` : ''}
                ${learningWord ? `
                    <div class="word-detail-stats">
                        <div class="stat-item">
                            <span class="stat-label">${i18n.getMessage('word_detail_category')}</span>
                            <span class="stat-value">${(learningWord.category || 'default').charAt(0).toUpperCase() + (learningWord.category || 'default').slice(1)}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">${i18n.getMessage('word_detail_correct')}</span>
                            <span class="stat-value correct">✅ ${learningWord.correctCount || 0}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">${i18n.getMessage('word_detail_wrong')}</span>
                            <span class="stat-value wrong">❌ ${learningWord.wrongCount || 0}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">${i18n.getMessage('word_detail_added')}</span>
                            <span class="stat-value">${new Date(learningWord.addedAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close on overlay click or close button
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.classList.contains('word-detail-close')) {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 300);
        }
    });
}
