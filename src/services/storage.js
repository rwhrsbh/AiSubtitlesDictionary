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
        return result.categories || ['default'];
    }

    async addCategory(categoryName) {
        const categories = await this.getCategories();
        if (!categories.includes(categoryName)) {
            categories.push(categoryName);
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

    async getWordsByCategory(category) {
        const list = await this.getLearningList();
        return list.filter(w => w.category === category || (!w.category && category === 'default'));
    }

    async getWordsToReview() {
        const result = await chrome.storage.local.get('learningList');
        const list = result.learningList || [];
        const now = Date.now();
        return list.filter(w => w.nextReview <= now);
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
        return list.filter(w => (w.wrongCount || 0) > 0);
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
