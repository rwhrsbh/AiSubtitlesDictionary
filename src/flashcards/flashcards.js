import { I18nService } from '../services/i18n.js';

const i18n = new I18nService();

// Flashcards Logic

let flashcards = [];
let currentIndex = 0;
let isFlipped = false;
let frontAnswered = false;
let backAnswered = false;
let frontCorrect = false;
let backCorrect = false;

// Store answer states for all cards
let cardStates = {}; // { cardIndex: { frontAnswered, backAnswered, frontCorrect, backCorrect, frontSelected, backSelected } }

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
    await loadFlashcards();
});

function localizeHtml() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const message = i18n.getMessage(key);
        if (message) {
            element.textContent = message;
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
        showCompleteScreen();
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

        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_FLASHCARDS' });

        if (!response.success) {
            showError(response.error || i18n.getMessage('error_unknown'));
            return;
        }

        flashcards = response.data;

        if (!flashcards || flashcards.length === 0) {
            showError(i18n.getMessage('error_no_words'));
            return;
        }

        loadingScreen.classList.add('hidden');
        cardContainer.classList.remove('hidden');

        totalCardsSpan.textContent = flashcards.length;
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
            backSelected: cardStates[currentIndex].backSelected
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
            backSelected: null
        };
    }

    // Update card content
    document.getElementById('front-sentence').textContent = card.en.replace(/_+/g, '______');
    document.getElementById('back-sentence').textContent = card.ru.replace(/_+/g, '______');
    document.getElementById('front-lang').textContent = 'EN';
    document.getElementById('back-lang').textContent = 'RU';

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
    if (frontAnswered && backAnswered) {
        showFeedbackAndExplanation();
    } else {
        document.getElementById('feedback-message').classList.add('hidden');
        document.getElementById('explanation-section').classList.add('hidden');
    }

    // Update progress
    currentCardSpan.textContent = index + 1;

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

    // Hide hint button after answering
    const hintBtn = language === 'en' ?
        document.getElementById('front-hint-btn') :
        document.getElementById('back-hint-btn');
    if (hintBtn) hintBtn.classList.add('hidden');

    // Check if both sides are answered
    if (frontAnswered && backAnswered) {
        // Show feedback and explanation
        showFeedbackAndExplanation();
    }
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

    // Update explanation language if both sides are answered
    if (frontAnswered && backAnswered) {
        updateExplanationLanguage();
    }
}

// Update explanation language based on current side
function updateExplanationLanguage() {
    const card = flashcards[currentIndex];
    const feedbackMsg = document.getElementById('feedback-message');
    const explanationText = document.getElementById('explanation-text');

    const bothCorrect = frontCorrect && backCorrect;
    const currentLang = isFlipped ? 'ru' : 'en';

    // Update feedback message
    // Update feedback message
    // Update feedback message
    feedbackMsg.textContent = bothCorrect ? i18n.getMessage('flashcards_correct') : i18n.getMessage('flashcards_wrong');

    // Update explanation
    const explanation = currentLang === 'en'
        ? (card.explanation_en || card.explanation || i18n.getMessage('no_explanation'))
        : (card.explanation_ru || card.explanation || i18n.getMessage('no_explanation'));

    explanationText.textContent = explanation;
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
    cardContainer.classList.add('hidden');
    completeScreen.classList.remove('hidden');
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

// Show feedback and explanation after both sides answered
function showFeedbackAndExplanation() {
    const card = flashcards[currentIndex];
    const feedbackMsg = document.getElementById('feedback-message');
    const explanationSection = document.getElementById('explanation-section');
    const explanationText = document.getElementById('explanation-text');

    // Determine feedback
    const bothCorrect = frontCorrect && backCorrect;

    // Update word statistics
    updateWordStatistics(card.word, bothCorrect);

    // Use language based on current side
    const currentLang = isFlipped ? 'ru' : 'en';

    // Update feedback message
    feedbackMsg.textContent = bothCorrect ? i18n.getMessage('flashcards_correct') : i18n.getMessage('flashcards_wrong');

    feedbackMsg.className = bothCorrect ? 'feedback-message success' : 'feedback-message failure';
    feedbackMsg.classList.remove('hidden');

    // Show explanation in correct language
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
`;
document.head.appendChild(style);
