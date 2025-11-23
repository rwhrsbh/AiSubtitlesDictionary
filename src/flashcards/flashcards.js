import { I18nService } from '../services/i18n.js';
import { isCloseMatch, formatOptionForDisplay } from '../services/utils.js';

const i18n = new I18nService();
let cards = [];
let currentIndex = 0;
let attempts = 0;
let isCardResolved = false;
let cardStates = []; // Track state of each card: null (unanswered), true (correct), false (incorrect)
let mistakeCards = []; // Cards that were answered incorrectly
let isReviewingMistakes = false;
let originalCardsCount = 0;
let currentMode = 'speech'; // 'text' or 'speech'

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    localizeHtml();
    setupEventListeners();
    setupModeToggle();
    loadCards();
});

function localizeHtml() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });

    // Localize placeholder
    const input = document.getElementById('answer-input');
    if (input) {
        const placeholderKey = input.getAttribute('data-i18n-placeholder');
        if (placeholderKey) {
            input.placeholder = i18n.getMessage(placeholderKey);
        }
    }
}

function setupEventListeners() {
    document.getElementById('check-btn').addEventListener('click', handleCheck);
    document.getElementById('answer-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCheck();
    });

    document.getElementById('idk-btn').addEventListener('click', handleGiveUp);
    document.getElementById('next-btn').addEventListener('click', nextCard);
    document.getElementById('close-btn').addEventListener('click', () => window.close());
}

// Helper function to convert language name to code
function getLanguageCode(language) {
    const langMap = {
        'English': 'en',
        'Russian': 'ru',
        'Ukrainian': 'uk',
        'Spanish': 'es',
        'French': 'fr',
        'German': 'de',
        'Italian': 'it',
        'Portuguese': 'pt',
        'Chinese': 'zh',
        'Japanese': 'ja',
        'Korean': 'ko',
        'Arabic': 'ar'
    };
    return langMap[language] || language.toLowerCase().substring(0, 2);
}

// Helper function to check if card has options available
function checkHasOptions(card) {
    const wordLangCode = getLanguageCode(card.word_language || 'English');
    const distractorsKey = `distractors_${wordLangCode}`;

    // Check primary key first
    if (card[distractorsKey] && card[distractorsKey].length > 0) {
        return true;
    }

    // Fallback: check other common keys
    const fallbackKeys = ['distractors_en', 'distractors_ru', 'distractors_uk', 'distractors'];
    for (const key of fallbackKeys) {
        if (card[key] && card[key].length > 0) {
            return true;
        }
    }

    return false;
}

function setupModeToggle() {
    const container = document.getElementById('mode-controls-container');
    if (container) {
        container.innerHTML = `
            <button class="mode-btn ${currentMode === 'text' ? 'active' : ''}" data-mode="text">📝 ${i18n.getMessage('mode_text')}</button>
            <button class="mode-btn ${currentMode === 'options' ? 'active' : ''}" data-mode="options">🔠 ${i18n.getMessage('mode_options')}</button>
            <button class="mode-btn ${currentMode === 'speech' ? 'active' : ''}" data-mode="speech">🔊 ${i18n.getMessage('mode_speech')}</button>
        `;

        container.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const mode = btn.dataset.mode; // Use btn instead of e.target to handle clicks on emoji/text
                if (mode) {
                    setMode(mode);
                }
            });
        });
    }
}

function setMode(mode) {
    if (currentMode === mode) return;

    currentMode = mode;

    // Update buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Handle UI visibility
    const inputArea = document.getElementById('input-area');
    const optionsArea = document.getElementById('options-area');

    if (mode === 'options') {
        inputArea.classList.add('hidden');
        optionsArea.classList.remove('hidden');
    } else {
        inputArea.classList.remove('hidden');
        optionsArea.classList.add('hidden');
        // Focus input if switching to text/speech
        if (!isCardResolved) {
            setTimeout(() => document.getElementById('answer-input').focus(), 100);
        }
    }

    // Reload current card in new mode
    if (cards.length > 0 && !isCardResolved) {
        showCard(currentIndex);
    }
}

