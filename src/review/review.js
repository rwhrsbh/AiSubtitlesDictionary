import { StorageService } from '../services/storage.js';
import { I18nService } from '../services/i18n.js';
import { isCloseMatch, formatOptionForDisplay } from '../services/utils.js';

// Helper to get translation string
function getTranslation(translation) {
    if (!translation) return '';
    if (typeof translation === 'string') {
        try {
            // Try parsing if it looks like JSON
            if (translation.trim().startsWith('{')) {
                translation = JSON.parse(translation);
            } else {
                return translation;
            }
        } catch (e) {
            return translation;
        }
    }

    if (typeof translation === 'object') {
        const lang = i18n.language || 'ru';
        if (lang === 'en') return translation.english || translation.English || Object.values(translation)[0] || '';
        if (lang === 'uk') return translation.ukrainian || translation.Ukrainian || translation.russian || Object.values(translation)[0] || '';
        return translation.russian || translation.Russian || Object.values(translation)[0] || '';
    }
    return String(translation);
}

const storage = new StorageService();
const i18n = new I18nService();
let currentReviewWords = [];
let currentWordIndex = 0;
let wordStates = []; // Track answered state for each word
let currentMode = 'manual'; // 'options' or 'manual'
let isAnswered = false; // Prevent multiple clicks

// Mistake review mode
let mistakeWords = [];
let isReviewingMistakes = false;
let originalWordsCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    localizeHtml();
    setupModeToggles();
    setupManualInput();
    loadReviewSession();
    document.getElementById('close-btn').addEventListener('click', () => window.close());
});

function localizeHtml() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = i18n.getMessage(key);
        if (message) {
            element.textContent = message;
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const message = i18n.getMessage(key);
        if (message) {
            element.placeholder = message;
        }
    });
}

function setupModeToggles() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode;
            setMode(mode);
        });
    });
}

function setMode(mode) {
    currentMode = mode;

    // Update UI
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const inputArea = document.getElementById('input-area');
    const optionsArea = document.getElementById('options-area');

    if (!inputArea || !optionsArea) {
        console.error('Mode elements not found');
        return;
    }

    if (mode === 'manual') {
        inputArea.classList.remove('hidden');
        optionsArea.classList.add('hidden');
        setTimeout(() => {
            const manualInput = document.getElementById('manual-input');
            if (manualInput) manualInput.focus();
        }, 100);
    } else if (mode === 'options') {
        inputArea.classList.add('hidden');
        optionsArea.classList.remove('hidden');
    }
}

function setupManualInput() {
    const input = document.getElementById('manual-input');
    const submit = document.getElementById('submit-btn');

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !isAnswered) {
            handleManualSubmit();
        }
    });

    submit.addEventListener('click', () => {
        if (!isAnswered) {
            handleManualSubmit();
        }
    });
}

function handleManualSubmit() {
    const input = document.getElementById('manual-input');
    const submitBtn = document.getElementById('submit-btn');

    if (!input) return;

    const value = input.value.trim();
    if (!value || isAnswered) return;

    const wordData = currentReviewWords[currentWordIndex];
    const state = wordStates[currentWordIndex];

    // Get the correct answer based on current mode
    let correctAnswer;
    let matchResult;

    if (state.mode === 'translation') {
        correctAnswer = getTranslation(wordData.translation);
        matchResult = isCloseMatch(value, correctAnswer);
    } else if (state.mode === 'reverse_translation') {
        correctAnswer = wordData.word;
        matchResult = isCloseMatch(value, correctAnswer);
    } else {
        correctAnswer = wordData.transcription || '';
        matchResult = isCloseMatch(value, correctAnswer);
    }

    const isCorrect = matchResult.match;

    // Disable input
    input.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    isAnswered = true;

    // Update visual feedback
    if (matchResult.exact) {
        input.classList.add('correct');
    } else if (matchResult.match) {
        input.classList.add('close');
    } else {
        input.classList.add('wrong');
        input.value += ` (${correctAnswer})`;
    }

    // Also highlight in options if they exist
    const optionsContainer = document.getElementById('options-area');
    const optionBtns = optionsContainer.querySelectorAll('.option-btn');
    optionBtns.forEach(btn => {
        btn.disabled = true;
        // Check dataset instead of text content
        if (btn.dataset.isCorrect === 'true') {
            btn.classList.add('correct');
        }
    });

    handleAnswer(isCorrect);
}

