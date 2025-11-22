import { I18nService } from '../services/i18n.js';
import { isCloseMatch } from '../services/utils.js';

const i18n = new I18nService();

// Flashcards Logic

let flashcards = [];
let currentIndex = 0;
let isFlipped = false;
let frontAnswered = false;
let backAnswered = false;
let frontCorrect = false;
let backCorrect = false;
let targetLanguage = 'RU'; // Default to RU

// Store answer states for all cards
let cardStates = {}; // { cardIndex: { frontAnswered, backAnswered, frontCorrect, backCorrect, frontSelected, backSelected, frontMode, backMode, frontInputValue, backInputValue } }
let frontMode = 'manual'; // 'options' or 'manual' - default to manual
let backMode = 'manual'; // 'options' or 'manual' - default to manual

// Mistake review mode
let mistakeCards = []; // Cards with at least one wrong answer
let isReviewingMistakes = false;
let originalFlashcardsCount = 0; // Store original count before mistakes

// DOM Elements
const loadingScreen = document.getElementById('loading-screen');
const cardContainer = document.getElementById('card-container');
const errorScreen = document.getElementById('error-screen');
const completeScreen = document.getElementById('complete-screen');
const flashcard = document.getElementById('flashcard');
const currentCardSpan = document.getElementById('current-card');
const totalCardsSpan = document.getElementById('total-cards');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const retryBtn = document.getElementById('retry-btn');
const restartBtn = document.getElementById('restart-btn');
const closeBtn = document.getElementById('close-btn');
const errorMessage = document.getElementById('error-message');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    localizeHtml();
    await i18n.init();
    localizeHtml();
    setupModeToggles();
    setupManualInputs();
    await loadFlashcards();
});

function setupModeToggles() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode;
            const side = btn.dataset.side;
            setMode(side, mode);
        });
    });
}

function setupManualInputs() {
    ['front', 'back'].forEach(side => {
        const input = document.getElementById(`${side}-input`);
        const submit = document.getElementById(`${side}-submit`);

        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Prevent card flip
            if (e.key === 'Enter') handleSubmit(side);
        });

        input.addEventListener('input', (e) => {
            const value = e.target.value;
            if (!cardStates[currentIndex]) {
                // Should exist, but just in case
                return;
            }
            if (side === 'front') {
                cardStates[currentIndex].frontInputValue = value;
            } else {
                cardStates[currentIndex].backInputValue = value;
            }
        });

        input.addEventListener('click', (e) => e.stopPropagation());

        submit.addEventListener('click', (e) => {
            e.stopPropagation();
            handleSubmit(side);
        });
    });
}

function setMode(side, mode) {
    if (side === 'front') frontMode = mode;
    else backMode = mode;

    // Update UI
    const container = side === 'front' ? document.querySelector('.card-front') : document.querySelector('.card-back');
    container.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const inputArea = document.getElementById(`${side}-input-area`);
    const optionsArea = document.getElementById(`${side}-options`);

    // Hide all first
    inputArea.classList.add('hidden');
    optionsArea.classList.add('hidden');

    // Remove animation classes
    inputArea.classList.remove('fade-in-content');
    optionsArea.classList.remove('fade-in-content');

    if (mode === 'manual') {
        inputArea.classList.remove('hidden');
        inputArea.classList.add('fade-in-content');
        // Focus input
        setTimeout(() => {
            document.getElementById(`${side}-input`).focus();
            adjustCardHeight();
        }, 100);
    } else if (mode === 'options') {
        optionsArea.classList.remove('hidden');
        optionsArea.classList.add('fade-in-content');
        setTimeout(() => adjustCardHeight(), 100);
    }
}

function handleSubmit(side) {
    const input = document.getElementById(`${side}-input`);
    const value = input.value.trim();
    if (!value) return;

    const card = flashcards[currentIndex];
    const correctAnswerEn = card.correct_answer_en || card.word;
    const correctAnswerRu = card.correct_answer_ru;

    // Check against both languages
    let matchResult;
    if (side === 'front') {
        // On front side, accept both EN and RU
        matchResult = isCloseMatch(value, correctAnswerEn, correctAnswerRu);
    } else {
        // On back side, accept both RU and EN
        matchResult = isCloseMatch(value, correctAnswerRu, correctAnswerEn);
    }

    const displayAnswer = side === 'front' ? correctAnswerEn : correctAnswerRu;
    handleManualResult(side, matchResult, input, displayAnswer);
}

