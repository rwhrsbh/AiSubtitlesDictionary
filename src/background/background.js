import { GeminiService } from '../services/gemini.js';
import { StorageService } from '../services/storage.js';

// Initialize services
const gemini = new GeminiService();
const storage = new StorageService();

chrome.runtime.onInstalled.addListener(() => {
    console.log('AI Subtitles Extension Installed');
    // Setup alarms for learning
    chrome.alarms.create('learningReminder', { periodInMinutes: 60 }); // Check every hour
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'learningReminder') {
        const words = await storage.getWordsToReview();
        if (words.length > 0) {
            chrome.notifications.create('review_notification', {
                type: 'basic',
                iconUrl: '../assets/icon128.png',
                title: 'Time to Review!',
                message: `You have ${words.length} words to review. Click to practice!`,
                priority: 2
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

async function handleExplainWord(word) {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        const model = result.geminiModel || 'gemini-2.5-flash';
        const explanation = await gemini.explainWord(word, apiKey, model);
        return { success: true, data: explanation };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}