async function loadReviewSession() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    // Get tasks limit from settings
    const settings = await chrome.storage.local.get('tasksLimit');
    const tasksLimit = settings.tasksLimit || 20;

    if (mode === 'all') {
        const allWords = await storage.getLearningList();
        // Shuffle for better experience and apply limit
        currentReviewWords = allWords.sort(() => Math.random() - 0.5).slice(0, tasksLimit);
    } else if (mode === 'problem') {
        const problemWords = await storage.getProblemWords();
        // Shuffle and apply limit
        currentReviewWords = problemWords.sort(() => Math.random() - 0.5).slice(0, tasksLimit);
    } else {
        const dueWords = await storage.getWordsToReview();
        // Apply limit to due words
        currentReviewWords = dueWords.slice(0, tasksLimit);
    }

    const wordsToReviewText = i18n.getMessage('words_to_review');
    document.getElementById('words-count').textContent = `${currentReviewWords.length} ${wordsToReviewText}`;

    if (currentReviewWords.length === 0) {
        document.getElementById('quiz-container').classList.add('hidden');
        document.getElementById('no-review').classList.remove('hidden');
        return;
    }

    currentWordIndex = 0;
    originalWordsCount = currentReviewWords.length; // Store original count
    wordStates = new Array(currentReviewWords.length).fill(null);
    initializeProgressIndicators();
    showNextCard();
}

async function showNextCard() {
    if (currentWordIndex >= currentReviewWords.length) {
        // Check if we should start mistake review
        if (!isReviewingMistakes && mistakeWords.length > 0) {
            showMistakeReviewScreen();
        } else {
            // Show complete screen
            const completeTitle = i18n.getMessage('review_complete_title');
            const completeMsg = i18n.getMessage('review_complete_msg');
            document.getElementById('quiz-container').innerHTML = `<div class="card"><h2>${completeTitle}</h2><p>${completeMsg}</p></div>`;
            setTimeout(() => window.close(), 3000);
        }
        return;
    }

    updateProgressIndicators();

    const wordData = currentReviewWords[currentWordIndex];

    // Get quiz settings
    const settings = await chrome.storage.local.get(['quizTranslation', 'quizTranscription']);
    const enabledModes = [];

    if (settings.quizTranslation !== false) {
        enabledModes.push('translation');
        // Add reverse translation if we have original distractors or just random chance
        // Only enable if we have distractors_original or at least some distractors to use
        if (wordData.distractors_original || (wordData.distractors && wordData.distractors.length > 0)) {
            enabledModes.push('reverse_translation');
        }
    }
    if (settings.quizTranscription !== false) enabledModes.push('transcription');

    // Default to both if none saved
    if (enabledModes.length === 0) {
        enabledModes.push('translation', 'transcription');
    }

    const mode = enabledModes[Math.floor(Math.random() * enabledModes.length)];

    showQuiz(wordData, mode);
}

function showMistakeReviewScreen() {
    const container = document.getElementById('quiz-container');
    container.innerHTML = `
        <div class="card" style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); text-align: center; padding: 40px;">
            <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
            <h2 style="font-size: 28px; margin-bottom: 12px;">${i18n.getMessage('review_mistakes_title')}</h2>
            <p style="font-size: 18px; opacity: 0.9;">${i18n.getMessage('review_mistakes_subtitle')}</p>
            <p style="font-size: 22px; font-weight: 700; margin-top: 20px;">${mistakeWords.length} ${mistakeWords.length === 1 ? i18n.getMessage('word_singular') : i18n.getMessage('word_plural')}</p>
            <button id="start-mistakes-btn" style="margin-top: 24px; padding: 12px 32px; font-size: 16px; background: white; color: #f97316; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">${i18n.getMessage('start_review')}</button>
        </div>
    `;

    let autoStartTimeout;

    // Add click handler for start button
    const startBtn = document.getElementById('start-mistakes-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            clearTimeout(autoStartTimeout); // Cancel auto-start
            startMistakeReview();
        });
    }

    // Auto-start mistake review after 3 seconds
    autoStartTimeout = setTimeout(() => {
        startMistakeReview();
    }, 3000);
}