function handleManualResult(side, result, input, correctAnswer) {
    input.disabled = true;
    document.getElementById(`${side}-submit`).disabled = true;

    const isCorrect = result.match;

    if (side === 'front') {
        frontAnswered = true;
        frontCorrect = isCorrect;
        cardStates[currentIndex].frontAnswered = true;
        cardStates[currentIndex].frontCorrect = isCorrect;
    } else {
        backAnswered = true;
        backCorrect = isCorrect;
        cardStates[currentIndex].backAnswered = true;
        cardStates[currentIndex].backCorrect = isCorrect;
    }

    if (result.exact) {
        input.classList.add('correct');
    } else if (result.match) {
        // Close match (orange)
        input.classList.add('close');
        // Add to end of queue
        requeueCard();
    } else {
        input.classList.add('wrong');
        input.value += ` (${correctAnswer})`; // Show correct answer
    }

    // Hide hint immediately for this side
    const hintBtn = document.getElementById(`${side}-hint-btn`);
    if (hintBtn) hintBtn.classList.add('hidden');

    // Also highlight in options if they exist
    const optionsContainer = side === 'front' ? document.getElementById('front-options') : document.getElementById('back-options');
    if (optionsContainer) {
        const optionBtns = optionsContainer.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.disabled = true;
            if (btn.textContent.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
                btn.classList.add('correct');
            }
        });
    }

    // Replace blanks immediately for this side only
    replaceBlanksForSide(side);

    // Show explanation immediately for this side only
    showExplanationForSide(side);

    // If both sides answered, track mistakes
    if (frontAnswered && backAnswered) {
        const bothCorrect = frontCorrect && backCorrect;

        // Track mistakes (only during main session, not during mistake review)
        if (!isReviewingMistakes && !bothCorrect && currentIndex < originalFlashcardsCount) {
            const card = flashcards[currentIndex];
            const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
            if (!alreadyAdded) {
                mistakeCards.push(JSON.parse(JSON.stringify(card)));
            }
        }

        // Update word statistics
        updateWordStatistics(flashcards[currentIndex].word, bothCorrect);
    }

    updateProgressIndicators();
}

function requeueCard() {
    const card = flashcards[currentIndex];
    // Clone card to avoid reference issues if we modify it
    const newCard = JSON.parse(JSON.stringify(card));
    flashcards.push(newCard);
    totalCardsSpan.textContent = flashcards.length;
    updateProgressIndicators();
}

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

// Card flip handler
flashcard.addEventListener('click', () => {
    flipCard();
});

// Navigation
prevBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        showCard(currentIndex);
    }
});

nextBtn.addEventListener('click', () => {
    if (currentIndex < flashcards.length - 1) {
        currentIndex++;
        showCard(currentIndex);
    } else {
        // Check if all cards are answered
        const unansweredIndex = findFirstUnanswered();
        if (unansweredIndex !== -1) {
            // Show countdown and redirect
            showUnansweredWarning(unansweredIndex);
        } else {
            showCompleteScreen();
        }
    }
});

retryBtn.addEventListener('click', () => {
    location.reload();
});

restartBtn.addEventListener('click', () => {
    currentIndex = 0;
    showCard(currentIndex);
    completeScreen.classList.add('hidden');
    cardContainer.classList.remove('hidden');
});

closeBtn.addEventListener('click', () => {
    window.close();
});

// Load flashcards from background
async function loadFlashcards() {
    try {
        loadingScreen.classList.remove('hidden');

        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_CONTEXT_CARDS' });

        if (!response.success) {
            showError(response.error || i18n.getMessage('error_unknown'));
            return;
        }

        flashcards = response.data;
        if (response.targetLanguage) {
            targetLanguage = response.targetLanguage.toUpperCase();
        }

        if (!flashcards || flashcards.length === 0) {
            showError(i18n.getMessage('error_no_words'));
            return;
        }

        loadingScreen.classList.add('hidden');
        cardContainer.classList.remove('hidden');

        originalFlashcardsCount = flashcards.length; // Store original count
        totalCardsSpan.textContent = flashcards.length;
        initializeProgressIndicators();
        showCard(0);

    } catch (error) {
        console.error('Error loading flashcards:', error);
        showError(error.message || i18n.getMessage('error_unknown'));
    }
}

