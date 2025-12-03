import { I18nService } from '../services/i18n.js';
import { isCloseMatch, formatOptionForDisplay } from '../services/utils.js';

const i18n = new I18nService();

// State
let cards = [];
let currentIndex = 0;
let cardStates = {};
let currentMode = 'manual';
let targetLanguage = 'ru';

// Mistake review
let mistakeCards = [];
let isReviewingMistakes = false;
let originalCardsCount = 0;

// DOM Elements
const loadingScreen = document.getElementById('loading-screen');
const cardContainer = document.getElementById('card-container');
const errorScreen = document.getElementById('error-screen');
const completeScreen = document.getElementById('complete-screen');
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
    setupModeToggles();
    setupManualInput();
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

function setupManualInput() {
    const input = document.getElementById('answer-input');
    const submit = document.getElementById('submit-btn');

    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') handleSubmit();
    });

    input.addEventListener('input', (e) => {
        if (!cardStates[currentIndex]) return;
        cardStates[currentIndex].inputValue = e.target.value;
    });

    input.addEventListener('click', (e) => e.stopPropagation());

    submit.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSubmit();
    });
}

function setMode(mode) {
    currentMode = mode;

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const inputArea = document.getElementById('input-area');
    const optionsArea = document.getElementById('options-area');

    inputArea.classList.add('hidden');
    optionsArea.classList.add('hidden');

    inputArea.classList.remove('fade-in-content');
    optionsArea.classList.remove('fade-in-content');

    if (mode === 'manual') {
        inputArea.classList.remove('hidden');
        inputArea.classList.add('fade-in-content');
        setTimeout(() => document.getElementById('answer-input').focus(), 100);
    } else if (mode === 'options') {
        optionsArea.classList.remove('hidden');
        optionsArea.classList.add('fade-in-content');
    }
}

function handleSubmit() {
    const input = document.getElementById('answer-input');
    const value = input.value.trim();
    if (!value) return;

    const card = cards[currentIndex];

    // Use AI-generated correct answer based on language
    const wordLangCode = card.word_language_code || 'en';
    const correctAnswerKey = `word_${wordLangCode}`;
    const correctAnswer = card[correctAnswerKey] || card.word;

    const matchResult = isCloseMatch(value, correctAnswer);

    handleManualResult(matchResult, input, correctAnswer);
}

function handleManualResult(result, input, correctAnswer) {
    input.disabled = true;
    document.getElementById('submit-btn').disabled = true;

    const isCorrect = result.match;

    cardStates[currentIndex] = cardStates[currentIndex] || {};
    cardStates[currentIndex].answered = true;
    cardStates[currentIndex].correct = isCorrect;

    if (result.exact) {
        input.classList.add('correct');
        cardStates[currentIndex].inputValue = correctAnswer;
    } else if (result.match) {
        input.classList.add('close');
        cardStates[currentIndex].inputValue = input.value;
        requeueCard();
    } else {
        input.classList.add('wrong');
        cardStates[currentIndex].inputValue = input.value;
        input.value += ` (${correctAnswer})`;
    }

    // Show transcription and explanation
    const card = cards[currentIndex];
    showFeedback(card);

    // Replace blanks with correct answer
    replaceBlanksWithAnswer();

    // Highlight correct answer in options if they exist
    const optionsContainer = document.getElementById('options-area');
    if (optionsContainer && !optionsContainer.classList.contains('hidden')) {
        const optionBtns = optionsContainer.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.fullValue && btn.dataset.fullValue.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
                btn.classList.add('correct');
            }
        });
    }

    // Track mistakes
    if (!isCorrect && !isReviewingMistakes && currentIndex < originalCardsCount) {
        const card = cards[currentIndex];
        const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
        if (!alreadyAdded) {
            mistakeCards.push(JSON.parse(JSON.stringify(card)));
        }
    }

    updateProgressIndicators();
}

function requeueCard() {
    const card = cards[currentIndex];
    const newCard = JSON.parse(JSON.stringify(card));
    cards.push(newCard);
    totalCardsSpan.textContent = cards.length;
    updateProgressIndicators();
}