function startMistakeReview() {
    // Prevent double execution
    if (isReviewingMistakes) return;

    isReviewingMistakes = true;

    // Add mistake words to review list
    const mistakeStartIndex = currentReviewWords.length;
    mistakeWords.forEach(word => {
        currentReviewWords.push(word);
        wordStates.push(null);
    });

    // Recreate progress sidebar for mistake words
    initializeMistakeProgressIndicators();

    // Restore quiz container structure (it was replaced in showMistakeReviewScreen)
    const container = document.getElementById('quiz-container');
    container.innerHTML = `
        <div class="card">
            <div class="category-badge" id="q-category"></div>
            <div class="word-display" id="q-word">Loading...</div>

            <div class="mode-controls">
                <button class="mode-btn" data-mode="options" data-i18n="mode_options">Options</button>
                <button class="mode-btn active" data-mode="manual" data-i18n="mode_manual">Manual</button>
            </div>

            <div class="input-area" id="input-area">
                <input type="text" id="manual-input" class="manual-input" data-i18n-placeholder="input_placeholder" placeholder="Type answer...">
                <button id="submit-btn" class="submit-btn" data-i18n="btn_check">Check</button>
            </div>

            <div id="options-area" class="options-grid hidden">
                <!-- Options injected here -->
            </div>
        </div>
    `;

    // Re-localize the injected HTML
    localizeHtml();

    // Re-setup event handlers for mode toggles and input
    setupModeToggles();
    setupManualInput();

    // Ensure speech-area exists (even if hidden)
    if (!document.getElementById('speech-area')) {
        const speechArea = document.createElement('div');
        speechArea.id = 'speech-area';
        speechArea.className = 'hidden';
        document.body.appendChild(speechArea);
    }

    // Navigate to first mistake
    currentWordIndex = mistakeStartIndex;
    showNextCard();
}

function initializeMistakeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    mistakeWords.forEach((_, index) => {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        box.textContent = index + 1;
        const actualIndex = originalWordsCount + index;
        box.dataset.index = actualIndex;
        sidebar.appendChild(box);
    });
}

function showQuiz(wordData, mode) {
    const qWord = document.getElementById('q-word');
    const categoryBadge = document.getElementById('q-category');
    const optionsContainer = document.getElementById('options-area');
    const input = document.getElementById('manual-input');
    const submit = document.getElementById('submit-btn');

    // Show category
    if (categoryBadge) {
        categoryBadge.textContent = (wordData.category || 'default').toUpperCase();
        categoryBadge.style.display = 'block';
    }

    // Reset state
    isAnswered = false;

    // Reset input (if exists)
    if (input) {
        input.value = '';
        input.disabled = false;
        input.className = 'manual-input';
    }
    if (submit) {
        submit.disabled = false;
    }

    // Clear options
    optionsContainer.innerHTML = '';

    // Store quiz mode in wordStates for later use
    if (!wordStates[currentWordIndex]) {
        wordStates[currentWordIndex] = null;
    }
    // Store the mode type
    wordStates[currentWordIndex] = { mode: mode, answered: null };

    // For transcription mode, force options mode and hide manual toggle
    const modeControlsContainer = document.querySelector('.mode-controls');
    if (mode === 'transcription') {
        // Force options mode for transcription
        currentMode = 'options';
        if (modeControlsContainer) modeControlsContainer.style.display = 'none';
        setMode('options');
    } else {
        // Show mode controls for translation/reverse
        if (modeControlsContainer) modeControlsContainer.style.display = '';
        setMode(currentMode);
    }

    let correctAnswer;
    let options = [];

    if (mode === 'translation') {
        // TRANSLATION QUIZ: Word -> Translation
        qWord.textContent = wordData.word;
        console.log('[Quiz] Translation:', wordData.word);

        const translation = getTranslation(wordData.translation);
        correctAnswer = translation;
        options.push({ text: translation, correct: true });

        // Get distractors based on language
        let distractors = [];
        const lang = i18n.language || 'ru';
        if (lang === 'en') distractors = wordData.distractors_en || [];
        else if (lang === 'uk') distractors = wordData.distractors_uk || [];
        else distractors = wordData.distractors_ru || [];

        // Fallback to generic distractors if specific ones missing
        if (!distractors || distractors.length === 0) {
            distractors = wordData.distractors || [];
        }

        if (distractors && distractors.length > 0) {
            distractors.slice(0, 3).forEach(d => options.push({ text: d, correct: false }));
        } else {
            options.push(
                { text: 'Option A', correct: false },
                { text: 'Option B', correct: false },
                { text: 'Option C', correct: false }
            );
        }
    } else if (mode === 'reverse_translation') {
        // REVERSE QUIZ: Translation -> Word
        const translation = getTranslation(wordData.translation);
        qWord.textContent = translation;
        console.log('[Quiz] Reverse:', translation);

        correctAnswer = wordData.word;
        options.push({ text: wordData.word, correct: true });

        // Use original language distractors
        let distractors = wordData.distractors_original || [];

        if (distractors && distractors.length > 0) {
            distractors.slice(0, 3).forEach(d => options.push({ text: d, correct: false }));
        } else {
            options.push(
                { text: 'Option A', correct: false },
                { text: 'Option B', correct: false },
                { text: 'Option C', correct: false }
            );
        }
    } else {
        // TRANSCRIPTION QUIZ: Word -> Transcription
        qWord.textContent = wordData.word;
        console.log('[Quiz] Transcription:', wordData.word);
        correctAnswer = wordData.transcription || '[no transcription]';
        options.push({ text: wordData.transcription || '[no transcription]', correct: true });

        if (wordData.transcription_distractors && Array.isArray(wordData.transcription_distractors)) {
            wordData.transcription_distractors.slice(0, 3).forEach(d => options.push({ text: d, correct: false }));
        } else {
            options.push(
                { text: '/ˈɒpʃən eɪ/', correct: false },
                { text: '/ˈɒpʃən biː/', correct: false },
                { text: '/ˈɒpʃən siː/', correct: false }
            );
        }
    }

    // Shuffle and render options
    options = options.sort(() => Math.random() - 0.5);

    options.forEach(opt => {
        const btn = document.createElement('div');
        btn.className = 'option-btn';
        // Use formatted text for display (random synonym)
        btn.textContent = formatOptionForDisplay(opt.text);
        // Store correctness in dataset for easy retrieval
        btn.dataset.isCorrect = opt.correct;

        btn.onclick = () => {
            if (!isAnswered) {
                handleOptionClick(opt.correct, btn, correctAnswer);
            }
        };
        optionsContainer.appendChild(btn);
    });
}