async function loadCards() {
    // Show loading screen
    document.getElementById('loading-screen').classList.remove('hidden');
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    try {
        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_FLASHCARDS' });

        if (response.success && response.data && response.data.length > 0) {
            // Filter out invalid cards
            const validData = response.data.filter(c => c && c.word && c.translation);

            cards = validData.map(c => ({
                ...c,
                word: typeof c.word === 'object' ? JSON.stringify(c.word) : String(c.word || ''),
                translation: typeof c.translation === 'object' ? JSON.stringify(c.translation) : String(c.translation || ''),
                transcription: typeof c.transcription === 'object' ? JSON.stringify(c.transcription) : String(c.transcription || ''),
                example: typeof c.example === 'object' ? JSON.stringify(c.example) : String(c.example || '')
            }));

            cardStates = new Array(cards.length).fill(null);
            originalCardsCount = cards.length;
            document.getElementById('total-count').textContent = cards.length;

            initializeProgressSidebar();

            // Hide loading, show card
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('card-container').classList.remove('hidden');

            await showCard(0);
        } else {
            showEmptyState();
        }
    } catch (error) {
        console.error('Error loading cards:', error);
        showEmptyState();
    }
}

function updateModeControls(hasTTS) {
    const container = document.getElementById('mode-controls-container');
    if (!container) return;

    // If no TTS, disable speech button and force text mode
    const speechBtn = container.querySelector('[data-mode="speech"]');
    if (speechBtn) {
        if (!hasTTS) {
            speechBtn.disabled = true;
            speechBtn.style.opacity = '0.5';
            speechBtn.style.cursor = 'not-allowed';
            speechBtn.title = 'No audio available';
        } else {
            speechBtn.disabled = false;
            speechBtn.style.opacity = '1';
            speechBtn.style.cursor = 'pointer';
            speechBtn.title = 'Switch to speech mode';
        }
    }

    // Check if options are available (distractors exist)
    const card = cards[currentIndex];
    const hasOptions = checkHasOptions(card);

    const optionsBtn = container.querySelector('[data-mode="options"]');
    if (optionsBtn) {
        if (!hasOptions) {
            optionsBtn.disabled = true;
            optionsBtn.style.opacity = '0.5';
            optionsBtn.style.cursor = 'not-allowed';
            optionsBtn.title = 'No options available';
        } else {
            optionsBtn.disabled = false;
            optionsBtn.style.opacity = '1';
            optionsBtn.style.cursor = 'pointer';
            optionsBtn.title = 'Switch to options mode';
        }
    }
}

