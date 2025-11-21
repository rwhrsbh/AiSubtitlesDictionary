import { translations } from './translations.js';

export class I18nService {
    constructor() {
        this.language = 'en';
    }

    async init() {
        const result = await chrome.storage.local.get('appLanguage');
        if (result.appLanguage) {
            this.language = result.appLanguage;
        } else {
            // Default based on browser language
            const uiLang = chrome.i18n.getUILanguage();
            if (uiLang.startsWith('ru')) this.language = 'ru';
            else if (uiLang.startsWith('uk')) this.language = 'uk';
            else this.language = 'en';
        }
    }

    getMessage(key) {
        const langData = translations[this.language] || translations['en'];
        return langData[key] || translations['en'][key] || key;
    }

    async setLanguage(lang) {
        this.language = lang;
        await chrome.storage.local.set({ appLanguage: lang });
    }
}