function handleOptionClick(isCorrect, element, correctAnswer) {
    if (isAnswered) return; // Protection from multiple clicks

    isAnswered = true;

    // Disable all option buttons
    const optionsContainer = document.getElementById('options-area');
    const allButtons = optionsContainer.querySelectorAll('.option-btn');
    allButtons.forEach(btn => btn.disabled = true);

    // Visual feedback
    element.classList.add(isCorrect ? 'correct' : 'wrong');

    // If wrong, also highlight correct answer
    if (!isCorrect) {
        allButtons.forEach(btn => {
            // Check dataset instead of text content
            if (btn.dataset.isCorrect === 'true') {
                btn.classList.add('correct');
            }
        });
    }

    // Update manual input to sync
    const input = document.getElementById('manual-input');
    const submit = document.getElementById('submit-btn');
    input.disabled = true;
    submit.disabled = true;

    if (isCorrect) {
        input.value = correctAnswer;
        input.classList.add('correct');
    } else {
        input.value = `(${correctAnswer})`;
        input.classList.add('wrong');
    }

    handleAnswer(isCorrect);
}

async function handleAnswer(isCorrect) {
    // Update state
    if (wordStates[currentWordIndex]) {
        wordStates[currentWordIndex].answered = isCorrect;
    } else {
        wordStates[currentWordIndex] = isCorrect;
    }

    // Track mistakes (only during main session, not during mistake review)
    if (!isReviewingMistakes && !isCorrect && currentWordIndex < originalWordsCount) {
        const word = currentReviewWords[currentWordIndex];
        const alreadyAdded = mistakeWords.some(mw => mw.word === word.word);
        if (!alreadyAdded) {
            mistakeWords.push(word);
        }
    }

    updateProgressIndicators();

    await chrome.runtime.sendMessage({
        type: 'UPDATE_WORD_STATS',
        wordId: currentReviewWords[currentWordIndex].id,
        success: isCorrect
    });

    setTimeout(() => {
        currentWordIndex++;
        showNextCard();
    }, 1000);
}

// Initialize progress indicators
function initializeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    // Only show progress for original words, not mistake review words
    const wordsToShow = Math.min(currentReviewWords.length, originalWordsCount || currentReviewWords.length);

    for (let index = 0; index < wordsToShow; index++) {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        box.textContent = index + 1;
        box.dataset.index = index;
        sidebar.appendChild(box);
    }
}

// Update progress indicators
function updateProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    const boxes = sidebar.querySelectorAll('.progress-box');
    boxes.forEach((box) => {
        // Get actual word index from data attribute
        const actualIndex = parseInt(box.dataset.index);
        const stateObj = wordStates[actualIndex];
        const state = stateObj?.answered !== undefined ? stateObj.answered : stateObj;

        // Remove all state classes
        box.classList.remove('unanswered', 'correct', 'incorrect', 'active');

        if (state === true) {
            box.classList.add('correct');
        } else if (state === false) {
            box.classList.add('incorrect');
        } else {
            box.classList.add('unanswered');
        }

        // Highlight current
        if (actualIndex === currentWordIndex) {
            box.classList.add('active');
        }
    });
}