async function showCard(index) {
    if (index >= cards.length) {
        // Check if all cards are answered
        const hasUnanswered = cardStates.some((state, idx) => idx < originalCardsCount && state === null);
        if (hasUnanswered) {
            // Find first unanswered
            const firstUnanswered = cardStates.findIndex((state, idx) => idx < originalCardsCount && state === null);
            if (firstUnanswered !== -1) {
                showCard(firstUnanswered);
                return;
            }
        }
        // All cards answered, show complete screen
        showCompleteScreen();
        return;
    }

    currentIndex = index;
    const card = cards[index];

    // Check if card was already answered - if so, show answer immediately
    const wasAnswered = cardStates[currentIndex] !== null;

    // Reset State (unless already answered)
    if (!wasAnswered) {
        attempts = 0;
        isCardResolved = false;
    } else {
        // Card was already answered - show as resolved
        attempts = cardStates[currentIndex] === false ? 3 : 0;
        isCardResolved = true;
    }

    // Update UI
    document.getElementById('current-index').textContent = index + 1;
    updateProgressSidebar();

    // Show Category
    const categoryBadge = document.getElementById('card-category');
    if (card.category) {
        categoryBadge.textContent = card.category;
        if (card.word_language) {
            categoryBadge.textContent += ` • ${card.word_language}`;
        }
        categoryBadge.style.display = 'block';
    } else {
        categoryBadge.style.display = 'none';
    }

    // Show Translation as the "Question" (Front of card) or play speech
    // Only use speech mode if TTS is available
    const hasTTS = !!(card.ttsAudio && card.ttsAudio.length > 0);

    // Update mode controls based on availability
    updateModeControls(hasTTS);

    // Auto-select default mode for new (unanswered) cards
    if (!wasAnswered) {
        if (hasTTS) {
            // Speech is available - use it as default
            currentMode = 'speech';
        } else {
            // No TTS - default to text
            currentMode = 'text';
        }
    }

    // Determine effective mode based on currentMode (user's choice)
    let effectiveMode = currentMode;

    // If currentMode is 'options', check if options are available
    if (currentMode === 'options') {
        const hasOptions = checkHasOptions(card);

        if (!hasOptions) {
            // No options available, fallback to text
            effectiveMode = 'text';
            currentMode = 'text';
        }
    }

    // If currentMode is 'speech', check if TTS is available
    if (currentMode === 'speech' && !hasTTS) {
        // No TTS available, fallback to text
        effectiveMode = 'text';
        currentMode = 'text';
    }

    // Update UI to reflect current mode
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === currentMode);
    });

    if (effectiveMode === 'speech' && !wasAnswered) {
        // Speech mode - play audio and hide text
        document.getElementById('card-front-text').innerHTML = `
            <button id="flashcard-play-btn" class="mic-btn" style="margin-top:0; width:80px; height:80px; font-size:32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);">
                🔊
            </button>
            <div style="margin-top:12px; font-size:14px; color:#94a3b8;">Click to listen</div>
        `;
        document.getElementById('card-transcription').textContent = '';

        const playBtn = document.getElementById('flashcard-play-btn');
        playBtn.onclick = () => playCardSpeech(card, playBtn);

        // Play existing TTS
        playCardSpeech(card, playBtn);
    } else if (effectiveMode === 'options' && !wasAnswered) {
        // Options mode
        document.getElementById('card-front-text').textContent = formatOptionForDisplay(card.translation);
        document.getElementById('card-transcription').textContent = '';

        // Render options
        renderOptions(card);

        // Hide input area, show options area
        document.getElementById('input-area').classList.add('hidden');
        document.getElementById('options-area').classList.remove('hidden');
    } else {
        // Text mode or already answered or no TTS available
        document.getElementById('card-front-text').textContent = formatOptionForDisplay(card.translation);
        document.getElementById('card-transcription').textContent = wasAnswered && card.transcription ? card.transcription : '';

        // Ensure input area is visible if not options mode
        if (effectiveMode !== 'options') {
            document.getElementById('input-area').classList.remove('hidden');
            document.getElementById('options-area').classList.add('hidden');
        }
    }

    // Reset/Restore Input
    const input = document.getElementById('answer-input');

    if (wasAnswered) {
        // Show answer
        const success = cardStates[currentIndex];
        input.value = card.word;
        input.disabled = true;
        input.className = success ? 'manual-input correct' : 'manual-input wrong';

        // Show correct answer if wrong
        if (!success) {
            document.getElementById('correct-answer-display').textContent = card.word;
            document.getElementById('correct-answer-display').classList.remove('hidden');
        } else {
            document.getElementById('correct-answer-display').classList.add('hidden');
        }

        // Show example
        if (card.example) {
            const exampleBox = document.getElementById('example-display');
            const exampleText = document.getElementById('example-text');
            let highlightedExample = card.example;
            try {
                const regex = new RegExp(`\\b${card.word}\\b`, 'gi');
                highlightedExample = card.example.replace(regex, `<b>${card.word}</b>`);
            } catch (e) {
                console.warn('Error highlighting example:', e);
            }
            exampleText.innerHTML = highlightedExample;
            exampleBox.classList.remove('hidden');
        }

        document.getElementById('feedback-area').classList.remove('hidden');
        document.getElementById('check-btn').classList.add('hidden');
        document.getElementById('idk-btn').classList.add('hidden');
        document.getElementById('next-btn').classList.remove('hidden');
    } else {
        // Fresh card - reset to initial state
        input.value = '';
        input.disabled = false;
        input.className = 'manual-input';

        if (effectiveMode !== 'options') {
            input.focus();
        }

        document.getElementById('feedback-area').classList.add('hidden');
        document.getElementById('correct-answer-display').classList.add('hidden');
        document.getElementById('example-display').classList.add('hidden');
        document.getElementById('check-btn').classList.remove('hidden');
        document.getElementById('idk-btn').classList.remove('hidden');
        document.getElementById('next-btn').classList.add('hidden');
    }

    // Reset/Restore Dots
    updateDots();
}

