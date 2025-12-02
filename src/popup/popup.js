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

    // Auto-save settings listeners
    const settingsInputs = [
        'api-key', 'gemini-model',
        'flashcards-include-history', 'app-language', 'tasks-limit',
        'simple-flashcards-words-limit', 'simple-flashcards-exercises-limit',
        'flashcards-words-limit', 'flashcards-exercises-limit',
        'def-cards-words-limit', 'def-cards-exercises-limit',
        'tts-enabled', 'tts-auto-generate', 'tts-difficulty', 'tts-voice',
        'notifications-enabled', 'notification-frequency', 'notification-min-words',
        'notification-quiet-start', 'notification-quiet-end',
        'notification-sound', 'notification-require-interaction'
    ];

    settingsInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', autoSaveSettings);
            if (el.tagName === 'INPUT' && el.type === 'text') {
                el.addEventListener('input', debounce(autoSaveSettings, 500));
            }
        }
    });

    // Special handling for notification frequency - update alarm when changed
    const notificationFrequencyInput = document.getElementById('notification-frequency');
    if (notificationFrequencyInput) {
        notificationFrequencyInput.addEventListener('change', async () => {
            await autoSaveSettings();
            // Notify background to update alarm
            chrome.runtime.sendMessage({ type: 'UPDATE_NOTIFICATION_ALARM' });
        });
    }

    // Special handling for notifications enabled - toggle details visibility
    const notificationsEnabledCheckbox = document.getElementById('notifications-enabled');
    const notificationDetails = document.getElementById('notification-details');
    if (notificationsEnabledCheckbox && notificationDetails) {
        notificationsEnabledCheckbox.addEventListener('change', () => {
            notificationDetails.style.display = notificationsEnabledCheckbox.checked ? 'block' : 'none';
        });
    }

    // Special handling for quiz types to ensure at least one is selected
    const quizInputs = ['quiz-translation', 'quiz-transcription'];
    quizInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const translation = document.getElementById('quiz-translation');
                const transcription = document.getElementById('quiz-transcription');

                if (!translation.checked && !transcription.checked) {
                    e.target.checked = true; // Revert
                    // Optional: alert or toast
                    alert('At least one quiz type must be selected!');
                    return;
                }
                autoSaveSettings();
            });
        }
    });

    setupAddWordModal();
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

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

    const newWordInput = document.getElementById('new-word-input');
    if (newWordInput) newWordInput.placeholder = i18n.getMessage('popup_enter_word_placeholder');
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
                    <button class="add-word-to-category-btn" title="Add Word">➕</button>
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
            wordsContainer.innerHTML = categoryWords.map(w => renderWordCard(w, categories)).join('');
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
        const addWordBtn = categoryEl.querySelector('.add-word-to-category-btn');

        // Add Word Listener
        if (addWordBtn) {
            addWordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAddWordModal(category);
            });
        }

        // Toggle Expand/Collapse (clicking header, excluding controls)
        header.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target === renameBtn || e.target === deleteBtn || e.target === addWordBtn) return;

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

        // TTS Button Listeners
        wordsContainer.querySelectorAll('.tts-btn-small').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wordId = btn.dataset.wordId;
                const word = btn.dataset.word;
                const hasTTS = btn.dataset.hasTts === 'true';

                if (hasTTS) {
                    // Play existing audio
                    await playWordTTS(wordId);
                } else {
                    // Generate new audio
                    await generateWordTTS(wordId, word);
                }
            });

            // Right-click to regenerate TTS
            btn.addEventListener('contextmenu', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const wordId = btn.dataset.wordId;
                const word = btn.dataset.word;

                if (confirm(`Regenerate pronunciation for "${word}"?`)) {
                    await regenerateWordTTS(wordId, word);
                }
            });
        });

        // Word Detail Listeners
        wordsContainer.querySelectorAll('.word-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.closest('button') || e.target.closest('select')) return;
                showWordDetails(card.dataset.word);
            });
        });

        // Category Change Listeners
        wordsContainer.querySelectorAll('.word-category-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                e.stopPropagation();
                const wordId = select.dataset.wordId;
                const newCategory = select.value;
                await storage.updateWordCategory(wordId, newCategory);
                await loadWordsTab();
                await loadReviewTab();
            });
        });
    }
}

