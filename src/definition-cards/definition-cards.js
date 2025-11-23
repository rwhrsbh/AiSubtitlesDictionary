import { I18nService } from '../services/i18n.js';
import { isCloseMatch, formatOptionForDisplay } from '../services/utils.js';

const i18n = new I18nService();

// Definition Cards Logic

let cards = [];
let currentIndex = 0;
let isFlipped = false;
let frontMode = 'manual';
let backMode = 'manual';
let frontAnswered = false;
let backAnswered = false;
let frontCorrect = false;
let backCorrect = false;
let cardStates = {};
let targetLanguage = 'RU';

// Mistake review mode
let mistakeCards = [];
let isReviewingMistakes = false;
let originalCardsCount = 0;

// DOM Elements
const loadingScreen = document.getElementById('loading-screen');
const cardContainer = document.getElementById('card-container');
const errorScreen = document.getElementById('error-screen');
const completeScreen = document.getElementById('complete-screen');
const definitionCard = document.getElementById('definition-card');
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
    setupManualInputs();
    await loadDefinitionCards();
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
            e.stopPropagation();
            if (e.key === 'Enter') handleSubmit(side);
        });

        input.addEventListener('input', (e) => {
            const value = e.target.value;
            if (!cardStates[currentIndex]) return;

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

    const card = cards[currentIndex];
    const wordEn = card.word;
    const wordRu = card.word_ru || card.word;

    // Check against both languages
    let matchResult;
    if (side === 'front') {
        // On front side, accept both EN and RU
        matchResult = isCloseMatch(value, wordEn, wordRu);
    } else {
        // On back side, accept both RU and EN
        matchResult = isCloseMatch(value, wordRu, wordEn);
    }

    const displayAnswer = side === 'front' ? wordEn : wordRu;
    handleManualResult(side, matchResult, input, displayAnswer);
}

function handleManualResult(side, result, input, correctAnswer) {
    input.disabled = true;
    document.getElementById(`${side}-submit`).disabled = true;

    const isCorrect = result.match;

    if (side === 'front') {
        frontAnswered = true;
        frontCorrect = isCorrect;
        cardStates[currentIndex] = cardStates[currentIndex] || {};
        cardStates[currentIndex].frontAnswered = true;
        cardStates[currentIndex].frontCorrect = isCorrect;
    } else {
        backAnswered = true;
        backCorrect = isCorrect;
        cardStates[currentIndex] = cardStates[currentIndex] || {};
        cardStates[currentIndex].backAnswered = true;
        cardStates[currentIndex].backCorrect = isCorrect;
    }

    if (result.exact) {
        input.classList.add('correct');
    } else if (result.match) {
        input.classList.add('close');
        requeueCard();
    } else {
        input.classList.add('wrong');
        input.value += ` (${correctAnswer})`;
    }

    // Show transcription immediately for this side
    const transId = side === 'front' ? 'card-transcription' : 'card-transcription-ru';
    document.getElementById(transId).classList.remove('hidden');

    // Also highlight in options if they exist
    const optionsContainer = side === 'front' ? document.getElementById('front-options') : document.getElementById('back-options');
    if (optionsContainer) {
        const optionBtns = optionsContainer.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.fullValue && btn.dataset.fullValue.toLowerCase().trim() === correctAnswer.toLowerCase().trim()) {
                btn.classList.add('correct');
            }
        });
    }

    // Replace blanks immediately for this side only
    replaceBlanksForSide(side);

    // Track mistakes if at least one side is answered incorrectly
    const hasIncorrectAnswer = (frontAnswered && !frontCorrect) || (backAnswered && !backCorrect);

    if (!isReviewingMistakes && hasIncorrectAnswer && currentIndex < originalCardsCount) {
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

// Card flip handler
definitionCard.addEventListener('click', (e) => {
    // Don't flip if clicking on navigation buttons
    if (e.target.closest('.controls')) return;
    flipCard();
});

function flipCard() {
    if (isFlipped) {
        definitionCard.classList.remove('flipped');
    } else {
        definitionCard.classList.add('flipped');
    }
    isFlipped = !isFlipped;
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

// Load definition cards from background
async function loadDefinitionCards() {
    try {
        loadingScreen.classList.remove('hidden');

        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_DEFINITION_CARDS' });

        if (!response.success) {
            showError(response.error || i18n.getMessage('error_unknown'));
            return;
        }

        cards = response.data;
        if (response.targetLanguage) {
            targetLanguage = response.targetLanguage.toUpperCase();
        }

        if (!cards || cards.length === 0) {
            showError(i18n.getMessage('error_no_words'));
            return;
        }

        loadingScreen.classList.add('hidden');
        cardContainer.classList.remove('hidden');

        originalCardsCount = cards.length; // Store original count
        totalCardsSpan.textContent = cards.length;
        initializeProgressIndicators();
        showCard(0);

    } catch (error) {
        console.error('Error loading definition cards:', error);
        showError(error.message || i18n.getMessage('error_unknown'));
    }
}

// Show card
function showCard(index) {
    if (index < 0 || index >= cards.length) return;

    const card = cards[index];

    // Reset flip state
    if (isFlipped) {
        definitionCard.classList.remove('flipped');
        isFlipped = false;
    }

    // Initialize state if needed
    if (!cardStates[index]) {
        cardStates[index] = {
            frontAnswered: false,
            backAnswered: false,
            frontCorrect: false,
            backCorrect: false,
            frontMode: 'manual',
            backMode: 'manual',
            frontInputValue: '',
            backInputValue: ''
        };
    }

    frontAnswered = cardStates[index].frontAnswered;
    backAnswered = cardStates[index].backAnswered;
    frontCorrect = cardStates[index].frontCorrect;
    backCorrect = cardStates[index].backCorrect;
    frontMode = cardStates[index].frontMode || 'manual';
    backMode = cardStates[index].backMode || 'manual';

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
            // Restore the correct class
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

    // Update English side
    const defEn = card.definitions[0]?.meaning_en || 'No definition';
    document.getElementById('card-hint-en').textContent = defEn;
    document.getElementById('card-transcription').textContent = card.transcription || '';

    // Show/hide transcription based on answered state
    if (frontAnswered) {
        document.getElementById('card-transcription').classList.remove('hidden');
    } else {
        document.getElementById('card-transcription').classList.add('hidden');
    }

    // Update Russian side
    const defRu = card.definitions[0]?.meaning_ru || 'Нет определения';
    document.getElementById('card-hint-ru').textContent = defRu;
    document.getElementById('card-transcription-ru').textContent = card.transcription || '';

    // Show/hide transcription based on answered state
    if (backAnswered) {
        document.getElementById('card-transcription-ru').classList.remove('hidden');
    } else {
        document.getElementById('card-transcription-ru').classList.add('hidden');
    }

    // Dynamically determine language badges based on word_language
    const wordLang = card.word_language || 'English'; // Default to English if not specified
    let frontLangCode, backLangCode;

    if (wordLang === 'English') {
        frontLangCode = 'EN';
        backLangCode = targetLanguage;
    } else if (wordLang === 'Russian' || wordLang === 'Ukrainian') {
        // If word is in target language, show it on front and English on back
        frontLangCode = wordLang === 'Russian' ? 'RU' : 'UK';
        backLangCode = 'EN';
    } else {
        // For other languages, show language code on front and target on back
        const langCodes = {
            'Spanish': 'ES',
            'French': 'FR',
            'German': 'DE',
            'Italian': 'IT',
            'Portuguese': 'PT',
            'Chinese': 'ZH',
            'Japanese': 'JA',
            'Korean': 'KO',
            'Arabic': 'AR'
        };
        frontLangCode = langCodes[wordLang] || wordLang.substring(0, 2).toUpperCase();
        backLangCode = targetLanguage;
    }

    document.getElementById('front-lang').textContent = frontLangCode;
    document.getElementById('back-lang').textContent = backLangCode;

    // Show Category
    const categoryBadgeFront = document.getElementById('card-category-front');
    const categoryBadgeBack = document.getElementById('card-category-back');

    if (card.category) {
        let text = card.category;
        if (card.word_language) {
            text += ` • ${card.word_language}`;
        }
        categoryBadgeFront.textContent = text;
        categoryBadgeBack.textContent = text;
        categoryBadgeFront.style.display = 'block';
        categoryBadgeBack.style.display = 'block';
    } else {
        categoryBadgeFront.style.display = 'none';
        categoryBadgeBack.style.display = 'none';
    }

    // Render Examples (will be replaced with answers if side was answered)
    renderExamples('examples-container-en', card.definitions, 'en');
    renderExamples('examples-container-ru', card.definitions, 'ru');

    // Replace blanks if sides were answered
    if (frontAnswered) {
        replaceBlanksForSide('front');
    }
    if (backAnswered) {
        replaceBlanksForSide('back');
    }

    // Render Options
    renderOptions('front-options', card.distractors_en, card.word, 'en');
    renderOptions('back-options', card.distractors_ru, card.word_ru || card.word, 'ru');

    // Scale card to fit viewport
    setTimeout(() => {
        scaleCardToFit();
    }, 100);

    // Update progress
    if (isReviewingMistakes && index >= originalCardsCount) {
        // During mistake review, show relative index (1, 2, 3...)
        currentCardSpan.textContent = (index - originalCardsCount) + 1;
    } else {
        currentCardSpan.textContent = index + 1;
    }
    updateProgressIndicators();

    // Update button states
    prevBtn.disabled = index === 0;
    const finishText = i18n.getMessage('def_cards_finish');
    const nextText = i18n.getMessage('def_cards_next');
    nextBtn.textContent = index === cards.length - 1 ? finishText : nextText;
}

// Scale card to fit in viewport
function scaleCardToFit() {
    const card = document.querySelector('.card');

    if (!card) return;

    // Reset scale first
    card.style.transform = 'scale(1)';

    // Get card dimensions
    const cardHeight = card.offsetHeight;
    const cardWidth = card.offsetWidth;

    // Get available viewport space
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Reserve minimal space for header (~100px) and controls (~80px)
    const availableHeight = viewportHeight - 180;
    const availableWidth = viewportWidth - 40;

    // Calculate scale needed
    let scale = 1;

    if (cardHeight > availableHeight) {
        scale = Math.min(scale, availableHeight / cardHeight);
    }

    if (cardWidth > availableWidth) {
        scale = Math.min(scale, availableWidth / cardWidth);
    }

    // Apply scale if needed
    if (scale < 1) {
        scale = scale * 0.98; // 2% margin
        card.style.transform = `scale(${scale})`;
    }
}

// Recalculate scale on window resize
window.addEventListener('resize', () => {
    if (cards.length > 0 && !cardContainer.classList.contains('hidden')) {
        scaleCardToFit();
    }
});

// Render examples
function renderExamples(containerId, definitions, language) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!definitions || definitions.length === 0) return;

    definitions.forEach(def => {
        const examplesKey = language === 'en' ? 'examples_en' : 'examples_ru';
        const examples = def[examplesKey] || def.examples || [];

        examples.forEach(example => {
            const div = document.createElement('div');
            div.className = 'example-item';
            div.innerHTML = example.text.replace(/____/g, '<span class="example-blank">____</span>');
            container.appendChild(div);
        });
    });
}