function renderOptions(card) {
    const container = document.getElementById('options-area');
    container.innerHTML = '';

    // Determine language code for the word
    const wordLangCode = getLanguageCode(card.word_language || 'English');

    // Get distractors for the word's language
    const distractorsKey = `distractors_${wordLangCode}`;
    let distractors = card[distractorsKey] || [];

    // Fallback: try other language keys if primary is empty
    if (distractors.length === 0) {
        // Try common language keys
        const fallbackKeys = ['distractors_en', 'distractors_ru', 'distractors_uk', 'distractors'];
        for (const key of fallbackKeys) {
            if (card[key] && card[key].length > 0) {
                distractors = card[key];
                break;
            }
        }
    }

    if (distractors.length === 0) return;

    // Combine correct answer with distractors and shuffle
    const options = [...distractors, card.word].sort(() => Math.random() - 0.5);

    options.forEach(option => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = formatOptionForDisplay(option);

        btn.addEventListener('click', () => handleOptionClick(btn, option, card.word));

        container.appendChild(btn);
    });
}

function handleOptionClick(btn, selectedOption, correctAnswer) {
    if (isCardResolved) return;

    const isCorrect = isCloseMatch(selectedOption, correctAnswer).match;
    const container = document.getElementById('options-area');
    const allButtons = container.querySelectorAll('.option-btn');

    // Disable all buttons
    allButtons.forEach(b => b.disabled = true);

    if (isCorrect) {
        btn.classList.add('correct');
        resolveCard(true);
    } else {
        btn.classList.add('wrong');
        // Highlight correct answer
        allButtons.forEach(b => {
            if (isCloseMatch(b.textContent, correctAnswer).match) {
                b.classList.add('correct');
            }
        });
        resolveCard(false);
    }
}

function handleCheck() {
    if (isCardResolved) return;

    const input = document.getElementById('answer-input');
    const answer = input.value.trim();

    if (!answer) return;

    const card = cards[currentIndex];
    const isCorrect = isCloseMatch(answer, card.word).match;

    if (isCorrect) {
        resolveCard(true);
    } else {
        attempts++;
        updateDots();

        if (attempts >= 3) {
            resolveCard(false);
        } else {
            // Shake animation
            input.classList.add('wrong');
            setTimeout(() => input.classList.remove('wrong'), 400);
            input.value = '';
            input.focus();
        }
    }
}

function handleGiveUp() {
    if (isCardResolved) return;
    resolveCard(false);
}