// Show card
function showCard(index) {
    if (index < 0 || index >= flashcards.length) return;

    const card = flashcards[index];

    // Save current card state before switching
    if (currentIndex !== index && cardStates[currentIndex]) {
        cardStates[currentIndex] = {
            frontAnswered,
            backAnswered,
            frontCorrect,
            backCorrect,
            frontSelected: cardStates[currentIndex].frontSelected,
            backSelected: cardStates[currentIndex].backSelected,
            frontMode: frontMode,
            backMode: backMode,
            frontInputValue: document.getElementById('front-input').value,
            backInputValue: document.getElementById('back-input').value
        };
    }

    // Reset flip state
    if (isFlipped) {
        flashcard.classList.remove('flipped');
        isFlipped = false;
    }

    // Load saved state or reset
    if (cardStates[index]) {
        frontAnswered = cardStates[index].frontAnswered;
        backAnswered = cardStates[index].backAnswered;
        frontCorrect = cardStates[index].frontCorrect;
        backCorrect = cardStates[index].backCorrect;
    } else {
        frontAnswered = false;
        backAnswered = false;
        frontCorrect = false;
        backCorrect = false;
        cardStates[index] = {
            frontAnswered: false,
            backAnswered: false,
            frontCorrect: false,
            backCorrect: false,
            frontSelected: null,
            backSelected: null,
            frontMode: 'manual',
            backMode: 'manual',
            frontInputValue: '',
            backInputValue: ''
        };
    }

    // Restore modes
    frontMode = cardStates[index].frontMode || 'manual'; // default to manual
    backMode = cardStates[index].backMode || 'manual';   // default to manual
    setMode('front', frontMode);
    setMode('back', backMode);

    // Restore inputs with full state
    ['front', 'back'].forEach(side => {
        const input = document.getElementById(`${side}-input`);
        const submit = document.getElementById(`${side}-submit`);
        const isAnswered = side === 'front' ? frontAnswered : backAnswered;
        const isCorrect = side === 'front' ? frontCorrect : backCorrect;

        // Restore value
        if (side === 'front') {
            input.value = cardStates[index].frontInputValue || '';
        } else {
            input.value = cardStates[index].backInputValue || '';
        }

        // Restore state based on whether it was answered
        if (isAnswered) {
            input.disabled = true;
            submit.disabled = true;
            input.className = 'manual-input';
            if (isCorrect) {
                input.classList.add('correct');
            } else {
                input.classList.add('wrong');
            }
        } else {
            input.disabled = false;
            submit.disabled = false;
            input.className = 'manual-input';
        }
    });

    // Update card content
    document.getElementById('front-sentence').textContent = card.en.replace(/_+/g, '______');
    document.getElementById('back-sentence').textContent = card.ru.replace(/_+/g, '______');
    document.getElementById('front-lang').textContent = 'EN';
    document.getElementById('back-lang').textContent = targetLanguage;

    // Render options with saved state
    renderOptions('front-options', card.options_en || [], card.word, 'en');
    renderOptions('back-options', card.options_ru || [], card.word, 'ru');

    // Setup hint buttons (hide if already answered)
    setupHintButton('front-hint-btn', card.hint_en || card.hint);
    setupHintButton('back-hint-btn', card.hint_ru || card.hint);

    if (frontAnswered) {
        document.getElementById('front-hint-btn')?.classList.add('hidden');
    }
    if (backAnswered) {
        document.getElementById('back-hint-btn')?.classList.add('hidden');
    }

    // Show/hide feedback and explanation based on state
    if (frontAnswered || backAnswered) {
        // Show explanation for the current side if answered
        const currentSide = isFlipped ? 'back' : 'front';
        const sideAnswered = currentSide === 'front' ? frontAnswered : backAnswered;

        if (sideAnswered) {
            showExplanationForSide(currentSide);
            replaceBlanksForSide(currentSide);
        }

        // If the other side is also answered, replace its blanks too
        const otherSide = currentSide === 'front' ? 'back' : 'front';
        const otherAnswered = otherSide === 'front' ? frontAnswered : backAnswered;
        if (otherAnswered) {
            replaceBlanksForSide(otherSide);
        }
    } else {
        document.getElementById('feedback-message').classList.add('hidden');
        document.getElementById('explanation-section').classList.add('hidden');
    }

    // Update progress
    if (isReviewingMistakes && index >= originalFlashcardsCount) {
        // During mistake review, show relative index (1, 2, 3...)
        currentCardSpan.textContent = (index - originalFlashcardsCount) + 1;
    } else {
        currentCardSpan.textContent = index + 1;
    }
    updateProgressIndicators();

    // Update button states
    prevBtn.disabled = index === 0;
    const finishText = i18n.getMessage('def_cards_finish');
    const nextText = i18n.getMessage('def_cards_next');
    nextBtn.textContent = index === flashcards.length - 1 ? finishText : nextText;

    // Add entrance animation
    flashcard.style.animation = 'none';
    setTimeout(() => {
        flashcard.style.animation = 'fadeIn 0.3s ease-out';
    }, 10);
}

