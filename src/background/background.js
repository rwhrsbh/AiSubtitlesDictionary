import { GeminiService } from '../services/gemini.js';
import { StorageService } from '../services/storage.js';
import { I18nService } from '../services/i18n.js';

// Initialize services
const gemini = new GeminiService();
const storage = new StorageService();
const i18n = new I18nService();

chrome.runtime.onInstalled.addListener(() => {
    console.log('AI Subtitles Extension Installed');
    // Setup alarms for learning
    chrome.alarms.create('learningReminder', { periodInMinutes: 60 }); // Check every hour
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'learningReminder') {
        const words = await storage.getWordsToReview();
        if (words.length > 0) {
            await i18n.init(); // Ensure correct language is loaded
            chrome.notifications.create('review_notification', {
                type: 'basic',
                iconUrl: chrome.runtime.getURL('src/assets/icon.png'),
                title: i18n.getMessage('notification_review_title'),
                message: i18n.getMessage('notification_review_message').replace('%n', words.length),
                priority: 1,
                requireInteraction: true,
                silent: false,
            });
        }
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === 'review_notification') {
        chrome.action.openPopup();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXPLAIN_WORD') {
        handleExplainWord(message.word).then(sendResponse);
        return true; // Async response
    }
    if (message.type === 'ADD_TO_LEARN') {
        storage.saveWord(message.data).then(() => sendResponse({ success: true }));
        return true;
    }
    if (message.type === 'GET_REVIEW_WORDS') {
        storage.getWordsToReview().then(words => sendResponse({ words }));
        return true;
    }
    if (message.type === 'UPDATE_WORD_STATS') {
        storage.updateWordStats(message.wordId, message.success).then(() => sendResponse({ success: true }));
        return true;
    }
    if (message.type === 'GET_MODELS') {
        handleGetModels().then(sendResponse);
        return true;
    }
    if (message.type === 'GENERATE_FLASHCARDS') {
        handleGenerateFlashcards().then(sendResponse);
        return true;
    }
    if (message.type === 'GENERATE_CONTEXT_CARDS') {
        handleGenerateContextCards().then(sendResponse);
        return true;
    }
    if (message.type === 'UPDATE_FLASHCARD_STATS') {
        handleUpdateFlashcardStats(message.word, message.success).then(sendResponse);
        return true;
    }
    if (message.type === 'GENERATE_DEFINITION_CARDS') {
        handleGenerateDefinitionCards().then(sendResponse);
        return true;
    }
});

async function handleGetModels() {
    try {
        const apiKey = await storage.getApiKey();
        if (!apiKey) return { success: false, error: 'API Key not set' };

        const models = await gemini.fetchModels(apiKey);
        return { success: true, models };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function getDefaultLanguage() {
    const uiLang = chrome.i18n.getUILanguage();
    if (uiLang.startsWith('ru')) return 'ru';
    if (uiLang.startsWith('uk')) return 'uk';
    return 'en';
}

async function handleExplainWord(word) {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'appLanguage']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();
        const explanation = await gemini.explainWord(word, apiKey, model, language);
        return { success: true, data: explanation };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function handleGenerateFlashcards() {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'flashcardsIncludeHistory', 'appLanguage', 'flashcardsWordsLimit']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        // Get learning words and history
        const learningWords = await storage.getLearningList();
        const includeHistory = result.flashcardsIncludeHistory !== false;
        const historyResult = includeHistory ? await chrome.storage.local.get(['wordHistory']) : { wordHistory: [] };
        const historyWords = historyResult.wordHistory || [];

        let allWords = [...learningWords, ...historyWords];

        if (allWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first!' };
        }

        allWords = shuffleArray(allWords);
        const wordsLimit = result.flashcardsWordsLimit || 25;
        const limitedWords = allWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();

        // Generate simple flashcards (word + translation + distractors)
        const flashcards = await gemini.generateSimpleFlashcards(limitedWords, apiKey, model, language);

        return { success: true, data: flashcards, targetLanguage: language };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function handleGenerateContextCards() {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'flashcardsIncludeHistory', 'appLanguage', 'flashcardsWordsLimit', 'flashcardsExercisesLimit']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        const learningWords = await storage.getLearningList();
        const includeHistory = result.flashcardsIncludeHistory !== false;
        const historyResult = includeHistory ? await chrome.storage.local.get(['wordHistory']) : { wordHistory: [] };
        const historyWords = historyResult.wordHistory || [];

        let allWords = [...learningWords, ...historyWords];

        if (allWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first!' };
        }

        allWords = shuffleArray(allWords);
        const wordsLimit = result.flashcardsWordsLimit || 25;
        const exercisesLimit = result.flashcardsExercisesLimit || 25;
        const limitedWords = allWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();

        let flashcards = await gemini.generateFlashcards(limitedWords, [], apiKey, model, language);

        if (flashcards && flashcards.length > exercisesLimit) {
            flashcards = shuffleArray(flashcards).slice(0, exercisesLimit);
        }

        return { success: true, data: flashcards, targetLanguage: language };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function handleUpdateFlashcardStats(word, success) {
    try {
        const list = await storage.getLearningList();
        const updatedList = list.map(w => {
            if (w.word.toLowerCase() === word.toLowerCase()) {
                if (success) {
                    w.correctCount = (w.correctCount || 0) + 1;
                } else {
                    w.wrongCount = (w.wrongCount || 0) + 1;
                }
            }
            return w;
        });
        await chrome.storage.local.set({ learningList: updatedList });
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function handleGenerateDefinitionCards() {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'appLanguage', 'defCardsWordsLimit']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        // Get learning words
        const learningWords = await storage.getLearningList();

        if (learningWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first!' };
        }

        // Shuffle and limit
        let limitedWords = shuffleArray(learningWords);
        const wordsLimit = result.defCardsWordsLimit || 10;
        limitedWords = limitedWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();
        const cards = await gemini.generateDefinitionCards(limitedWords, apiKey, model, language);
        return { success: true, data: cards, targetLanguage: language };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

