import { translations } from '../services/translations.js';

window.AiSubtitlesI18n = {
    language: 'en',

    async init() {
        // Check if chrome.storage is available (it might not be in content scripts at load time)
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const result = await chrome.storage.local.get('appLanguage');
                if (result.appLanguage) {
                    this.language = result.appLanguage;
                } else {
                    const uiLang = chrome.i18n.getUILanguage();
                    if (uiLang.startsWith('ru')) this.language = 'ru';
                    else if (uiLang.startsWith('uk')) this.language = 'uk';
                    else this.language = 'en';
                }
            } catch (error) {
                console.warn('Failed to load app language from storage:', error);
                // Fallback to browser language
                if (typeof chrome !== 'undefined' && chrome.i18n) {
                    const uiLang = chrome.i18n.getUILanguage();
                    if (uiLang.startsWith('ru')) this.language = 'ru';
                    else if (uiLang.startsWith('uk')) this.language = 'uk';
                    else this.language = 'en';
                }
            }
        } else {
            // Fallback: detect language from navigator
            const browserLang = navigator.language || navigator.userLanguage;
            if (browserLang.startsWith('ru')) this.language = 'ru';
            else if (browserLang.startsWith('uk')) this.language = 'uk';
            else this.language = 'en';
        }
    },

    getMessage(key) {
        const langData = translations[this.language] || translations['en'];
        return langData[key] || translations['en'][key] || key;
    }
};
