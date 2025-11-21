export class GeminiService {
    constructor() {
        this.modelsCache = null;
        this.cacheTimestamp = 0;
        this.CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
    }

    async explainWord(word, apiKey, model = 'gemini-2.0-flash', language = 'ru') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const languageNames = {
            en: 'English',
            ru: 'Russian',
            uk: 'Ukrainian'
        };

        const targetLang = languageNames[language] || 'Russian';

        const prompt = `
        Explain the word "${word}". 
        Provide the response in JSON format with the following fields:
        - translation: The translation in ${targetLang} (or English if the word is ${targetLang}).
        - transcription: The phonetic transcription (IPA format).
        - explanation: A brief explanation of the meaning in the target language (${targetLang}).
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

    async generateFlashcards(words, historyWords, apiKey, model = 'gemini-2.0-flash', language = 'ru') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const languageNames = {
            en: 'English',
            ru: 'Russian',
            uk: 'Ukrainian'
        };
        const targetLang = languageNames[language] || 'Russian';

        // Combine all words for context
        const allWords = [...words, ...historyWords];

        // Shuffle the words array to get random order
        const shuffledWords = allWords.sort(() => Math.random() - 0.5);
        const wordList = shuffledWords.map(w => w.word).join(', ');

        const prompt = `
    Create fill-in-the-blank flashcard exercises for EACH of the following words: ${wordList}

    For each exercise, create:
    1. An English sentence with ONE word replaced by _____ (blank)
        2. The same sentence in ${targetLang} with the SAME word replaced by _____ (blank)
        3. The correct missing word
        4. Three incorrect but plausible options (distractors) in ENGLISH
        5. Three incorrect but plausible options (distractors) in ${targetLang}
        6. A subtle hint in ENGLISH (1-2 sentences) that helps without giving away the answer
        7. A subtle hint in ${targetLang} (1-2 sentences) that helps without giving away the answer
        8. A full explanation in ENGLISH of why the correct answer fits and why other options don't work in this context
        9. A full explanation in ${targetLang} of why the correct answer fits and why other options don't work in this context

        Requirements:
        - Use different words for each exercise
        - Sentences should be natural and practical
        - Both versions should have the blank in the corresponding position
        - Make sentences interesting and memorable
        - Distractors should be similar in meaning or context but clearly wrong
        - Hints should guide thinking without revealing the answer (one in English, one in ${targetLang})
        - Explanations should teach the word usage and explain why each distractor is incorrect in this specific context (one in English, one in ${targetLang})

        CRITICAL VALIDATION RULES FOR ${targetLang.toUpperCase()} TRANSLATIONS:
        - The ${targetLang} translation of the correct English word MUST be the ONLY logically and semantically correct answer for the ${targetLang} sentence
        - Double-check that NONE of the ${targetLang} distractors would make semantic sense in the ${targetLang} sentence context
        - ${targetLang} distractors must be grammatically plausible but contextually and semantically wrong
        - Ensure the ${targetLang} sentence context strongly favors ONLY the correct answer
        - Example of BAD options: "The artist is known for _____ masterpieces" with options including "copying" as correct - this is WRONG because "destroying" might also make sense. The sentence must be written so only ONE answer is logically correct.
        - After generating ${targetLang} options, re-read the ${targetLang} sentence with EACH option to verify only the correct one makes logical sense

        Return ONLY a JSON array with this structure (NOTE: use 'ru' keys for ${targetLang} content):
        [
          {
            "en": "I love to ___ movies on weekends",
            "ru": "Я люблю ___ фильмы по выходным", // ${targetLang} translation
            "word": "watch",
            "options_en": ["watch", "read", "listen", "play"],
            "options_ru": ["смотреть", "читать", "слушать", "играть"], // ${targetLang} options
            "correct_answer_en": "watch",
            "correct_answer_ru": "смотреть", // ${targetLang} correct answer
            "hint_en": "Think about what you do with your eyes when enjoying visual content.",
            "hint_ru": "Подумайте, что вы делаете глазами, когда наслаждаетесь визуальным контентом.", // ${targetLang} hint
            "explanation_en": "The correct answer is 'watch' because...",
            "explanation_ru": "Правильный ответ - 'смотреть', потому что..." // ${targetLang} explanation
          },
          ...
        ]

        IMPORTANT:
        - In options arrays, the correct answer must be included and shuffled randomly among the wrong answers
        - The ${targetLang} options must correspond exactly by index to the English options (if English option 1 is "watch", ${targetLang} option 1 must be the translation of "watch")
        - You MUST include "correct_answer_en" and "correct_answer_ru" fields that contain the exact correct answer text (word or phrase) that should fill the blank
        - The correct_answer_en and correct_answer_ru must EXACTLY match one of the options in their respective options arrays
        - Validate that in the ${targetLang} sentence, ONLY the correct ${targetLang} option makes complete logical and semantic sense

        Return ONLY the JSON array, no explanations.
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

    async generateDefinitionCards(words, apiKey, model = 'gemini-2.0-flash', language = 'ru') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const languageNames = {
            en: 'English',
            ru: 'Russian',
            uk: 'Ukrainian'
        };
        const targetLang = languageNames[language] || 'Russian';

        // Shuffle the words array to get random order
        const shuffledWords = words.sort(() => Math.random() - 0.5);
        const wordList = shuffledWords.map(w => w.word).join(', ');

        const prompt = `
        Create BILINGUAL definition cards (English and ${targetLang}) for these words: ${wordList}

        For each word, provide:
        1. The word itself (in English)
        2. ${targetLang} translation of the word
        3. Phonetic transcription (IPA format)
        4. Multiple definitions IN BOTH LANGUAGES (if the word has different meanings)
        5. For each definition:
           - A clear explanation of the meaning IN ENGLISH
           - A clear explanation of the meaning IN ${targetLang.toUpperCase()}
           - 1-2 example sentences IN ENGLISH where the word is replaced with "____"
           - 1-2 example sentences IN ${targetLang.toUpperCase()} where the word is replaced with "____"
           - For VERBS: if the verb commonly requires a preposition, include examples showing different prepositions
        
        SPECIAL RULES FOR VERBS:
        - If a verb ALWAYS uses the same preposition (e.g., "depend on"), show ONE example with that preposition
        - If a verb can use DIFFERENT prepositions with different meanings (e.g., "argue with someone" vs "argue against something"), show MULTIPLE examples demonstrating each usage
        - If a verb doesn't require a preposition (e.g., "deny"), just show regular examples
        - Mark the preposition used in each example

        Return ONLY a JSON array with this structure (NOTE: use 'ru' keys for ${targetLang} content):
        [
          {
            "word": "deny",
            "word_ru": "отрицать, отказывать", // ${targetLang} translation
            "transcription": "/dɪˈnaɪ/",
            "definitions": [
              {
                "meaning_en": "to not allow someone to have or do something",
                "meaning_ru": "не разрешать кому-либо иметь или делать что-либо", // ${targetLang} meaning
                "examples_en": [
                  {
                    "text": "They ____ food to the prisoners.",
                    "preposition": null
                  }
                ],
                "examples_ru": [
                  {
                    "text": "Они ____ еду заключенным.", // ${targetLang} example
                    "preposition": null
                  }
                ]
              },
              {
                "meaning_en": "to say that something is not true",
                "meaning_ru": "утверждать, что что-то неправда", // ${targetLang} meaning
                "examples_en": [
                  {
                    "text": "She ____ any involvement in the attack.",
                    "preposition": null
                  }
                ],
                "examples_ru": [
                  {
                    "text": "Она ____ какое-либо участие в нападении.", // ${targetLang} example
                    "preposition": null
                  }
                ]
              }
            ]
          },
          {
            "word": "argue",
            "word_ru": "спорить, доказывать", // ${targetLang} translation
            "transcription": "/ˈɑːɡjuː/",
            "definitions": [
              {
                "meaning_en": "to disagree or have a dispute",
                "meaning_ru": "не соглашаться или иметь спор", // ${targetLang} meaning
                "examples_en": [
                  {
                    "text": "She ____ with him about politics.",
                    "preposition": "with"
                  },
                  {
                    "text": "They ____ against the new policy.",
                    "preposition": "against"
                  }
                ],
                "examples_ru": [
                  {
                    "text": "Она ____ с ним о политике.", // ${targetLang} example
                    "preposition": "с" // ${targetLang} preposition
                  },
                  {
                    "text": "Они ____ против новой политики.", // ${targetLang} example
                    "preposition": "против" // ${targetLang} preposition
                  }
                ]
              }
            ]
          }
        ]

        IMPORTANT:
        - Include all words from the list
        - Examples should be natural and practical IN BOTH LANGUAGES
        - Replace the word with ____ in examples in BOTH languages
        - ${targetLang} examples should be natural translations, not word-for-word
        - For verbs with multiple preposition usages, show different examples in both languages
        - The "preposition" field should be the preposition used in that language (or null if none)

        Return ONLY the JSON array, no explanations.
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
}
