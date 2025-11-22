export class StorageService {
    async getApiKey() {
        const result = await chrome.storage.local.get('apiKey');
        return result.apiKey;
    }

    async setApiKey(key) {
        await chrome.storage.local.set({ apiKey: key });
    }

    async getLearningList() {
        const result = await chrome.storage.local.get('learningList');
        return result.learningList || [];
    }

    async addToLearningList(wordData) {
        return this.saveWord(wordData);
    }

    async saveWord(wordData) {
        const result = await chrome.storage.local.get('learningList');
        const list = result.learningList || [];

        // Avoid duplicates
        if (!list.find(w => w.word === wordData.word)) {
            list.push({
                ...wordData,
                translation: typeof wordData.translation === 'object' ? JSON.stringify(wordData.translation) : String(wordData.translation || ''),
                transcription: typeof wordData.transcription === 'object' ? JSON.stringify(wordData.transcription) : String(wordData.transcription || ''),
                id: Date.now().toString(),
                addedAt: Date.now(),
                nextReview: Date.now(), // Review immediately/soon
                level: 0, // SRS level
                correctCount: 0,
                wrongCount: 0,
                category: wordData.category || 'default' // Add category support
            });
            await chrome.storage.local.set({ learningList: list });
        }
    }

    // Category Management
    async getCategories() {
        const result = await chrome.storage.local.get('categories');
        const categories = result.categories || ['default'];
        // Always deduplicate to prevent UI issues
        return [...new Set(categories)];
    }

    async addCategory(categoryName) {
        let categories = await this.getCategories(); // Already deduplicated
        if (!categories.includes(categoryName)) {
            categories.push(categoryName);
            // Deduplicate again before saving as extra safety
            categories = [...new Set(categories)];
            await chrome.storage.local.set({ categories });
        }
    }

    async deleteCategory(categoryName) {
        if (categoryName === 'default') return; // Cannot delete default

        const categories = await this.getCategories();
        const updated = categories.filter(c => c !== categoryName);
        await chrome.storage.local.set({ categories: updated });

        // Move words from deleted category to 'default'
        const list = await this.getLearningList();
        const updatedList = list.map(w => {
            if (w.category === categoryName) {
                w.category = 'default';
            }
            return w;
        });
        await chrome.storage.local.set({ learningList: updatedList });
    }

    async renameCategory(oldName, newName) {
        if (oldName === 'default') return; // Cannot rename default

        const categories = await this.getCategories();
        const index = categories.indexOf(oldName);
        if (index !== -1) {
            categories[index] = newName;
            await chrome.storage.local.set({ categories });

            // Update words
            const list = await this.getLearningList();
            const updatedList = list.map(w => {
                if (w.category === oldName) {
                    w.category = newName;
                }
                return w;
            });
            await chrome.storage.local.set({ learningList: updatedList });

            // Update active status if exists
            const settings = await this.getCategorySettings();
            if (settings[oldName]) {
                settings[newName] = settings[oldName];
                delete settings[oldName];
                await chrome.storage.local.set({ categorySettings: settings });
            }
        }
    }

    async getCategorySettings() {
        const result = await chrome.storage.local.get('categorySettings');
        return result.categorySettings || {};
    }

    async setCategoryActive(categoryName, isActive) {
        const settings = await this.getCategorySettings();
        settings[categoryName] = { ...settings[categoryName], active: isActive };
        await chrome.storage.local.set({ categorySettings: settings });
    }

    async isCategoryActive(categoryName) {
        const settings = await this.getCategorySettings();
        // Default to true if not set
        return settings[categoryName]?.active !== false;
    }

    async getWordsByCategory(category) {
        const list = await this.getLearningList();
        return list.filter(w => w.category === category || (!w.category && category === 'default'));
    }

    async getWordsToReview() {
        const result = await chrome.storage.local.get('learningList');
        const list = result.learningList || [];
        const now = Date.now();

        // Filter by active categories
        const settings = await this.getCategorySettings();
        const activeList = list.filter(w => {
            const cat = w.category || 'default';
            // Default is active if not explicitly set to false
            return settings[cat]?.active !== false;
        });

        return activeList.filter(w => w.nextReview <= now);
    }

    async updateWordStats(wordId, success) {
        const result = await chrome.storage.local.get('learningList');
        let list = result.learningList || [];

        list = list.map(w => {
            if (w.id === wordId) {
                // Simple SRS logic
                if (success) {
                    w.level += 1;
                    w.correctCount = (w.correctCount || 0) + 1;
                    // Next review: 1min, 10min, 1h, 1d, 3d, 7d...
                    const intervals = [1, 10, 60, 1440, 4320, 10080];
                    const minutes = intervals[Math.min(w.level, intervals.length - 1)];
                    w.nextReview = Date.now() + (minutes * 60 * 1000);
                } else {
                    w.level = Math.max(0, w.level - 1);
                    w.wrongCount = (w.wrongCount || 0) + 1;
                    w.nextReview = Date.now() + (1 * 60 * 1000); // Review in 1 min
                }
            }
            return w;
        });

        await chrome.storage.local.set({ learningList: list });
    }

    async getProblemWords() {
        const list = await this.getLearningList();
        // Also filter problem words by active category? Probably yes.
        const settings = await this.getCategorySettings();
        const activeList = list.filter(w => {
            const cat = w.category || 'default';
            return settings[cat]?.active !== false;
        });
        return activeList.filter(w => (w.wrongCount || 0) > 0);
    }

    async exportData() {
        const data = await chrome.storage.local.get(null);
        // Exclude API keys for security
        const exportObj = { ...data };
        delete exportObj.GEMINI_API_KEY;
        delete exportObj.apiKey;
        return JSON.stringify(exportObj, null, 2);
    }

    async importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            const currentData = await chrome.storage.local.get(null);

            // Merge Learning List
            const currentList = currentData.learningList || [];
            const importedList = (data.learningList || []).filter(w => w && w.word); // Filter invalid items first

            const newWords = importedList.filter(importedWord =>
                !currentList.some(currentWord =>
                    currentWord && currentWord.word &&
                    currentWord.word.toLowerCase() === importedWord.word.toLowerCase()
                )
            );
            const mergedList = [...currentList, ...newWords];

            // Merge History
            const currentHistory = currentData.wordHistory || [];
            const importedHistory = (data.wordHistory || []).filter(w => w && w.word); // Filter invalid items first

            const newHistory = importedHistory.filter(importedWord =>
                !currentHistory.some(currentWord =>
                    currentWord && currentWord.word &&
                    currentWord.word.toLowerCase() === importedWord.word.toLowerCase()
                )
            );
            const mergedHistory = [...currentHistory, ...newHistory];

            // Merge Categories
            const currentCategories = currentData.categories || ['default'];
            const importedCategories = data.categories || [];
            const mergedCategories = [...new Set([...currentCategories, ...importedCategories])];

            // Prepare updates
            const updates = {
                learningList: mergedList,
                wordHistory: mergedHistory,
                categories: mergedCategories,
                // Settings - overwrite if present in import, else keep current
                appLanguage: data.appLanguage || currentData.appLanguage,
                geminiModel: data.geminiModel || currentData.geminiModel,
                flashcardsIncludeHistory: data.flashcardsIncludeHistory !== undefined ? data.flashcardsIncludeHistory : currentData.flashcardsIncludeHistory
            };

            await chrome.storage.local.set(updates);
            return { success: true, addedWords: newWords.length, addedHistory: newHistory.length };
        } catch (e) {
            console.error('Import error:', e);
            return { success: false, error: e.message };
        }
    }
}