// Render options
function renderOptions(containerId, options, correctAnswerEn, language) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!options || options.length === 0) return;

    const card = flashcards[currentIndex];
    const correctAnswer = language === 'en' ?
        (card.correct_answer_en || correctAnswerEn) :
        card.correct_answer_ru;

    const isAnswered = language === 'en' ? frontAnswered : backAnswered;
    const savedSelected = language === 'en' ?
        cardStates[currentIndex]?.frontSelected :
        cardStates[currentIndex]?.backSelected;

    options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = option;

        // Restore previous state if already answered
        if (isAnswered) {
            btn.disabled = true;

            // Highlight the selected option
            if (option === savedSelected) {
                const wasCorrect = option.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
                btn.classList.add(wasCorrect ? 'correct' : 'wrong');
            }

            // Always highlight the correct answer
            if (option.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
                btn.classList.add('correct');
            }
        } else {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card flip
                handleOptionClick(btn, option, correctAnswer, language, container);
            });
        }

        container.appendChild(btn);
    });
}

// Handle option click
function handleOptionClick(btn, selectedOption, correctAnswer, language, container) {
    // Disable all buttons
    const allButtons = container.querySelectorAll('.option-btn');
    allButtons.forEach(b => b.disabled = true);

    // Determine if answer is correct
    const isCorrect = selectedOption.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
    const side = language === 'en' ? 'front' : 'back';

    if (language === 'en') {
        frontAnswered = true;
        frontCorrect = isCorrect;
        cardStates[currentIndex].frontAnswered = true;
        cardStates[currentIndex].frontCorrect = isCorrect;
        cardStates[currentIndex].frontSelected = selectedOption;
    } else {
        backAnswered = true;
        backCorrect = isCorrect;
        cardStates[currentIndex].backAnswered = true;
        cardStates[currentIndex].backCorrect = isCorrect;
        cardStates[currentIndex].backSelected = selectedOption;
    }

    if (isCorrect) {
        btn.classList.add('correct');
    } else {
        btn.classList.add('wrong');
        // Highlight correct answer
        allButtons.forEach(b => {
            if (b.textContent.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
                b.classList.add('correct');
            }
        });
    }

    // Hide hint button immediately for this side
    const hintBtn = language === 'en' ?
        document.getElementById('front-hint-btn') :
        document.getElementById('back-hint-btn');
    if (hintBtn) hintBtn.classList.add('hidden');

    // Always update the manual input to synchronize both modes
    const inputId = language === 'en' ? 'front-input' : 'back-input';
    const input = document.getElementById(inputId);
    const submitBtn = document.getElementById(language === 'en' ? 'front-submit' : 'back-submit');
    if (input) {
        input.disabled = true;
        submitBtn.disabled = true;

        if (isCorrect) {
            // Fill with the correct answer and mark as correct
            input.value = correctAnswer;
            input.classList.add('correct');
        } else {
            // Fill with selected wrong answer and show correct answer
            input.value = `${selectedOption} (${correctAnswer})`;
            input.classList.add('wrong');
        }
    }

    // Replace blanks immediately for this side only
    replaceBlanksForSide(side);

    // Show explanation immediately for this side only
    showExplanationForSide(side);

    // If both sides answered, track mistakes
    if (frontAnswered && backAnswered) {
        const bothCorrect = frontCorrect && backCorrect;

        // Track mistakes (only during main session, not during mistake review)
        if (!isReviewingMistakes && !bothCorrect && currentIndex < originalFlashcardsCount) {
            const card = flashcards[currentIndex];
            const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
            if (!alreadyAdded) {
                mistakeCards.push(JSON.parse(JSON.stringify(card)));
            }
        }

        // Update word statistics
        updateWordStatistics(flashcards[currentIndex].word, bothCorrect);
    }

    updateProgressIndicators();

    // No auto-flip - user will flip the card manually by clicking
}