function showFeedback(card) {
    const feedbackArea = document.getElementById('feedback-area');
    feedbackArea.classList.remove('hidden');

    // Show transcription
    if (card.transcription) {
        document.getElementById('card-transcription').textContent = card.transcription;
    }

    // Show flippable explanation
    const wordLangCode = card.word_language_code || 'en';
    const targetLangCode = targetLanguage.toLowerCase();

    const explanationTargetKey = `explanation_${targetLangCode}`;
    const explanationWordKey = `explanation_${wordLangCode}`;

    const explanationTarget = card[explanationTargetKey] || card.explanation || '';
    const explanationWord = card[explanationWordKey] || '';

    if (explanationTarget || explanationWord) {
        // Setup flip functionality
        const explanationCard = document.getElementById('explanation-card');
        explanationCard.classList.remove('flipped');

        // Remove old listener if exists
        const newExplanationCard = explanationCard.cloneNode(true);
        explanationCard.parentNode.replaceChild(newExplanationCard, explanationCard);

        // Set text AFTER replacing the element
        // Front: Interface language (target language)
        document.getElementById('explanation-text-front').textContent = explanationTarget;
        document.getElementById('explanation-front-lang').textContent = targetLangCode.toUpperCase();

        // Back: Word language
        document.getElementById('explanation-text-back').textContent = explanationWord;
        document.getElementById('explanation-back-lang').textContent = wordLangCode.toUpperCase();

        // Add click listener to the NEW element
        document.getElementById('explanation-card').addEventListener('click', () => {
            document.getElementById('explanation-card').classList.toggle('flipped');
        });

        document.getElementById('explanation-container').classList.remove('hidden');
    }
}

function replaceBlanksWithAnswer() {
    const card = cards[currentIndex];
    const wordLangCode = card.word_language_code || 'en';
    const examplesKey = `examples_${wordLangCode}`;
    const examples = card[examplesKey] || [];

    const container = document.getElementById('examples-container');
    if (!container || !examples || examples.length === 0) return;

    // Use AI-generated correct answer based on language
    const correctAnswerKey = `word_${wordLangCode}`;
    const correctAnswer = card[correctAnswerKey] || card.word;

    container.innerHTML = '';
    examples.forEach(example => {
        const div = document.createElement('div');
        div.className = 'example-item';

        let filled = example.text;

        // Check for answer_parts with language code for numbered blanks
        const answerPartsKey = `answer_parts_${wordLangCode}`;
        const answerParts = example[answerPartsKey];

        if (answerParts && Array.isArray(answerParts) && answerParts.length > 0) {
            // Replace numbered blanks: ____1____, ____2____, etc.
            answerParts.forEach((part, index) => {
                const blankNum = index + 1;
                const regex = new RegExp(`_{2,}${blankNum}_{2,}`, 'g');
                filled = filled.replace(regex, `<strong style="color: #60a5fa;">${part}</strong>`);
            });
        } else {
            // Fallback: replace all blanks with full answer
            filled = filled.replace(/_{2,}/g, `<strong style="color: #60a5fa;">${correctAnswer}</strong>`);
        }

        div.innerHTML = filled;
        container.appendChild(div);
    });
}

// Navigation
prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentIndex > 0) {
        currentIndex--;
        showCard(currentIndex);
    }
});

nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentIndex < cards.length - 1) {
        currentIndex++;
        showCard(currentIndex);
    } else {
        const unansweredIndex = findFirstUnanswered();
        if (unansweredIndex !== -1) {
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
    location.reload();
});

closeBtn.addEventListener('click', () => {
    window.close();
});

// Load flashcards
async function loadFlashcards() {
    try {
        loadingScreen.classList.remove('hidden');

        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_FLASHCARDS' });

        if (!response.success) {
            showError(response.error || i18n.getMessage('error_unknown'));
            return;
        }

        cards = response.data;
        if (response.targetLanguage) {
            targetLanguage = response.targetLanguage;
        }

        if (!cards || cards.length === 0) {
            showError(i18n.getMessage('error_no_words'));
            return;
        }

        loadingScreen.classList.add('hidden');
        cardContainer.classList.remove('hidden');

        originalCardsCount = cards.length;
        totalCardsSpan.textContent = cards.length;
        initializeProgressIndicators();
        showCard(0);

    } catch (error) {
        console.error('Error loading flashcards:', error);
        showError(error.message || i18n.getMessage('error_unknown'));
    }
}

