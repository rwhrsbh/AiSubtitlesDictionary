import { I18nService } from '../services/i18n.js';

const i18n = new I18nService();

// Definition Cards Logic

let cards = [];
let currentIndex = 0;
let isFlipped = false;

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

        if (!cards || cards.length === 0) {
            showError(i18n.getMessage('error_no_words'));
            return;
        }

        loadingScreen.classList.add('hidden');
        cardContainer.classList.remove('hidden');

        totalCardsSpan.textContent = cards.length;
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

    // Update English side
    document.getElementById('card-word-en').textContent = card.word;
    document.getElementById('card-transcription').textContent = card.transcription || '';

    // Update Russian side
    document.getElementById('card-word-ru').textContent = card.word_ru || card.word;
    document.getElementById('card-transcription-ru').textContent = card.transcription || '';

    // Render English definitions
    renderDefinitions('definitions-container-en', card.definitions, 'en');

    // Render Russian definitions
    renderDefinitions('definitions-container-ru', card.definitions, 'ru');

    // Scale card to fit viewport
    setTimeout(() => {
        scaleCardToFit();
    }, 100);

    // Update progress
    currentCardSpan.textContent = index + 1;

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

// Render definitions
function renderDefinitions(containerId, definitions, language) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!definitions || definitions.length === 0) return;

    definitions.forEach((def, idx) => {
        const defBlock = document.createElement('div');
        defBlock.className = 'definition-block';

        // Definition text
        const defText = document.createElement('div');
        defText.className = 'definition-text';
        const meaning = language === 'en' ? (def.meaning_en || def.meaning) : (def.meaning_ru || def.meaning);
        defText.textContent = meaning;
        defBlock.appendChild(defText);

        // Examples
        const examplesKey = language === 'en' ? 'examples_en' : 'examples_ru';
        const examples = def[examplesKey] || def.examples || [];

        if (examples && examples.length > 0) {
            const examplesList = document.createElement('div');
            examplesList.className = 'examples-list';

            examples.forEach(example => {
                const exampleItem = document.createElement('div');
                exampleItem.className = 'example-item';

                // Replace word with blank and highlight
                const exampleHTML = example.text.replace(/____/g, '<span class="example-blank">____</span>');
                exampleItem.innerHTML = exampleHTML;

                // Add preposition note if exists
                if (example.preposition) {
                    const prepNote = document.createElement('span');
                    prepNote.className = 'preposition-note';
                    prepNote.textContent = `+ ${example.preposition}`;
                    exampleItem.appendChild(prepNote);
                }

                examplesList.appendChild(exampleItem);
            });

            defBlock.appendChild(examplesList);
        }

        container.appendChild(defBlock);
    });
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
    errorMessage.textContent = i18n.getMessage('def_cards_reviewed_all');
}