// Flip card
function flipCard() {
    if (isFlipped) {
        flashcard.classList.remove('flipped');
    } else {
        flashcard.classList.add('flipped');
    }
    isFlipped = !isFlipped;

    // Update explanation for the new current side
    updateExplanationLanguage();
}

// Update explanation language based on current side
function updateExplanationLanguage() {
    const currentSide = isFlipped ? 'back' : 'front';
    const sideAnswered = currentSide === 'front' ? frontAnswered : backAnswered;

    // Only show explanation if current side is answered
    if (sideAnswered) {
        showExplanationForSide(currentSide);
    } else {
        document.getElementById('feedback-message').classList.add('hidden');
        document.getElementById('explanation-section').classList.add('hidden');
    }
}

// Show error screen
function showError(message) {
    loadingScreen.classList.add('hidden');
    cardContainer.classList.add('hidden');
    completeScreen.classList.add('hidden');
    errorScreen.classList.remove('hidden');
    errorMessage.textContent = message;
}

// Show complete screen
function showCompleteScreen() {
    // Check if we have mistakes to review and haven't started mistake review yet
    if (!isReviewingMistakes && mistakeCards.length > 0) {
        showMistakeReviewScreen();
    } else {
        // Show final complete screen
        cardContainer.classList.add('hidden');
        completeScreen.classList.remove('hidden');
    }
}