// Show card
function showCard(index) {
    if (index < 0 || index >= cards.length) return;

    currentIndex = index;
    const card = cards[index];

    // Initialize state if needed
    if (!cardStates[index]) {
        cardStates[index] = {
            answered: false,
            correct: false,
            mode: 'manual',
            inputValue: ''
        };
    }

    const answered = cardStates[index].answered;
    const correct = cardStates[index].correct;
    currentMode = cardStates[index].mode || 'manual';

    setMode(currentMode);

    // Update progress
    currentCardSpan.textContent = isReviewingMistakes && index >= originalCardsCount
        ? (index - originalCardsCount) + 1
        : index + 1;
    updateProgressIndicators();

    // Show category
    const categoryBadge = document.getElementById('card-category');
    if (card.category) {
        let text = card.category;
        if (card.word_language) {
            text += ` • ${card.word_language}`;
        }
        categoryBadge.textContent = text;
        categoryBadge.style.display = 'block';
    } else {
        categoryBadge.style.display = 'none';
    }

    // Show language badge
    const wordLangCode = card.word_language_code || 'en';
    document.getElementById('card-lang').textContent = wordLangCode.toUpperCase();

    // Show translation (the question)
    const targetLangCode = targetLanguage.toLowerCase();
    const translationKey = `word_${targetLangCode}`;
    const translation = card[translationKey] || card.translation || card.word;
    document.getElementById('card-translation').textContent = formatOptionForDisplay(translation);

    // Render examples with blanks
    renderExamples(card);

    // Restore/reset input
    const input = document.getElementById('answer-input');
    const submit = document.getElementById('submit-btn');

    if (answered) {
        input.value = cardStates[index].inputValue || card.word;
        input.disabled = true;
        submit.disabled = true;
        input.className = 'manual-input';
        input.classList.add(correct ? 'correct' : 'wrong');

        showFeedback(card);
        replaceBlanksWithAnswer();
    } else {
        input.value = cardStates[index].inputValue || '';
        input.disabled = false;
        submit.disabled = false;
        input.className = 'manual-input';
        input.focus();

        document.getElementById('feedback-area').classList.add('hidden');
        document.getElementById('explanation-container').classList.add('hidden');
    }

    // Render options
    const wordLangCodeForDistractors = card.word_language_code || 'en';
    const distractorsKey = `distractors_${wordLangCodeForDistractors}`;
    const distractors = card[distractorsKey] || card.distractors_en || [];

    // Get correct answer for this language
    const correctAnswerKey = `word_${wordLangCodeForDistractors}`;
    const correctAnswer = card[correctAnswerKey] || card.word;

    renderOptions(distractors, correctAnswer, answered, correct);

    // Update button states
    prevBtn.disabled = index === 0;
    const finishText = i18n.getMessage('def_cards_finish') || 'Finish';
    const nextText = i18n.getMessage('def_cards_next') || 'Next';
    nextBtn.textContent = index === cards.length - 1 ? finishText : nextText;
}

function renderExamples(card) {
    const wordLangCode = card.word_language_code || 'en';
    const examplesKey = `examples_${wordLangCode}`;
    const examples = card[examplesKey] || [];

    const container = document.getElementById('examples-container');
    container.innerHTML = '';

    if (!examples || examples.length === 0) return;

    examples.forEach(example => {
        const div = document.createElement('div');
        div.className = 'example-item';
        // Replace all consecutive underscores (2 or more) with visual blank in blue
        div.innerHTML = example.text.replace(/_{2,}\d+_{2,}|_{2,}/g, '<strong style="color: #60a5fa;">______</strong>');
        container.appendChild(div);
    });
}

function renderOptions(distractors, correctAnswerFromParam, answered, correct) {
    const container = document.getElementById('options-area');
    container.innerHTML = '';

    if (!distractors || distractors.length === 0) return;

    // Use AI-generated correct answer based on language
    const card = cards[currentIndex];
    const wordLangCode = card.word_language_code || 'en';
    const correctAnswerKey = `word_${wordLangCode}`;
    const correctAnswer = card[correctAnswerKey] || card.word;

    const options = [...distractors, correctAnswer].sort(() => Math.random() - 0.5);

    options.forEach(option => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = formatOptionForDisplay(option);
        btn.dataset.fullValue = option;

        if (answered) {
            btn.disabled = true;
            if (option === correctAnswer) btn.classList.add('correct');
        } else {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleOptionClick(btn, option, correctAnswer, container);
            });
        }

        container.appendChild(btn);
    });
}