// Render options
function renderOptions(containerId, distractors, correctAnswer, language) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!distractors) return;

    // Combine and shuffle
    const options = [...distractors, correctAnswer].sort(() => Math.random() - 0.5);

    const isAnswered = language === 'en' ? frontAnswered : backAnswered;

    options.forEach(option => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = formatOptionForDisplay(option);
        btn.dataset.fullValue = option;

        if (isAnswered) {
            btn.disabled = true;
            if (option === correctAnswer) btn.classList.add('correct');
        } else {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleOptionClick(btn, option, correctAnswer, language, container);
            });
        }

        container.appendChild(btn);
    });
}

function handleOptionClick(btn, selectedOption, correctAnswer, language, container) {
    const allButtons = container.querySelectorAll('.option-btn');
    allButtons.forEach(b => b.disabled = true);

    const isCorrect = selectedOption === correctAnswer;
    const side = language === 'en' ? 'front' : 'back';

    if (language === 'en') {
        frontAnswered = true;
        frontCorrect = isCorrect;
        cardStates[currentIndex] = cardStates[currentIndex] || {};
        cardStates[currentIndex].frontAnswered = true;
        cardStates[currentIndex].frontCorrect = isCorrect;
    } else {
        backAnswered = true;
        backCorrect = isCorrect;
        cardStates[currentIndex] = cardStates[currentIndex] || {};
        cardStates[currentIndex].backAnswered = true;
        cardStates[currentIndex].backCorrect = isCorrect;
    }

    if (isCorrect) {
        btn.classList.add('correct');
    } else {
        btn.classList.add('wrong');
        allButtons.forEach(b => {
            if (b.dataset.fullValue === correctAnswer) b.classList.add('correct');
        });
    }

    // Show transcription immediately for this side
    const transId = language === 'en' ? 'card-transcription' : 'card-transcription-ru';
    document.getElementById(transId).classList.remove('hidden');

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

    // Track mistakes if at least one side is answered incorrectly
    const hasIncorrectAnswer = (frontAnswered && !frontCorrect) || (backAnswered && !backCorrect);

    if (!isReviewingMistakes && hasIncorrectAnswer && currentIndex < originalCardsCount) {
        const card = cards[currentIndex];
        const alreadyAdded = mistakeCards.some(mc => mc.word === card.word);
        if (!alreadyAdded) {
            mistakeCards.push(JSON.parse(JSON.stringify(card)));
        }
    }

    updateProgressIndicators();
}

