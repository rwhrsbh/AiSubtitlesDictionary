import { GeminiService } from '../services/gemini.js';
import { StorageService } from '../services/storage.js';
import { I18nService } from '../services/i18n.js';
import { TTSService } from '../services/tts.js';

// Initialize services
const gemini = new GeminiService();
const storage = new StorageService();
const i18n = new I18nService();
const tts = new TTSService();

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
        handleExplainWord(message.word, message.overrideLanguage).then(sendResponse);
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
    // TTS handlers
    if (message.type === 'GENERATE_TTS') {
        handleGenerateTTS(message.wordId, message.word).then(sendResponse);
        return true;
    }
    if (message.type === 'GENERATE_HISTORY_TTS') {
        handleGenerateHistoryTTS(message.word).then(sendResponse);
        return true;
    }
    if (message.type === 'GENERATE_TTS_FOR_WORD_DATA') {
        handleGenerateTTSForWordData(message.wordData).then(sendResponse);
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

async function handleExplainWord(word, overrideLanguage = null) {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'appLanguage']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();
        const explanation = await gemini.explainWord(word, apiKey, model, language, overrideLanguage);
        return { success: true, data: explanation };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

async function handleGenerateFlashcards() {
    try {
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'flashcardsIncludeHistory', 'appLanguage', 'simpleFlashcardsWordsLimit', 'simpleFlashcardsExercisesLimit']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        // Get all learning words
        let learningWords = await storage.getLearningList();

        // Filter by active categories
        const categorySettings = await storage.getCategorySettings();
        learningWords = learningWords.filter(word => {
            const category = word.category || 'default';
            // Include word if category is active (default to true if not set)
            return categorySettings[category]?.active !== false;
        });

        // Include history if enabled
        const includeHistory = result.flashcardsIncludeHistory !== false;
        let historyWords = [];
        if (includeHistory) {
            const historyResult = await chrome.storage.local.get(['wordHistory']);
            historyWords = (historyResult.wordHistory || []).map(word => ({
                ...word,
                category: 'History' // Mark as History
            }));
            // Filter history by active categories too
            historyWords = historyWords.filter(word => {
                const category = word.category || 'default';
                return categorySettings[category]?.active !== false;
            });
        }

        let allWords = [...learningWords, ...historyWords];

        // Remove duplicates - prioritize learning list
        const seenWords = new Set();
        allWords = allWords.filter(word => {
            const key = word.word.toLowerCase();
            if (seenWords.has(key)) {
                return false;
            }
            seenWords.add(key);
            return true;
        });

        if (allWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first or enable categories in the word list!' };
        }

        allWords = shuffleArray(allWords);
        const wordsLimit = result.simpleFlashcardsWordsLimit || 25;
        const exercisesLimit = result.simpleFlashcardsExercisesLimit || 25;
        const limitedWords = allWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();

        // Generate simple flashcards (word + translation + distractors)
        let flashcards = await gemini.generateSimpleFlashcards(limitedWords, apiKey, model, language);

        // Map categories AND TTS data back to flashcards
        flashcards = flashcards.map(card => {
            const originalWord = limitedWords.find(w => w.word.toLowerCase().trim() === card.word.toLowerCase().trim());

            // Copy TTS data from original word if available
            if (originalWord) {
                return {
                    ...card,
                    category: originalWord.category || 'default',
                    ttsAudio: originalWord.ttsAudio || null,
                    ttsLanguage: originalWord.ttsLanguage || null,
                    ttsDifficulty: originalWord.ttsDifficulty || null,
                    ttsMimeType: originalWord.ttsMimeType || null
                };
            }

            return {
                ...card,
                category: 'default'
            };
        });

        if (flashcards && flashcards.length > exercisesLimit) {
            flashcards = shuffleArray(flashcards).slice(0, exercisesLimit);
        }

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

        let learningWords = await storage.getLearningList();

        const categorySettings = await storage.getCategorySettings();
        learningWords = learningWords.filter(word => {
            const category = word.category || 'default';
            return categorySettings[category]?.active !== false;
        });

        const includeHistory = result.flashcardsIncludeHistory !== false;
        let historyWords = [];
        if (includeHistory) {
            const historyResult = await chrome.storage.local.get(['wordHistory']);
            historyWords = (historyResult.wordHistory || []).map(word => ({
                ...word,
                category: 'History' // Mark as History
            }));

            // Filter history by active categories too
            historyWords = historyWords.filter(word => {
                const category = word.category || 'default';
                return categorySettings[category]?.active !== false;
            });

        }

        let allWords = [...learningWords, ...historyWords];

        // Remove duplicates - prioritize learning list
        const seenWords = new Set();
        allWords = allWords.filter(word => {
            const key = word.word.toLowerCase();
            if (seenWords.has(key)) {
                return false;
            }
            seenWords.add(key);
            return true;
        });

        if (allWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first or enable categories in the word list!' };
        }

        allWords = shuffleArray(allWords);
        const wordsLimit = result.flashcardsWordsLimit || 25;
        const exercisesLimit = result.flashcardsExercisesLimit || 25;
        const limitedWords = allWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();


        const wordsByCategory = {};
        limitedWords.forEach(word => {
            const cat = word.category || 'default';
            if (!wordsByCategory[cat]) wordsByCategory[cat] = [];
            wordsByCategory[cat].push(word.word);
        });

        let flashcards = await gemini.generateFlashcards(limitedWords, [], apiKey, model, language);



        // Map categories AND TTS data back to flashcards
        flashcards = flashcards.map(card => {
            const originalWord = limitedWords.find(w => w.word.toLowerCase().trim() === card.word.toLowerCase().trim());

            // Copy TTS data from original word if available
            if (originalWord) {
                return {
                    ...card,
                    category: originalWord.category || 'default',
                    ttsAudio: originalWord.ttsAudio || null,
                    ttsLanguage: originalWord.ttsLanguage || null,
                    ttsDifficulty: originalWord.ttsDifficulty || null,
                    ttsMimeType: originalWord.ttsMimeType || null
                };
            }

            return {
                ...card,
                category: 'default'
            };
        });

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
        const result = await chrome.storage.local.get(['GEMINI_API_KEY', 'geminiModel', 'flashcardsIncludeHistory', 'appLanguage', 'defCardsWordsLimit', 'defCardsExercisesLimit']);
        const apiKey = result.GEMINI_API_KEY;

        if (!apiKey) {
            return { success: false, error: 'API Key not set. Please configure in extension settings.' };
        }

        // Get learning words
        let learningWords = await storage.getLearningList();

        // Filter by active categories
        const categorySettings = await storage.getCategorySettings();
        learningWords = learningWords.filter(word => {
            const category = word.category || 'default';
            // Include word if category is active (default to true if not set)
            return categorySettings[category]?.active !== false;
        });

        // Include history if enabled
        const includeHistory = result.flashcardsIncludeHistory !== false;
        let historyWords = [];
        if (includeHistory) {
            const historyResult = await chrome.storage.local.get(['wordHistory']);
            historyWords = (historyResult.wordHistory || []).map(word => ({
                ...word,
                category: 'History' // Mark as History
            }));
            // Filter history by active categories too
            historyWords = historyWords.filter(word => {
                const category = word.category || 'default';
                return categorySettings[category]?.active !== false;
            });
        }

        let allWords = [...learningWords, ...historyWords];

        // Remove duplicates - prioritize learning list
        const seenWords = new Set();
        allWords = allWords.filter(word => {
            const key = word.word.toLowerCase();
            if (seenWords.has(key)) {
                return false;
            }
            seenWords.add(key);
            return true;
        });

        if (allWords.length === 0) {
            return { success: false, error: 'No words available. Add some words first or enable categories in the word list!' };
        }

        // Shuffle and limit
        let limitedWords = shuffleArray(allWords);
        const wordsLimit = result.defCardsWordsLimit || 25;
        const exercisesLimit = result.defCardsExercisesLimit || 25;
        limitedWords = limitedWords.slice(0, wordsLimit);

        const model = result.geminiModel || 'gemini-2.0-flash';
        const language = result.appLanguage || getDefaultLanguage();
        let cards = await gemini.generateDefinitionCards(limitedWords, apiKey, model, language);

        // Map categories AND TTS data back to cards
        cards = cards.map(card => {
            const originalWord = limitedWords.find(w => w.word.toLowerCase().trim() === card.word.toLowerCase().trim());

            // Copy TTS data from original word if available
            if (originalWord) {
                return {
                    ...card,
                    category: originalWord.category || 'default',
                    ttsAudio: originalWord.ttsAudio || null,
                    ttsLanguage: originalWord.ttsLanguage || null,
                    ttsDifficulty: originalWord.ttsDifficulty || null,
                    ttsMimeType: originalWord.ttsMimeType || null
                };
            }

            return {
                ...card,
                category: 'default'
            };
        });

        if (cards && cards.length > exercisesLimit) {
            cards = shuffleArray(cards).slice(0, exercisesLimit);
        }

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

// TTS Handler Functions
async function handleGenerateTTS(wordId, word) {
    console.log('[Background] handleGenerateTTS called:', { wordId, word });
    try {
        const settings = await chrome.storage.local.get(['GEMINI_API_KEY', 'ttsEnabled', 'ttsDifficulty']);
        console.log('[Background] TTS Settings:', { ttsEnabled: settings.ttsEnabled, ttsDifficulty: settings.ttsDifficulty, hasApiKey: !!settings.GEMINI_API_KEY });

        // Default to true if not set
        const ttsEnabled = settings.ttsEnabled !== false;

        if (!ttsEnabled) {
            console.warn('[Background] TTS is disabled in settings');
            return { success: false, error: 'TTS is disabled in settings' };
        }

        const apiKey = settings.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[Background] API Key not set');
            return { success: false, error: 'API Key not set' };
        }

        // Get word data to find language
        const learningList = await storage.getLearningList();
        const wordData = learningList.find(w => w.id === wordId);

        if (!wordData) {
            console.error('[Background] Word not found:', wordId);
            return { success: false, error: 'Word not found' };
        }

        console.log('[Background] Word data:', { word: wordData.word, language: wordData.word_language });

        const languageCode = getLanguageCode(wordData.word_language);
        const difficulty = settings.ttsDifficulty || 'B2';
        const voiceModel = settings.ttsVoice || 'Zephyr';

        console.log('[Background] Calling TTS service with:', { word, languageCode, difficulty, voiceModel });

        // Generate TTS
        const ttsResult = await tts.generateSpeech(word, languageCode, apiKey, difficulty, voiceModel);

        console.log('[Background] TTS generated, saving to storage');

        // Save to storage
        await storage.updateWordTTS(wordId, ttsResult.audio, languageCode, difficulty, ttsResult.mimeType);

        console.log('[Background] TTS saved successfully');
        return { success: true };
    } catch (error) {
        console.error('[Background] TTS Generation error:', error);
        return { success: false, error: error.message };
    }
}

async function handleGenerateHistoryTTS(word) {
    try {
        const settings = await chrome.storage.local.get(['GEMINI_API_KEY', 'ttsEnabled', 'ttsDifficulty']);

        if (!settings.ttsEnabled) {
            return { success: false, error: 'TTS is disabled in settings' };
        }

        const apiKey = settings.GEMINI_API_KEY;
        if (!apiKey) {
            return { success: false, error: 'API Key not set' };
        }

        // Get word data from history
        const result = await chrome.storage.local.get('wordHistory');
        const history = result.wordHistory || [];
        const wordData = history.find(w => w.word === word);

        if (!wordData) {
            return { success: false, error: 'Word not found in history' };
        }

        const languageCode = getLanguageCode(wordData.word_language);
        const difficulty = settings.ttsDifficulty || 'B2';
        const voiceModel = settings.ttsVoice || 'Zephyr';

        // Generate TTS
        const ttsResult = await tts.generateSpeech(word, languageCode, apiKey, difficulty, voiceModel);

        // Save to storage
        await storage.updateHistoryTTS(word, ttsResult.audio, languageCode, difficulty, ttsResult.mimeType);

        return { success: true };
    } catch (error) {
        console.error('[TTS] History generation error:', error);
        return { success: false, error: error.message };
    }
}

// Generate TTS for word data (used when adding new words)
async function handleGenerateTTSForWordData(wordData) {
    console.log('[Background] handleGenerateTTSForWordData called:', wordData);
    try {
        const settings = await chrome.storage.local.get(['GEMINI_API_KEY', 'ttsEnabled', 'ttsAutoGenerate', 'ttsDifficulty']);
        console.log('[Background] Auto-gen settings:', { ttsEnabled: settings.ttsEnabled, ttsAutoGenerate: settings.ttsAutoGenerate, ttsDifficulty: settings.ttsDifficulty });

        // Default to true if not set (undefined means not configured yet, so enable by default)
        const ttsEnabled = settings.ttsEnabled !== false;
        const ttsAutoGenerate = settings.ttsAutoGenerate !== false;

        console.log('[Background] Effective settings:', { ttsEnabled, ttsAutoGenerate });

        if (!ttsEnabled || !ttsAutoGenerate) {
            console.log('[Background] TTS auto-generation is disabled');
            return { success: false, audio: null };
        }

        const apiKey = settings.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[Background] API Key not set for auto-gen');
            return { success: false, audio: null };
        }

        const languageCode = getLanguageCode(wordData.word_language);
        const difficulty = settings.ttsDifficulty || 'B2';
        const voiceModel = settings.ttsVoice || 'Zephyr';

        console.log('[Background] Generating TTS for:', { word: wordData.word, languageCode, difficulty, voiceModel });

        // Generate TTS
        const ttsResult = await tts.generateSpeech(wordData.word, languageCode, apiKey, difficulty, voiceModel);

        console.log('[Background] TTS auto-generated successfully');
        return { success: true, audio: ttsResult.audio, mimeType: ttsResult.mimeType, language: languageCode, difficulty: difficulty };
    } catch (error) {
        console.error('[Background] TTS Auto-generation error:', error);
        return { success: false, audio: null };
    }
}

// Helper function to convert language name to code
function getLanguageCode(languageName) {
    const languageMap = {
        'English': 'en',
        'Russian': 'ru',
        'Ukrainian': 'uk',
        'Spanish': 'es',
        'French': 'fr',
        'German': 'de',
        'Italian': 'it',
        'Portuguese': 'pt',
        'Chinese': 'zh',
        'Japanese': 'ja',
        'Korean': 'ko',
        'Arabic': 'ar'
    };

    return languageMap[languageName] || 'en';
}

