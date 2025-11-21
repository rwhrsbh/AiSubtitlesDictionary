import { StorageService } from '../services/storage.js';
import { I18nService } from '../services/i18n.js';

const storage = new StorageService();
const i18n = new I18nService();
let currentReviewWords = [];
let currentWordIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    localizeHtml();
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
}

async function loadReviewSession() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');

    if (mode === 'all') {
        const allWords = await storage.getLearningList();
        // Shuffle for better experience
        currentReviewWords = allWords.sort(() => Math.random() - 0.5);
    } else if (mode === 'problem') {
        const problemWords = await storage.getProblemWords();
        // Shuffle
        currentReviewWords = problemWords.sort(() => Math.random() - 0.5);
    } else {
        currentReviewWords = await storage.getWordsToReview();
    }
    const wordsToReviewText = i18n.getMessage('words_to_review');
    document.getElementById('words-count').textContent = `${currentReviewWords.length} ${wordsToReviewText}`;

    if (currentReviewWords.length === 0) {
        document.getElementById('quiz-container').classList.add('hidden');
        document.getElementById('no-review').classList.remove('hidden');
        return;
    }

    currentWordIndex = 0;
    showNextCard();
}

function showNextCard() {
    if (currentWordIndex >= currentReviewWords.length) {
        const completeTitle = i18n.getMessage('review_complete_title');
        const completeMsg = i18n.getMessage('review_complete_msg');
        document.getElementById('quiz-container').innerHTML = `<div class="card"><h2>${completeTitle}</h2><p>${completeMsg}</p></div>`;
        setTimeout(() => window.close(), 3000);
        return;
    }

    const wordData = currentReviewWords[currentWordIndex];

    // Get quiz settings
    chrome.storage.local.get(['quizTranslation', 'quizTranscription'], (settings) => {
        const enabledModes = [];
        if (settings.quizTranslation !== false) enabledModes.push('translation');
        if (settings.quizTranscription !== false) enabledModes.push('transcription');

        // Default to both if none saved
        if (enabledModes.length === 0) {
            enabledModes.push('translation', 'transcription');
        }

        const mode = enabledModes[Math.floor(Math.random() * enabledModes.length)];

        showQuiz(wordData, mode);
    });
}

function showQuiz(wordData, mode) {
    document.getElementById('q-word').textContent = wordData.word;
    const optionsContainer = document.getElementById('options-area');
    const speechArea = document.getElementById('speech-area');

    optionsContainer.innerHTML = '';
    speechArea.classList.add('hidden');
    optionsContainer.classList.remove('hidden');

    if (mode === 'translation') {
        // TRANSLATION QUIZ
        console.log('[Quiz] Translation:', wordData.word);
        let options = [{ text: wordData.translation, correct: true }];

        if (wordData.distractors && Array.isArray(wordData.distractors)) {
            wordData.distractors.slice(0, 3).forEach(d => options.push({ text: d, correct: false }));
        } else {
            options.push(
                { text: 'Option A', correct: false },
                { text: 'Option B', correct: false },
                { text: 'Option C', correct: false }
            );
        }

        options = options.sort(() => Math.random() - 0.5);

        options.forEach(opt => {
            const btn = document.createElement('div');
            btn.className = 'option-btn';
            btn.textContent = opt.text;
            btn.onclick = () => handleAnswer(opt.correct, btn);
            optionsContainer.appendChild(btn);
        });
    } else {
        // TRANSCRIPTION QUIZ
        console.log('[Quiz] Transcription:', wordData.word);
        let options = [{ text: wordData.transcription || '[no transcription]', correct: true }];

        if (wordData.transcription_distractors && Array.isArray(wordData.transcription_distractors)) {
            wordData.transcription_distractors.slice(0, 3).forEach(d => options.push({ text: d, correct: false }));
        } else {
            options.push(
                { text: '/ˈɒpʃən eɪ/', correct: false },
                { text: '/ˈɒpʃən biː/', correct: false },
                { text: '/ˈɒpʃən siː/', correct: false }
            );
        }

        options = options.sort(() => Math.random() - 0.5);

        options.forEach(opt => {
            const btn = document.createElement('div');
            btn.className = 'option-btn';
            btn.textContent = opt.text;
            btn.onclick = () => handleAnswer(opt.correct, btn);
            optionsContainer.appendChild(btn);
        });
    }
}

async function handleAnswer(isCorrect, element = null) {
    if (element) element.classList.add(isCorrect ? 'correct' : 'wrong');

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
