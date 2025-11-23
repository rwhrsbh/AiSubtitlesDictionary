// Word Popup Logic

// Helper function to extract translation based on user language
function getTranslationForUser(translation) {
    if (!translation) return '';

    // If translation is a string, try to parse it as JSON first
    if (typeof translation === 'string') {
        try {
            if (translation.trim().startsWith('{')) {
                const parsed = JSON.parse(translation);
                if (typeof parsed === 'object' && parsed !== null) {
                    translation = parsed;
                }
            }
        } catch (e) {
            // Not valid JSON, continue as string
        }
    }

    // If translation is still a string, return it
    if (typeof translation === 'string') return translation;

    // If translation is an object, extract based on user language
    if (typeof translation === 'object' && translation !== null) {
        const userLang = window.AiSubtitlesI18n.language || 'ru';

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

window.openWordPopup = async function (word, x, y) {
    await window.AiSubtitlesI18n.init();
    // Remove existing popup
    const existing = document.querySelector('.aisub-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'aisub-popup';
    // Use fixed positioning to ensure it works with clientX/Y
    popup.style.position = 'fixed';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    popup.innerHTML = `
        <div class="aisub-popup-header">
            <div style="display: flex; align-items: center; gap: 6px;">
                <button class="aisub-tts-btn aisub-tts-loading" style="background: none; border: none; padding: 2px; font-size: 16px; cursor: wait; opacity: 0.5; line-height: 1;" title="Loading pronunciation...">🔊</button>
                <span class="aisub-popup-word">${word}</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span class="aisub-lang-badge" style="display: none; background: #3b82f6; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; user-select: none;" title="Click to change language">...</span>
                <span class="aisub-popup-close">✕</span>
            </div>
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

    // Append to fullscreen element if exists, otherwise body
    const targetContainer = document.fullscreenElement || document.body;
    targetContainer.appendChild(popup);

    // Load categories
    loadCategories(popup);

    // Close handler
    popup.querySelector('.aisub-popup-close').addEventListener('click', () => popup.remove());

    // TTS button handler
    popup.querySelector('.aisub-tts-btn').addEventListener('click', (e) => {
        const ttsBtn = e.target.closest('.aisub-tts-btn'); // Ensure we get the button
        const audioData = ttsBtn.dataset.audio;
        const mimeType = ttsBtn.dataset.mimeType || 'audio/L16;codec=pcm;rate=24000';
        if (audioData) {
            playAudioFromBase64(audioData, mimeType, ttsBtn);
        }
    });

    // Fetch explanation from Gemini via Background
    const learnBtn = popup.querySelector('#aisub-learn-btn');
    learnBtn.disabled = true;
    learnBtn.style.opacity = '0.5';
    learnBtn.style.cursor = 'not-allowed';

    // Function to fetch explanation (can be called with optional language override)
    const fetchExplanation = (overrideLanguage = null) => {
        const langBadge = popup.querySelector('.aisub-lang-badge');
        const content = popup.querySelector('.aisub-popup-content');

        // Show loading state
        content.innerHTML = `<div class="aisub-loading">${window.AiSubtitlesI18n.getMessage('popup_loading_explanation')}</div>`;
        learnBtn.disabled = true;
        learnBtn.style.opacity = '0.5';
        learnBtn.style.cursor = 'not-allowed';

        const messagePayload = { type: 'EXPLAIN_WORD', word: word };
        if (overrideLanguage) {
            messagePayload.overrideLanguage = overrideLanguage;
        }

        chrome.runtime.sendMessage(messagePayload, (response) => {
            if (response && response.success) {
                console.log('[Word Popup] Response data:', response.data);

                // Normalize translation if it's a JSON string (fixes issue where raw JSON is displayed/saved)
                if (typeof response.data.translation === 'string') {
                    try {
                        if (response.data.translation.trim().startsWith('{')) {
                            response.data.translation = JSON.parse(response.data.translation);
                        }
                    } catch (e) {
                        console.error('[Word Popup] Failed to parse translation JSON:', e);
                    }
                }

                // Determine user language (ru, en, uk)
                const userLang = window.AiSubtitlesI18n.language || 'ru';

                // Extract translation
                const displayTranslation = getTranslationForUser(response.data.translation);

                const transcription = response.data.transcription || '';
                const explanation = response.data.explanation || '';

                content.innerHTML = `
                    <div><strong>${window.AiSubtitlesI18n.getMessage('popup_transcription')}:</strong> ${transcription}</div>
                    <div><strong>${window.AiSubtitlesI18n.getMessage('popup_translation')}:</strong> ${displayTranslation}</div>
                    <div style="margin-top:8px; font-size:12px; color:#ccc;">${explanation}</div>
                `;

                // Show language badge
                const detectedLang = response.data.word_language || 'Unknown';
                const langCodes = {
                    'English': 'EN', 'Russian': 'RU', 'Ukrainian': 'UK',
                    'Spanish': 'ES', 'French': 'FR', 'German': 'DE',
                    'Italian': 'IT', 'Portuguese': 'PT', 'Chinese': 'ZH',
                    'Japanese': 'JA', 'Korean': 'KO', 'Arabic': 'AR'
                };
                const langCode = langCodes[detectedLang] || detectedLang.substring(0, 2).toUpperCase();
                langBadge.textContent = langCode;
                langBadge.style.display = 'inline-block';
                langBadge.dataset.fullLanguage = detectedLang;

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

                // Auto-generate TTS in background if enabled
                generateTTSInBackground(response.data, popup);
            } else {
                content.innerHTML = `<div style="color:#ef4444;">${window.AiSubtitlesI18n.getMessage('error_prefix')} ${response.error || window.AiSubtitlesI18n.getMessage('error_unknown')}</div>`;
                // Hide TTS button if explanation failed
                const ttsBtn = popup.querySelector('.aisub-tts-btn');
                if (ttsBtn) ttsBtn.style.display = 'none';
            }
        });
    };

    // Initial fetch
    fetchExplanation();

    // Language badge click handler
    popup.querySelector('.aisub-lang-badge').addEventListener('click', () => {
        const languages = [
            'English', 'Russian', 'Ukrainian', 'Spanish', 'French', 'German',
            'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Arabic'
        ];

        const currentLang = popup.querySelector('.aisub-lang-badge').dataset.fullLanguage || 'English';
        const message = `Current language: ${currentLang}\n\nEnter the correct language:`;
        const newLang = prompt(message, currentLang);

        if (newLang && newLang.trim() && newLang.trim() !== currentLang) {
            fetchExplanation(newLang.trim());
            // Note: TTS will be regenerated automatically in fetchExplanation -> generateTTSInBackground
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
        // Update existing entry with new data (keep viewCount and TTS if exists)
        const oldViewCount = history[existingIndex].viewCount || 1;
        const oldTTSAudio = history[existingIndex].ttsAudio;
        const oldTTSLanguage = history[existingIndex].ttsLanguage;
        const oldTTSDifficulty = history[existingIndex].ttsDifficulty;
        const oldTTSMimeType = history[existingIndex].ttsMimeType;

        history[existingIndex] = {
            ...wordData,
            lastViewed: Date.now(),
            viewCount: oldViewCount + 1,
            // Keep old TTS if new one not provided
            ttsAudio: wordData.ttsAudio || oldTTSAudio,
            ttsLanguage: wordData.ttsLanguage || oldTTSLanguage,
            ttsDifficulty: wordData.ttsDifficulty || oldTTSDifficulty,
            ttsMimeType: wordData.ttsMimeType || oldTTSMimeType
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

// Generate TTS in background
async function generateTTSInBackground(wordData, popup) {
    console.log('[Word Popup] generateTTSInBackground called for word:', wordData.word);
    try {
        // Request TTS generation from background
        chrome.runtime.sendMessage({
            type: 'GENERATE_TTS_FOR_WORD_DATA',
            wordData: wordData
        }, async (response) => {
            console.log('[Word Popup] TTS response:', response);
            if (response && response.success && response.audio) {
                console.log('[Word Popup] TTS generated successfully, audio length:', response.audio.length);
                console.log('[Word Popup] MIME type:', response.mimeType);

                // Update wordData with TTS audio
                wordData.ttsAudio = response.audio;
                wordData.ttsLanguage = response.language;
                wordData.ttsDifficulty = response.difficulty;
                wordData.ttsMimeType = response.mimeType;

                // Update history with TTS data
                const result = await chrome.storage.local.get(['wordHistory']);
                let history = result.wordHistory || [];
                const index = history.findIndex(w => w.word === wordData.word);

                if (index >= 0) {
                    console.log('[Word Popup] Updating history entry with TTS data');
                    history[index].ttsAudio = response.audio;
                    history[index].ttsLanguage = response.language;
                    history[index].ttsDifficulty = response.difficulty;
                    history[index].ttsMimeType = response.mimeType;
                    await chrome.storage.local.set({ wordHistory: history });
                    console.log('[Word Popup] History updated with TTS data');
                }

                // Show TTS button in popup if it exists
                if (popup) {
                    const ttsBtn = popup.querySelector('.aisub-tts-btn');
                    if (ttsBtn) {
                        ttsBtn.classList.remove('aisub-tts-loading');
                        ttsBtn.style.cursor = 'pointer';
                        ttsBtn.style.opacity = '1';
                        ttsBtn.title = 'Play pronunciation';
                        ttsBtn.dataset.audio = response.audio;
                        ttsBtn.dataset.mimeType = response.mimeType;
                    }
                }
            } else {
                console.log('[Word Popup] TTS generation skipped or failed:', response);

                // Handle Quota Exceeded specifically
                if (response && response.error === 'TTS_QUOTA_EXCEEDED') {
                    if (popup) {
                        const ttsBtn = popup.querySelector('.aisub-tts-btn');
                        if (ttsBtn) {
                            ttsBtn.classList.remove('aisub-tts-loading');
                            ttsBtn.style.opacity = '0.5';
                            ttsBtn.style.cursor = 'not-allowed';
                            ttsBtn.title = window.AiSubtitlesI18n.getMessage('error_tts_quota');
                            ttsBtn.onclick = () => alert(window.AiSubtitlesI18n.getMessage('error_tts_quota'));
                        }
                    }
                } else {
                    // Hide TTS button for other failures
                    if (popup) {
                        const ttsBtn = popup.querySelector('.aisub-tts-btn');
                        if (ttsBtn) ttsBtn.style.display = 'none';
                    }
                }
            }
        });
    } catch (error) {
        console.error('[Word Popup] TTS generation failed:', error);
    }
}

// Play audio from base64
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

let currentAudio = null;
let currentAudioUrl = null;

function playAudioFromBase64(base64Audio, mimeType = 'audio/L16;codec=pcm;rate=24000', btnElement = null) {
    try {
        // If same audio is playing, pause it
        if (currentAudio && !currentAudio.paused && currentAudio.dataset.src === base64Audio.substring(0, 50)) {
            currentAudio.pause();
            if (btnElement) btnElement.textContent = '🔊';
            return;
        }

        // Stop previous audio if any
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            if (currentAudioUrl) {
                URL.revokeObjectURL(currentAudioUrl);
                currentAudioUrl = null;
            }
            // Reset all TTS buttons to play icon
            document.querySelectorAll('.aisub-tts-btn').forEach(btn => btn.textContent = '🔊');
        }

        console.log('[Word Popup] Playing audio, base64 length:', base64Audio.length);

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
            console.log('[Word Popup] Converting PCM to WAV format');
            audioData = pcmToWav(pcmData, 24000, 1, 16);
            audioMimeType = 'audio/wav';
        } else {
            audioData = pcmData;
            audioMimeType = mimeType;
        }

        const blob = new Blob([audioData], { type: audioMimeType });
        const audioUrl = URL.createObjectURL(blob);
        currentAudioUrl = audioUrl;

        console.log('[Word Popup] Created blob URL:', audioUrl, 'MIME:', audioMimeType, 'Blob size:', blob.size);

        const audio = new Audio(audioUrl);
        audio.dataset.src = base64Audio.substring(0, 50); // Store signature
        currentAudio = audio;

        if (btnElement) btnElement.textContent = '⏸️';

        audio.addEventListener('ended', () => {
            if (btnElement) btnElement.textContent = '🔊';
            URL.revokeObjectURL(audioUrl);
            if (currentAudio === audio) {
                currentAudio = null;
                currentAudioUrl = null;
            }
        });

        audio.addEventListener('pause', () => {
            if (btnElement) btnElement.textContent = '🔊';
        });

        audio.addEventListener('error', (e) => {
            console.error('[Word Popup] Audio playback error:', e, audio.error);
            if (btnElement) btnElement.textContent = '🔊';
        });

        audio.play().catch(err => {
            console.error('[Word Popup] Play failed:', err);
            if (btnElement) btnElement.textContent = '🔊';
        });
    } catch (error) {
        console.error('[Word Popup] Error playing audio:', error);
        if (btnElement) btnElement.textContent = '🔊';
    }
}

// Open popup for already learned word (no API call)
window.openSavedWordPopup = function (word, x, y, wordData) {
    // Remove existing popup
    const existing = document.querySelector('.aisub-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'aisub-popup';
    popup.style.position = 'fixed';
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    const hasTTS = wordData.ttsAudio && wordData.ttsAudio.length > 0;

    popup.innerHTML = `
        <div class="aisub-popup-header">
            <div style="display: flex; align-items: center; gap: 6px;">
                ${hasTTS ? `<button class="aisub-tts-btn" style="background: none; border: none; padding: 2px; font-size: 16px; cursor: pointer; opacity: 0.8; line-height: 1;" title="Play pronunciation">🔊</button>` : ''}
                <span class="aisub-popup-word">${word}</span>
            </div>
            <span class="aisub-popup-close">✕</span>
        </div>
        <div class="aisub-popup-content">
            <div><strong>${window.AiSubtitlesI18n.getMessage('popup_transcription')}:</strong> ${wordData.transcription || ''}</div>
            <div><strong>${window.AiSubtitlesI18n.getMessage('popup_translation')}:</strong> ${getTranslationForUser(wordData.translation)}</div>
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

    const targetContainer = document.fullscreenElement || document.body;
    targetContainer.appendChild(popup);

    // Close handlers
    popup.querySelector('.aisub-popup-close').addEventListener('click', () => popup.remove());
    popup.querySelector('#aisub-close-btn').addEventListener('click', () => popup.remove());

    // TTS button handler
    if (hasTTS) {
        popup.querySelector('.aisub-tts-btn').addEventListener('click', (e) => {
            const ttsBtn = e.target.closest('.aisub-tts-btn');
            const mimeType = wordData.ttsMimeType || 'audio/L16;codec=pcm;rate=24000';
            playAudioFromBase64(wordData.ttsAudio, mimeType, ttsBtn);
        });
    }

    // Make popup draggable
    makeDraggable(popup, popup.querySelector('.aisub-popup-header'));
};