function showMistakeReviewScreen() {
    const feedbackMsg = document.getElementById('feedback-message');
    if (feedbackMsg) {
        feedbackMsg.className = 'feedback-message';
        feedbackMsg.style.background = 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)';
        feedbackMsg.style.fontSize = '20px';
        feedbackMsg.style.padding = '20px';
        feedbackMsg.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 32px; margin-bottom: 12px;">📝</div>
                <div style="font-weight: 700; margin-bottom: 8px;">${i18n.getMessage('mistakes_review_title')}</div>
                <div style="font-size: 16px; opacity: 0.9;">${i18n.getMessage('mistakes_review_subtitle')}</div>
                <div style="margin-top: 16px; font-size: 18px; font-weight: 600;">${mistakeCards.length} ${mistakeCards.length === 1 ? i18n.getMessage('card_singular') : i18n.getMessage('card_plural')}</div>
            </div>
        `;
        feedbackMsg.classList.remove('hidden');

        // Auto-start mistake review after 3 seconds
        setTimeout(() => {
            startMistakeReview();
        }, 3000);
    }
}

function startMistakeReview() {
    isReviewingMistakes = true;

    // Reset card states for mistake cards only
    const mistakeStartIndex = flashcards.length;
    mistakeCards.forEach((card, index) => {
        flashcards.push(card);
        cardStates[mistakeStartIndex + index] = {
            frontAnswered: false,
            backAnswered: false,
            frontCorrect: false,
            backCorrect: false
        };
    });

    // Update total count to show mistake cards count
    totalCardsSpan.textContent = mistakeCards.length;

    // Recreate progress sidebar for mistake cards
    initializeMistakeProgressIndicators();

    // Navigate to first mistake card
    currentIndex = mistakeStartIndex;

    // Reset current card counter to 1
    currentCardSpan.textContent = 1;

    showCard(currentIndex);

    // Hide the feedback message
    const feedbackMsg = document.getElementById('feedback-message');
    if (feedbackMsg) {
        feedbackMsg.classList.add('hidden');
    }
}

function initializeMistakeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    mistakeCards.forEach((_, index) => {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        const number = document.createElement('span');
        number.className = 'progress-box-number';
        number.textContent = index + 1;
        box.appendChild(number);
        const actualIndex = originalFlashcardsCount + index;
        box.dataset.index = actualIndex;
        box.addEventListener('click', () => {
            currentIndex = actualIndex;
            showCard(actualIndex);
        });
        sidebar.appendChild(box);
    });
}

// Setup hint button
function setupHintButton(buttonId, hintText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    btn.classList.remove('hidden');
    btn.onclick = (e) => {
        e.stopPropagation(); // Prevent card flip when clicking hint
        showHint(hintText);
    };
}

// Show hint in a temporary overlay
function showHint(hintText) {
    const existingHint = document.querySelector('.hint-overlay');
    if (existingHint) existingHint.remove();

    const overlay = document.createElement('div');
    overlay.className = 'hint-overlay';
    overlay.innerHTML = `
        <div class="hint-content">
            <div class="hint-icon">💡</div>
            <p>${hintText}</p>
        </div>
    `;
    document.body.appendChild(overlay);

    // Auto-hide after 5 seconds
    setTimeout(() => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
    }, 5000);

    // Click to close
    overlay.addEventListener('click', () => {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
    });
}


// Replace blanks for a specific side only
function replaceBlanksForSide(side) {
    const card = flashcards[currentIndex];

    if (side === 'front') {
        const frontSentence = document.getElementById('front-sentence');
        const correctAnswerEn = card.correct_answer_en || card.word;
        const frontText = card.en;
        const frontFilled = frontText.replace(/_+/g, `<strong style="color: #60a5fa;">${correctAnswerEn}</strong>`);
        frontSentence.innerHTML = frontFilled;
    } else {
        const backSentence = document.getElementById('back-sentence');
        const correctAnswerRu = card.correct_answer_ru;
        const backText = card.ru;
        const backFilled = backText.replace(/_+/g, `<strong style="color: #60a5fa;">${correctAnswerRu}</strong>`);
        backSentence.innerHTML = backFilled;
    }
}

// Show explanation for a specific side only
function showExplanationForSide(side) {
    const card = flashcards[currentIndex];
    const feedbackMsg = document.getElementById('feedback-message');
    const explanationSection = document.getElementById('explanation-section');
    const explanationText = document.getElementById('explanation-text');

    // Determine correctness for this side only
    const isCorrect = side === 'front' ? frontCorrect : backCorrect;

    // Show feedback based on this side's result
    feedbackMsg.textContent = isCorrect ? i18n.getMessage('flashcards_correct') : i18n.getMessage('flashcards_wrong');
    feedbackMsg.className = isCorrect ? 'feedback-message success' : 'feedback-message failure';
    feedbackMsg.classList.remove('hidden');

    // Show explanation in correct language for this side
    const currentLang = side === 'front' ? 'en' : 'ru';
    const explanation = currentLang === 'en'
        ? (card.explanation_en || card.explanation || i18n.getMessage('no_explanation'))
        : (card.explanation_ru || card.explanation || i18n.getMessage('no_explanation'));

    explanationText.textContent = explanation;
    explanationSection.classList.remove('hidden');
}

// Update word statistics
async function updateWordStatistics(word, isCorrect) {
    try {
        // Find the word in learning list and update its stats
        const response = await chrome.runtime.sendMessage({
            type: 'UPDATE_FLASHCARD_STATS',
            word: word,
            success: isCorrect
        });

        if (!response.success) {
            console.error('Failed to update word stats:', response.error);
        }
    } catch (error) {
        console.error('Error updating word statistics:', error);
    }
}

// Add fade animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .fade-in-content {
        animation: fadeIn 0.5s ease-out forwards;
    }
`;
document.head.appendChild(style);

// Adjust card height dynamically
function adjustCardHeight() {
    setTimeout(() => {
        const card = document.getElementById('flashcard');
        if (!card) return;

        // Get both faces
        const frontFace = card.querySelector('.card-front');
        const backFace = card.querySelector('.card-back');

        if (!frontFace || !backFace) return;

        // Calculate heights
        const frontHeight = frontFace.scrollHeight;
        const backHeight = backFace.scrollHeight;

        // Use the larger height
        const maxHeight = Math.max(frontHeight, backHeight, 400);
        card.style.height = `${maxHeight}px`;
    }, 50);
}

// Initialize progress indicators
function initializeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    // Only show progress for original cards, not mistake review cards
    const cardsToShow = Math.min(flashcards.length, originalFlashcardsCount || flashcards.length);

    for (let index = 0; index < cardsToShow; index++) {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        const number = document.createElement('span');
        number.className = 'progress-box-number';
        number.textContent = index + 1;
        box.appendChild(number);
        box.dataset.index = index;
        box.addEventListener('click', () => {
            // Only allow navigation to original cards
            if (index < originalFlashcardsCount) {
                currentIndex = index;
                showCard(index);
            }
        });
        sidebar.appendChild(box);
    }
}