// Replace blanks for a specific side only
function replaceBlanksForSide(side) {
    const card = cards[currentIndex];

    if (side === 'front') {
        // Replace blanks in English examples only
        const examplesContainerEn = document.getElementById('examples-container-en');
        if (examplesContainerEn && card.definitions) {
            examplesContainerEn.innerHTML = '';
            card.definitions.forEach(def => {
                const examples = def.examples_en || def.examples || [];
                examples.forEach(example => {
                    const div = document.createElement('div');
                    div.className = 'example-item';
                    const filled = example.text.replace(/____/g, `<strong style="color: #60a5fa;">${card.word}</strong>`);
                    div.innerHTML = filled;
                    examplesContainerEn.appendChild(div);
                });
            });
        }
    } else {
        // Replace blanks in Russian/target language examples only
        const examplesContainerRu = document.getElementById('examples-container-ru');
        if (examplesContainerRu && card.definitions) {
            examplesContainerRu.innerHTML = '';
            card.definitions.forEach(def => {
                const examples = def.examples_ru || def.examples || [];
                examples.forEach(example => {
                    const div = document.createElement('div');
                    div.className = 'example-item';
                    const wordToFill = card.word_ru || card.word;
                    const filled = example.text.replace(/____/g, `<strong style="color: #60a5fa;">${wordToFill}</strong>`);
                    div.innerHTML = filled;
                    examplesContainerRu.appendChild(div);
                });
            });
        }
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
    if (!feedbackMsg) {
        // Create feedback message element if it doesn't exist
        const newFeedback = document.createElement('div');
        newFeedback.id = 'feedback-message';
        newFeedback.className = 'feedback-message';
        cardContainer.insertBefore(newFeedback, cardContainer.firstChild);
    }

    const msg = document.getElementById('feedback-message');
    if (msg) {
        msg.className = 'feedback-message';
        msg.style.background = 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)';
        msg.style.fontSize = '20px';
        msg.style.padding = '20px';
        msg.style.borderRadius = '16px';
        msg.style.marginBottom = '24px';
        msg.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 12px;">📝</div>
            <div style="font-weight: 700; margin-bottom: 8px;">${i18n.getMessage('mistakes_review_title')}</div>
            <div style="font-size: 16px; opacity: 0.9;">${i18n.getMessage('mistakes_review_subtitle')}</div>
            <div style="margin-top: 16px; font-size: 18px; font-weight: 600;">${mistakeCards.length} ${mistakeCards.length === 1 ? i18n.getMessage('card_singular') : i18n.getMessage('card_plural')}</div>
        </div>
    `;
        msg.classList.remove('hidden');

        // Auto-start mistake review after 3 seconds
        setTimeout(() => {
            startMistakeReview();
        }, 3000);
    }
}

function startMistakeReview() {
    isReviewingMistakes = true;

    // Reset card states for mistake cards only
    const mistakeStartIndex = cards.length;
    mistakeCards.forEach((card, index) => {
        cards.push(card);
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
        const actualIndex = originalCardsCount + index;
        box.dataset.index = actualIndex;
        box.addEventListener('click', () => {
            currentIndex = actualIndex;
            showCard(actualIndex);
        });
        sidebar.appendChild(box);
    });
}

// Adjust card height dynamically
function adjustCardHeight() {
    setTimeout(() => {
        const card = document.getElementById('definition-card');
        if (!card) return;

        // Get both faces
        const frontFace = card.querySelector('.card-front');
        const backFace = card.querySelector('.card-back');

        if (!frontFace || !backFace) return;

        // Calculate heights
        const frontHeight = frontFace.scrollHeight;
        const backHeight = backFace.scrollHeight;

        // Use the larger height
        const maxHeight = Math.max(frontHeight, backHeight, 500);
        card.style.minHeight = `${maxHeight}px`;
    }, 50);
}

// Initialize progress indicators
function initializeProgressIndicators() {
    const sidebar = document.getElementById('progress-sidebar');
    if (!sidebar) return;

    sidebar.innerHTML = '';

    // Only show progress for original cards, not mistake review cards
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
            // Only allow navigation to original cards
            if (index < originalCardsCount) {
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
    boxes.forEach((box) => {
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
    const checkLimit = isReviewingMistakes ? cards.length : originalCardsCount;
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
    if (!feedbackMsg) {
        // Create feedback message element if it doesn't exist
        const newFeedback = document.createElement('div');
        newFeedback.id = 'feedback-message';
        newFeedback.className = 'feedback-message';
        cardContainer.insertBefore(newFeedback, cardContainer.firstChild);
    }

    const msg = document.getElementById('feedback-message');
    if (msg) {
        msg.className = 'feedback-message failure';
        let countdown = 3;
        msg.textContent = `${i18n.getMessage('def_cards_unanswered_warning') || 'You have unanswered cards! Redirecting in'} ${countdown}...`;
        msg.classList.remove('hidden');

        const interval = setInterval(() => {
            countdown--;
            if (countdown <= 0) {
                clearInterval(interval);
                msg.classList.add('hidden');
                currentIndex = unansweredIndex;
                showCard(unansweredIndex);
            } else {
                msg.textContent = `${i18n.getMessage('def_cards_unanswered_warning') || 'You have unanswered cards! Redirecting in'} ${countdown}...`;
            }
        }, 1000);
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
