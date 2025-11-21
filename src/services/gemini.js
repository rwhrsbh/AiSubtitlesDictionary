export class GeminiService {
    constructor() {
        this.modelsCache = null;
        this.cacheTimestamp = 0;
        this.CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
    }

    async explainWord(word, apiKey, model = 'gemini-2.0-flash') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const prompt = `
        Explain the word "${word}". 
        Provide the response in JSON format with the following fields:
        - translation: The translation in Russian (or English if the word is Russian).
        - transcription: The phonetic transcription (IPA format).
        - explanation: A brief explanation of the meaning in the target language (Russian if user is Russian).
        - examples: An array of 2 short example sentences.
        - distractors: An array of 3 incorrect translations for a multiple choice quiz.
        - transcription_distractors: An array of 3 incorrect phonetic transcriptions that look plausible but are wrong.
        
        Return ONLY the JSON.
        `;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const text = data.candidates[0].content.parts[0].text;
        // Clean up markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    }
    async fetchModels(apiKey) {
        const now = Date.now();
        if (this.modelsCache && (now - this.cacheTimestamp < this.CACHE_DURATION)) {
            console.log('Returning cached models');
            return this.modelsCache;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);

        // Filter for generateContent models and exclude unwanted types
        const models = data.models
            .filter(m => {
                if (!m.supportedGenerationMethods || !m.supportedGenerationMethods.includes('generateContent')) {
                    return false;
                }
                const name = m.name.toLowerCase();
                return !name.includes('image') &&
                    !name.includes('imagen') &&
                    !name.includes('tts') &&
                    !name.includes('computer-use') &&
                    !name.includes('embedding') &&
                    !name.includes('nano');
            })
            .map(m => ({
                name: m.name.replace('models/', ''),
                displayName: m.displayName
            }));

        this.modelsCache = models;
        this.cacheTimestamp = now;

        return models;
    }
}