function resolveCard(success) {
    isCardResolved = true;
    const card = cards[currentIndex];
    const input = document.getElementById('answer-input');

    input.disabled = true;

    // Update card state
    cardStates[currentIndex] = success;
    updateProgressSidebar();

    if (success) {
        input.classList.add('correct');
        input.value = card.word;
    } else {
        input.classList.add('wrong');
        document.getElementById('correct-answer-display').textContent = card.word;
        document.getElementById('correct-answer-display').classList.remove('hidden');
    }

    // Show Example
    if (card.example) {
        const exampleBox = document.getElementById('example-display');
        const exampleText = document.getElementById('example-text');

        // Highlight the word in the example if possible
        let highlightedExample = card.example;
        try {
            const regex = new RegExp(`\\b${card.word}\\b`, 'gi');
            highlightedExample = card.example.replace(regex, `<b>${card.word}</b>`);
        } catch (e) {
            console.warn('Error highlighting example:', e);
        }

        exampleText.innerHTML = highlightedExample;
        exampleBox.classList.remove('hidden');
    }

    // Show Transcription
    if (card.transcription) {
        document.getElementById('card-transcription').textContent = card.transcription;
    }

    document.getElementById('feedback-area').classList.remove('hidden');

    // Update Buttons
    document.getElementById('check-btn').classList.add('hidden');
    document.getElementById('idk-btn').classList.add('hidden');
    document.getElementById('next-btn').classList.remove('hidden');
    document.getElementById('next-btn').focus();

    // Send stats
    chrome.runtime.sendMessage({
        type: 'UPDATE_FLASHCARD_STATS',
        word: card.word,
        success: success
    });

    // Track mistakes for review (only if not already reviewing and in original cards)
    if (!success && !isReviewingMistakes && currentIndex < originalCardsCount) {
        const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
        if (!alreadyAdded) {
            mistakeCards.push(JSON.parse(JSON.stringify(card)));
        }
    }
}

function updateDots() {
    const dots = document.querySelectorAll('.dot');
    dots.forEach((dot, i) => {
        if (i < attempts) {
            dot.className = 'dot lost';
        } else {
            dot.className = 'dot active';
        }
    });
}

async function nextCard() {
    if (currentIndex < cards.length - 1) {
        await showCard(currentIndex + 1);
    } else {
        // Last card, check if all answered
        const hasUnanswered = cardStates.some((state, idx) => idx < originalCardsCount && state === null);
        if (hasUnanswered) {
            const firstUnanswered = cardStates.findIndex((state, idx) => idx < originalCardsCount && state === null);
            if (firstUnanswered !== -1) {
                await showCard(firstUnanswered);
            }
        } else {
            showCompleteScreen();
        }
    }
}

function showEmptyState() {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('card-container').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
}

// Progress Sidebar Functions
function initializeProgressSidebar() {
    const sidebar = document.getElementById('progress-sidebar');
    sidebar.innerHTML = '';

    cards.forEach((_, index) => {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        box.textContent = index + 1;
        box.dataset.index = index;

        // Allow clicking to navigate (optional, but good for UX)
        box.addEventListener('click', async () => {
            if (index !== currentIndex) {
                await showCard(index);
            }
        });

        sidebar.appendChild(box);
    });
}

function updateProgressSidebar() {
    const boxes = document.querySelectorAll('.progress-box');
    boxes.forEach((box, index) => {
        const state = cardStates[index];

        // Reset classes
        box.className = 'progress-box';

        // Set state class
        if (state === true) {
            box.classList.add('correct');
        } else if (state === false) {
            box.classList.add('incorrect');
        } else {
            box.classList.add('unanswered');
        }

        // Set active class
        if (index === currentIndex) {
            box.classList.add('active');
        }
    });
}

