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

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    localizeHtml();
    setupEventListeners();
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

            showCard(0);
        } else {
            showEmptyState();
        }
    } catch (error) {
        console.error('Error loading cards:', error);
        showEmptyState();
    }
}

function showCard(index) {
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

    // Show Translation as the "Question" (Front of card)
    document.getElementById('card-front-text').textContent = formatOptionForDisplay(card.translation);
    document.getElementById('card-transcription').textContent = wasAnswered && card.transcription ? card.transcription : '';

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
        input.focus();

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

function nextCard() {
    if (currentIndex < cards.length - 1) {
        showCard(currentIndex + 1);
    } else {
        // Last card, check if all answered
        const hasUnanswered = cardStates.some((state, idx) => idx < originalCardsCount && state === null);
        if (hasUnanswered) {
            const firstUnanswered = cardStates.findIndex((state, idx) => idx < originalCardsCount && state === null);
            if (firstUnanswered !== -1) {
                showCard(firstUnanswered);
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
        box.addEventListener('click', () => {
            if (index !== currentIndex) {
                showCard(index);
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

// Start mistake review
function startMistakeReview() {
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
    showCard(mistakeStartIndex);
}