// Update progress indicators
function updateProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    const boxes = sidebar.querySelectorAll('.progress-box');
    boxes.forEach((box, boxIndex) => {
        // Get actual card index from data attribute
        const actualIndex = parseInt(box.dataset.index);
        const state = cardStates[actualIndex];

        // Remove all state classes
        box.classList.remove('unanswered', 'correct', 'incorrect', 'partial', 'active',
            'partial-left-correct', 'partial-left-incorrect', 'partial-right-correct', 'partial-right-incorrect');

        if (state && state.frontAnswered && state.backAnswered) {
            // Both answered - show full square
            if (state.frontCorrect && state.backCorrect) {
                box.classList.add('correct');
            } else if (!state.frontCorrect && !state.backCorrect) {
                box.classList.add('incorrect');
            } else {
                // Mixed result - use base color and triangles
                box.classList.add('unanswered'); // neutral background
                if (state.frontCorrect) {
                    box.classList.add('partial-left-correct');
                } else {
                    box.classList.add('partial-left-incorrect');
                }
                if (state.backCorrect) {
                    box.classList.add('partial-right-correct');
                } else {
                    box.classList.add('partial-right-incorrect');
                }
            }
        } else if (state && (state.frontAnswered || state.backAnswered)) {
            // Only one side answered - show triangle
            box.classList.add('unanswered'); // neutral background
            if (state.frontAnswered) {
                if (state.frontCorrect) {
                    box.classList.add('partial-left-correct');
                } else {
                    box.classList.add('partial-left-incorrect');
                }
            }
            if (state.backAnswered) {
                if (state.backCorrect) {
                    box.classList.add('partial-right-correct');
                } else {
                    box.classList.add('partial-right-incorrect');
                }
            }
        } else {
            box.classList.add('unanswered');
        }

        // Highlight current
        if (actualIndex === currentIndex) {
            box.classList.add('active');
        }
    });
}

// Find first unanswered card (only in original cards, not mistake review)
function findFirstUnanswered() {
    const checkLimit = isReviewingMistakes ? flashcards.length : originalFlashcardsCount;
    for (let i = 0; i < checkLimit; i++) {
        const state = cardStates[i];
        // Allow finishing if answered at least one side
        if (!state || (!state.frontAnswered && !state.backAnswered)) {
            return i;
        }
    }
    return -1;
}

// Show unanswered warning with countdown
function showUnansweredWarning(unansweredIndex) {
    const feedbackMsg = document.getElementById('feedback-message');
    if (feedbackMsg) {
        feedbackMsg.className = 'feedback-message failure';
        let countdown = 3;
        feedbackMsg.textContent = `${i18n.getMessage('flashcards_unanswered_warning') || 'You have unanswered cards! Redirecting in'} ${countdown}...`;
        feedbackMsg.classList.remove('hidden');

        const interval = setInterval(() => {
            countdown--;
            if (countdown <= 0) {
                clearInterval(interval);
                feedbackMsg.classList.add('hidden');
                currentIndex = unansweredIndex;
                showCard(unansweredIndex);
            } else {
                feedbackMsg.textContent = `${i18n.getMessage('flashcards_unanswered_warning') || 'You have unanswered cards! Redirecting in'} ${countdown}...`;
            }
        }, 1000);
    }
}