// Show complete screen with option to review mistakes
function showCompleteScreen() {
    if (!isReviewingMistakes && mistakeCards.length > 0) {
        // Show review mistakes prompt
        const emptyState = document.getElementById('empty-state');
        emptyState.innerHTML = `
            <div class="complete-icon" style="animation: bounce 1s ease infinite;">📝</div>
            <h2>${i18n.getMessage('mistakes_review_title') || 'Review Mistakes?'}</h2>
            <p>${i18n.getMessage('mistakes_review_subtitle') || 'You have some incorrect answers. Would you like to review them?'}</p>
            <div style="font-size: 20px; margin: 20px 0; font-weight: 600;">${mistakeCards.length} ${mistakeCards.length === 1 ? (i18n.getMessage('card_singular') || 'card') : (i18n.getMessage('card_plural') || 'cards')}</div>
            <div style="display: flex; gap: 16px; justify-content: center; margin-top: 32px;">
                <button id="start-review-btn" class="control-btn primary">${i18n.getMessage('start_review') || 'Review Mistakes'}</button>
                <button id="close-review-btn" class="control-btn">${i18n.getMessage('flashcards_close') || 'Close'}</button>
            </div>
        `;

        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('card-container').classList.add('hidden');
        emptyState.classList.remove('hidden');

        // Setup review buttons
        document.getElementById('start-review-btn').addEventListener('click', startMistakeReview);
        document.getElementById('close-review-btn').addEventListener('click', () => window.close());
    } else {
        // No mistakes or already reviewed - show final complete screen
        const emptyState = document.getElementById('empty-state');
        emptyState.innerHTML = `
            <div class="complete-icon" style="animation: bounce 1s ease infinite;">🎉</div>
            <h2>${i18n.getMessage('flashcards_complete') || 'Great Job!'}</h2>
            <p>${i18n.getMessage('flashcards_complete_msg') || 'You have completed all flashcards!'}</p>
            <button id="close-final-btn" class="control-btn primary">${i18n.getMessage('flashcards_close') || 'Close'}</button>
        `;

        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('card-container').classList.add('hidden');
        emptyState.classList.remove('hidden');

        document.getElementById('close-final-btn').addEventListener('click', () => window.close());
    }
}

// Play TTS for card
// Does NOT generate TTS - it should already be present if available
async function playCardSpeech(card, btnElement = null) {
    try {
        // Check if TTS audio exists
        if (card.ttsAudio) {
            // Play existing audio
            const mimeType = card.ttsMimeType || 'audio/L16;codec=pcm;rate=24000';
            playAudioFromBase64(card.ttsAudio, mimeType, btnElement);
            return true;
        } else {
            // No TTS available - do not generate
            console.log('[Flashcards] No TTS audio available for:', card.word);
            return false;
        }
    } catch (error) {
        console.error('[Flashcards] Error playing speech:', error);
        return false;
    }
}

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
        }

        // Convert base64 to blob
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
            console.log('[Flashcards] Converting PCM to WAV format');
            audioData = pcmToWav(pcmData, 24000, 1, 16);
            audioMimeType = 'audio/wav';
        } else {
            audioData = pcmData;
            audioMimeType = mimeType;
        }

        const blob = new Blob([audioData], { type: audioMimeType });
        const audioUrl = URL.createObjectURL(blob);
        currentAudioUrl = audioUrl;

        const audio = new Audio(audioUrl);
        audio.dataset.src = base64Audio.substring(0, 50); // Store signature
        currentAudio = audio;

        if (btnElement) btnElement.textContent = '⏸️';

        // Clean up URL after playing
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
            console.error('[Flashcards] Audio playback error:', e, audio.error);
            if (btnElement) btnElement.textContent = '🔊';
        });

        audio.play().catch(err => {
            console.error('[Flashcards] Play failed:', err);
            if (btnElement) btnElement.textContent = '🔊';
        });
    } catch (error) {
        console.error('[Flashcards] Error playing audio:', error);
        if (btnElement) btnElement.textContent = '🔊';
    }
}

// Start mistake review
async function startMistakeReview() {
    isReviewingMistakes = true;

    // Add mistake cards to the end
    const mistakeStartIndex = cards.length;
    mistakeCards.forEach((card, index) => {
        cards.push(card);
        cardStates.push(null);
    });

    // Update UI
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('card-container').classList.remove('hidden');
    document.getElementById('total-count').textContent = mistakeCards.length;

    // Reinitialize progress sidebar for mistake cards only
    initializeProgressSidebar();

    // Show first mistake card
    currentIndex = mistakeStartIndex;
    document.getElementById('current-index').textContent = 1;
    await showCard(mistakeStartIndex);
}
