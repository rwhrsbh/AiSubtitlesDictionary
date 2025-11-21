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
                wrongCount: 0
            });
            await chrome.storage.local.set({ learningList: list });
        }
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
}