function renderWordCard(w, categories) {
    const needsPractice = (w.wrongCount || 0) > 0;
    const cardClass = needsPractice ? 'word-card needs-practice' : 'word-card';
    const hasTTS = w.ttsAudio && w.ttsAudio.length > 0;

    const langCode = w.word_language ? (w.word_language.substring(0, 2).toUpperCase()) : '??';

    return `
        <div class="${cardClass}" data-id="${w.id}" data-word="${w.word}">
            <div class="word-card-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="lang-badge-small" title="${w.word_language || 'Unknown'}">${langCode}</span>
                    <div class="word-card-word">${w.word}</div>
                    <button class="tts-btn-small" data-word-id="${w.id}" data-word="${w.word}" data-has-tts="${hasTTS}" title="${hasTTS ? 'Play pronunciation' : 'Generate pronunciation'}">${hasTTS ? '🔊' : '🔇'}</button>
                </div>
                <div class="word-card-transcription">${w.transcription || ''}</div>
            </div>
            <div class="word-card-translation">${getTranslationForUser(w.translation)}</div>
            <div class="word-card-stats">
                <span>✅ ${w.correctCount || 0}</span>
                <span>❌ ${w.wrongCount || 0}</span>
                <select class="word-category-select" data-word-id="${w.id}" style="font-size: 11px; padding: 2px 4px; border-radius: 4px; background: #1e293b; color: #94a3b8; border: 1px solid #334155;">
                    ${categories.map(cat => `<option value="${cat}" ${w.category === cat ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('')}
                </select>
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

// TTS Functions
async function playWordTTS(wordId) {
    try {
        const list = await storage.getLearningList();
        const wordData = list.find(w => w.id === wordId);

        if (wordData && wordData.ttsAudio) {
            const mimeType = wordData.ttsMimeType || 'audio/L16;codec=pcm;rate=24000';
            playAudioFromBase64(wordData.ttsAudio, mimeType);
        } else {
            alert('No audio data for this word');
        }
    } catch (error) {
        console.error('Error playing TTS:', error);
        alert('Error playing audio');
    }
}

async function generateWordTTS(wordId, word) {
    try {
        const btn = document.querySelector(`.tts-btn-small[data-word-id="${wordId}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳';
        }

        const response = await chrome.runtime.sendMessage({
            type: 'GENERATE_TTS',
            wordId: wordId,
            word: word
        });

        if (response.success) {
            // Reload to show updated button
            await loadWordsTab();
        } else {
            alert('Error generating speech: ' + response.error);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔇';
            }
        }
    } catch (error) {
        console.error('Error generating TTS:', error);
        alert('Error generating speech');
    }
}

async function regenerateWordTTS(wordId, word) {
    try {
        const btn = document.querySelector(`.tts-btn-small[data-word-id="${wordId}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳';
        }

        const response = await chrome.runtime.sendMessage({
            type: 'REGENERATE_TTS',
            wordId: wordId,
            word: word
        });

        if (response.success) {
            // Reload to show updated button
            await loadWordsTab();
        } else {
            alert('Error regenerating speech: ' + response.error);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔊';
            }
        }
    } catch (error) {
        console.error('Error regenerating TTS:', error);
        alert('Error regenerating speech');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔊';
        }
    }
}

async function playHistoryTTS(word) {
    try {
        const result = await chrome.storage.local.get('wordHistory');
        const history = result.wordHistory || [];
        const wordData = history.find(w => w.word === word);

        if (wordData && wordData.ttsAudio) {
            const mimeType = wordData.ttsMimeType || 'audio/L16;codec=pcm;rate=24000';
            playAudioFromBase64(wordData.ttsAudio, mimeType);
        } else {
            alert('No audio data for this word');
        }
    } catch (error) {
        console.error('Error playing TTS:', error);
        alert('Error playing audio');
    }
}