function handleOptionClick(btn, selectedOption, correctAnswer, container) {
    const allButtons = container.querySelectorAll('.option-btn');
    allButtons.forEach(b => b.disabled = true);

    const isCorrect = selectedOption === correctAnswer;

    cardStates[currentIndex] = cardStates[currentIndex] || {};
    cardStates[currentIndex].answered = true;
    cardStates[currentIndex].correct = isCorrect;

    if (isCorrect) {
        btn.classList.add('correct');
    } else {
        btn.classList.add('wrong');
        allButtons.forEach(b => {
            if (b.dataset.fullValue === correctAnswer) b.classList.add('correct');
        });
    }

    // Sync with manual input
    const input = document.getElementById('answer-input');
    const submitBtn = document.getElementById('submit-btn');
    if (input) {
        input.disabled = true;
        submitBtn.disabled = true;

        if (isCorrect) {
            input.value = correctAnswer;
            input.classList.add('correct');
        } else {
            input.value = `${selectedOption} (${correctAnswer})`;
            input.classList.add('wrong');
        }
    }

    const card = cards[currentIndex];
    showFeedback(card);
    replaceBlanksWithAnswer();

    // Track mistakes
    if (!isCorrect && !isReviewingMistakes && currentIndex < originalCardsCount) {
        const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
        if (!alreadyAdded) {
            mistakeCards.push(JSON.parse(JSON.stringify(card)));
        }
    }

    updateProgressIndicators();
}

function showError(message) {
    loadingScreen.classList.add('hidden');
    cardContainer.classList.add('hidden');
    completeScreen.classList.add('hidden');
    errorScreen.classList.remove('hidden');
    errorMessage.textContent = message;
}

function showCompleteScreen() {
    if (!isReviewingMistakes && mistakeCards.length > 0) {
        showMistakeReviewScreen();
    } else {
        cardContainer.classList.add('hidden');
        completeScreen.classList.remove('hidden');
    }
}

function showMistakeReviewScreen() {
    // TODO: Implement mistake review similar to definition cards
    // For now, just show complete screen
    cardContainer.classList.add('hidden');
    completeScreen.classList.remove('hidden');
}

function initializeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    const cardsToShow = Math.min(cards.length, originalCardsCount || cards.length);

    for (let index = 0; index < cardsToShow; index++) {
        const box = document.createElement('div');
        box.className = 'progress-box unanswered';
        const number = document.createElement('span');
        number.className = 'progress-box-number';
        number.textContent = index + 1;
        box.appendChild(number);
        box.dataset.index = index;
        box.addEventListener('click', () => {
            if (index < originalCardsCount) {
                currentIndex = index;
                showCard(index);
            }
        });
        sidebar.appendChild(box);
    }
}

function updateProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    const boxes = sidebar.querySelectorAll('.progress-box');
    boxes.forEach((box) => {
        const actualIndex = parseInt(box.dataset.index);
        const state = cardStates[actualIndex];

        box.classList.remove('unanswered', 'correct', 'incorrect', 'active');

        if (state && state.answered) {
            box.classList.add(state.correct ? 'correct' : 'incorrect');
        } else {
            box.classList.add('unanswered');
        }

        if (actualIndex === currentIndex) {
            box.classList.add('active');
        }
    });
}

function findFirstUnanswered() {
    const checkLimit = isReviewingMistakes ? cards.length : originalCardsCount;
    for (let i = 0; i < checkLimit; i++) {
        const state = cardStates[i];
        if (!state || !state.answered) {
            return i;
        }
    }
    return -1;
}

function showUnansweredWarning(unansweredIndex) {
    // Simple alert for now
    alert(i18n.getMessage('def_cards_unanswered_warning') || 'You have unanswered cards!');
    currentIndex = unansweredIndex;
    showCard(unansweredIndex);
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