// Helper function to play audio from base64
// Convert raw PCM audio to WAV format by adding WAV headers
function pcmToWav(pcmData, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
    const dataLength = pcmData.length;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // WAV Header
    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLength, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // ByteRate
    view.setUint16(32, numChannels * bitsPerSample / 8, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample

    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataLength, true); // Subchunk2Size

    // Copy PCM data
    const pcmView = new Uint8Array(buffer, 44);
    pcmView.set(pcmData);

    return new Uint8Array(buffer);
}

function playAudioFromBase64(base64Audio, mimeType = 'audio/L16;codec=pcm;rate=24000') {
    try {
        console.log('[Popup] Playing audio, base64 length:', base64Audio.length);

        const byteCharacters = atob(base64Audio);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const pcmData = new Uint8Array(byteNumbers);

        // Convert PCM to WAV if the MIME type indicates PCM format
        let audioData;
        let audioMimeType;

        if (mimeType.includes('L16') || mimeType.includes('pcm')) {
            console.log('[Popup] Converting PCM to WAV format');
            audioData = pcmToWav(pcmData, 24000, 1, 16);
            audioMimeType = 'audio/wav';
        } else {
            audioData = pcmData;
            audioMimeType = mimeType;
        }

        const blob = new Blob([audioData], { type: audioMimeType });
        const audioUrl = URL.createObjectURL(blob);

        console.log('[Popup] Created blob URL:', audioUrl, 'MIME:', audioMimeType, 'Blob size:', blob.size);

        const audio = new Audio(audioUrl);

        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl);
        });

        audio.addEventListener('error', (e) => {
            console.error('[Popup] Audio playback error:', e);
            console.error('[Popup] Audio error details:', {
                code: audio.error?.code,
                message: audio.error?.message
            });
        });

        audio.play().catch(err => {
            console.error('[Popup] Play failed:', err);
        });
    } catch (error) {
        console.error('[Popup] Error playing audio:', error);
    }
}

async function generateHistoryTTS(word) {
    try {
        const btn = document.querySelector(`.history-tts-btn[data-word="${word}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳';
        }

        const response = await chrome.runtime.sendMessage({
            type: 'GENERATE_HISTORY_TTS',
            word: word
        });

        if (response.success) {
            // Reload to show updated button
            await loadHistoryTab();
        } else {
            alert('Error generating speech: ' + response.error);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔇';
            }
        }
    } catch (error) {
        console.error('Error generating TTS:', error);
        alert('Error generating speech');
    }
}

async function regenerateHistoryTTS(word) {
    try {
        const btn = document.querySelector(`.history-tts-btn[data-word="${word}"]`);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳';
        }

        const response = await chrome.runtime.sendMessage({
            type: 'REGENERATE_HISTORY_TTS',
            word: word
        });

        if (response.success) {
            // Reload to show updated button
            await loadHistoryTab();
        } else {
            alert('Error regenerating speech: ' + response.error);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔊';
            }
        }
    } catch (error) {
        console.error('Error regenerating TTS:', error);
        alert('Error regenerating speech');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔊';
        }
    }
}

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
        const hasTTS = w.ttsAudio && w.ttsAudio.length > 0;

        const langCode = w.word_language ? (w.word_language.substring(0, 2).toUpperCase()) : '??';

        return `
            <div class="word-card" data-word="${w.word}">
                <div class="word-card-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="lang-badge-small" title="${w.word_language || 'Unknown'}">${langCode}</span>
                        <div class="word-card-word">${w.word}</div>
                        <button class="tts-btn-small history-tts-btn" data-word="${w.word}" data-has-tts="${hasTTS}" title="${hasTTS ? 'Play pronunciation' : 'Generate pronunciation'}">${hasTTS ? '🔊' : '🔇'}</button>
                    </div>
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
                    <select id="cat-${wordId}" class="history-category-select" data-word="${w.word}" style="margin-left: auto;">
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

    // Add event listeners for TTS buttons
    container.querySelectorAll('.history-tts-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const word = btn.dataset.word;
            const hasTTS = btn.dataset.hasTts === 'true';

            if (hasTTS) {
                // Play from history
                await playHistoryTTS(word);
            } else {
                // Generate for history word
                await generateHistoryTTS(word);
            }
        });

        // Right-click to regenerate TTS
        btn.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const word = btn.dataset.word;

            if (confirm(`Regenerate pronunciation for "${word}"?`)) {
                await regenerateHistoryTTS(word);
            }
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

    // Add context menu for history cards
    container.querySelectorAll('.word-card').forEach(card => {
        card.addEventListener('contextmenu', (e) => {
            // Don't show context menu if clicking on controls
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.closest('select') || e.target.closest('button')) {
                return;
            }

            e.preventDefault();
            const word = card.dataset.word;
            showHistoryContextMenu(e.clientX, e.clientY, word);
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

function showHistoryContextMenu(x, y, word) {
    // Remove existing context menu
    const existingMenu = document.getElementById('history-context-menu');
    if (existingMenu) existingMenu.remove();

    // Create context menu
    const menu = document.createElement('div');
    menu.id = 'history-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 4px 0;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        min-width: 160px;
    `;

    menu.innerHTML = `
        <div class="context-menu-item" data-action="delete">
            <span>🗑️</span>
            <span>${i18n.getMessage('delete_from_history') || 'Delete from history'}</span>
        </div>
    `;

    document.body.appendChild(menu);

    // Add styles for menu items
    const style = document.createElement('style');
    style.textContent = `
        .context-menu-item {
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            color: #e2e8f0;
            font-size: 14px;
            transition: background 0.2s;
        }
        .context-menu-item:hover {
            background: #334155;
        }
    `;
    if (!document.getElementById('context-menu-styles')) {
        style.id = 'context-menu-styles';
        document.head.appendChild(style);
    }

    // Handle menu item click
    menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (confirm(`Delete "${word}" from history?`)) {
            await storage.deleteFromHistory(word);
            await loadHistoryTab();
        }
        menu.remove();
    });

    // Close menu on click outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
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
        'flashcardsIncludeHistory', // Explicitly request this key
        'appLanguage',
        'tasksLimit',
        'simpleFlashcardsWordsLimit',
        'simpleFlashcardsExercisesLimit',
        'flashcardsWordsLimit',
        'flashcardsExercisesLimit',
        'defCardsWordsLimit',
        'defCardsExercisesLimit',
        'ttsEnabled',
        'ttsAutoGenerate',
        'ttsDifficulty',
        'ttsVoice',
        'notificationsEnabled',
        'notificationFrequency',
        'notificationMinWords',
        'notificationQuietStart',
        'notificationQuietEnd',
        'notificationSound',
        'notificationRequireInteraction'
    ]);

    console.log('[Popup] Loaded settings:', settings);
    console.log('[Popup] flashcardsIncludeHistory value:', settings.flashcardsIncludeHistory);

    if (settings.geminiModel) {
        const select = document.getElementById('gemini-model');
        // If model exists in list, select it. If not (and list populated), add it or warn?
        // For now just set value, if it's not in list it might show empty or default
        if (select.querySelector(`option[value = "${settings.geminiModel}"]`)) {
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

    // Load TTS settings
    document.getElementById('tts-enabled').checked = settings.ttsEnabled !== false;
    document.getElementById('tts-auto-generate').checked = settings.ttsAutoGenerate !== false;
    document.getElementById('tts-difficulty').value = settings.ttsDifficulty || 'B2';
    document.getElementById('tts-voice').value = settings.ttsVoice || 'Zephyr';

    // Load notification settings
    document.getElementById('notifications-enabled').checked = settings.notificationsEnabled !== false;
    document.getElementById('notification-frequency').value = settings.notificationFrequency || 240;
    document.getElementById('notification-min-words').value = settings.notificationMinWords ?? 5;
    document.getElementById('notification-quiet-start').value = settings.notificationQuietStart ?? 22;
    document.getElementById('notification-quiet-end').value = settings.notificationQuietEnd ?? 8;
    document.getElementById('notification-sound').checked = settings.notificationSound !== false;
    document.getElementById('notification-require-interaction').checked = settings.notificationRequireInteraction === true;

    // Toggle notification details visibility based on enabled state
    const notificationDetails = document.getElementById('notification-details');
    if (notificationDetails) {
        notificationDetails.style.display = settings.notificationsEnabled !== false ? 'block' : 'none';
    }

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
            if (settings.geminiModel && select.querySelector(`option[value = "${settings.geminiModel}"]`)) {
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

async function autoSaveSettings() {
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

    // Get TTS settings
    const ttsEnabled = document.getElementById('tts-enabled').checked;
    const ttsAutoGenerate = document.getElementById('tts-auto-generate').checked;
    const ttsDifficulty = document.getElementById('tts-difficulty').value;
    const ttsVoice = document.getElementById('tts-voice').value;

    // Get notification settings
    const notificationsEnabled = document.getElementById('notifications-enabled').checked;
    const notificationFrequency = parseInt(document.getElementById('notification-frequency').value) || 240;
    const notificationMinWords = parseInt(document.getElementById('notification-min-words').value) ?? 5;
    const notificationQuietStart = parseInt(document.getElementById('notification-quiet-start').value) ?? 22;
    const notificationQuietEnd = parseInt(document.getElementById('notification-quiet-end').value) ?? 8;
    const notificationSound = document.getElementById('notification-sound').checked;
    const notificationRequireInteraction = document.getElementById('notification-require-interaction').checked;

    if (!quizTranslation && !quizTranscription) {
        // Don't save invalid state, maybe show toast?
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
        GEMINI_API_KEY: apiKey,
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
        defCardsExercisesLimit: defCardsExercisesLimit,
        ttsEnabled: ttsEnabled,
        ttsAutoGenerate: ttsAutoGenerate,
        ttsDifficulty: ttsDifficulty,
        ttsVoice: ttsVoice,
        notificationsEnabled: notificationsEnabled,
        notificationFrequency: notificationFrequency,
        notificationMinWords: notificationMinWords,
        notificationQuietStart: notificationQuietStart,
        notificationQuietEnd: notificationQuietEnd,
        notificationSound: notificationSound,
        notificationRequireInteraction: notificationRequireInteraction
    });

    // Update i18n if language changed
    if (i18n.language !== appLanguage) {
        await i18n.setLanguage(appLanguage);
        localizeHtml();
        // Refresh tabs to apply language
        loadWordsTab();
        loadReviewTab();
        loadHistoryTab();
    }

    console.log('Settings auto-saved');
}

async function handleExportData() {
    try {
        const json = await storage.exportData();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai - subtitles - backup - ${new Date().toISOString().slice(0, 10)}.json`;
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
                // Step 808 showed `if (tabName === 'history') loadHistoryTab(); ` so it exists.
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
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <h2 style="margin: 0;">${wordData.word}</h2>
                        <span class="lang-badge-small" style="font-size: 12px; padding: 4px 8px;" title="${wordData.word_language || 'Unknown'}">${wordData.word_language ? (wordData.word_language.substring(0, 2).toUpperCase()) : '??'}</span>
                    </div>
                    <p class="word-detail-transcription" style="margin: 4px 0 0 0;">${wordData.transcription || ''}</p>
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

// Add Word Modal Logic
let currentAddCategory = 'default';
let currentWordData = null;

function setupAddWordModal() {
    const modal = document.getElementById('add-word-modal');
    if (!modal) return;

    const closeBtn = modal.querySelector('.close-modal');
    const cancelBtn = document.getElementById('cancel-add-word');
    const confirmBtn = document.getElementById('confirm-add-word');
    const fetchBtn = document.getElementById('fetch-word-btn');
    const wordInput = document.getElementById('new-word-input');

    const closeModal = () => {
        modal.classList.add('hidden');
        // Reset state
        wordInput.value = '';
        document.getElementById('word-preview-area').classList.add('hidden');
        document.getElementById('word-result').classList.add('hidden');
        document.getElementById('word-error').classList.add('hidden');

        // Reset buttons
        fetchBtn.classList.remove('hidden');
        confirmBtn.classList.add('hidden');
        fetchBtn.disabled = false;
        confirmBtn.disabled = false;

        currentWordData = null;
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    // Fetch word logic
    const handleFetch = async (overrideLanguage = null) => {
        const word = wordInput.value.trim();
        if (!word) return;

        // UI Updates
        document.getElementById('word-preview-area').classList.remove('hidden');
        document.getElementById('word-loading').classList.remove('hidden');
        document.getElementById('word-result').classList.add('hidden');
        document.getElementById('word-error').classList.add('hidden');
        fetchBtn.disabled = true;

        try {
            const messagePayload = { type: 'EXPLAIN_WORD', word: word };
            if (overrideLanguage) {
                messagePayload.overrideLanguage = overrideLanguage;
            }

            const response = await chrome.runtime.sendMessage(messagePayload);

            document.getElementById('word-loading').classList.add('hidden');
            fetchBtn.disabled = false;

            if (response && response.success) {
                const data = response.data;
                currentWordData = data;
                currentWordData.word = word; // Ensure word is set

                // Populate fields
                document.getElementById('preview-word').textContent = word;
                document.getElementById('preview-translation').value = getTranslationForUser(data.translation);
                document.getElementById('preview-transcription').value = data.transcription || '';
                document.getElementById('preview-definition').value = data.explanation || '';

                const langEl = document.getElementById('preview-language');
                langEl.textContent = data.word_language || 'Unknown';
                langEl.dataset.fullLanguage = data.word_language || 'English';

                document.getElementById('word-result').classList.remove('hidden');

                // Switch buttons
                fetchBtn.classList.add('hidden');
                confirmBtn.classList.remove('hidden');
                confirmBtn.disabled = false;
            } else {
                const errorMsg = document.getElementById('word-error');
                errorMsg.textContent = response.error || 'Failed to fetch word details';
                errorMsg.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error fetching word:', error);
            document.getElementById('word-loading').classList.add('hidden');
            fetchBtn.disabled = false;
            const errorMsg = document.getElementById('word-error');
            errorMsg.textContent = 'Error: ' + error.message;
            errorMsg.classList.remove('hidden');
        }
    };

    fetchBtn.addEventListener('click', () => handleFetch());
    wordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleFetch();
    });

    // Language badge click handler
    document.getElementById('preview-language').addEventListener('click', () => {
        const currentLang = document.getElementById('preview-language').dataset.fullLanguage || 'English';
        const message = `Current language: ${currentLang}\n\nEnter the correct language:`;
        const newLang = prompt(message, currentLang);

        if (newLang && newLang.trim() && newLang.trim() !== currentLang) {
            handleFetch(newLang.trim());
        }
    });

    // Confirm Add
    confirmBtn.addEventListener('click', async () => {
        if (!currentWordData) return;

        // Update data from inputs
        currentWordData.translation = document.getElementById('preview-translation').value;
        currentWordData.transcription = document.getElementById('preview-transcription').value;
        currentWordData.explanation = document.getElementById('preview-definition').value;
        currentWordData.category = currentAddCategory;

        // Save
        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Adding...';

            await chrome.runtime.sendMessage({
                type: 'ADD_TO_LEARN',
                data: currentWordData
            });

            // Auto-generate TTS if enabled
            const settings = await chrome.storage.local.get(['ttsSettings']);
            const ttsSettings = settings.ttsSettings || {};
            if (ttsSettings.enabled !== false && ttsSettings.autoGenerate !== false) {
                // We don't need to wait for this
                chrome.runtime.sendMessage({
                    type: 'GENERATE_TTS_FOR_WORD_DATA',
                    wordData: currentWordData
                });
            }

            // Refresh and close
            await loadWordsTab();
            closeModal();
            confirmBtn.textContent = i18n.getMessage('popup_add_btn');
        } catch (error) {
            console.error('Error saving word:', error);
            alert('Failed to save word');
            confirmBtn.disabled = false;
            confirmBtn.textContent = i18n.getMessage('popup_add_btn');
        }
    });
}

function openAddWordModal(category) {
    currentAddCategory = category;
    const modal = document.getElementById('add-word-modal');
    if (modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('new-word-input');
        if (input) input.focus();
    }
}
