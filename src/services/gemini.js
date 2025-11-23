export class GeminiService {
    constructor() {
        this.modelsCache = null;
        this.cacheTimestamp = 0;
        this.CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
    }

    async explainWord(word, apiKey, model = 'gemini-2.0-flash', language = 'ru', overrideLanguage = null) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const languageNames = {
            en: 'English',
            ru: 'Russian',
            uk: 'Ukrainian'
        };

        const userInterfaceLang = languageNames[language] || 'Russian';

        let prompt;
        if (overrideLanguage) {
            // User specified the language - don't detect, use the specified one
            prompt = `
            The word "${word}" is in ${overrideLanguage}.

            ALWAYS provide translations in ALL languages as an object.

            Provide the response in JSON format with the following fields:
            - word_language: "${overrideLanguage}" (use exactly this value)
            - translation: ALWAYS an object with ALL translation variants: {"english": "translation to English", "russian": "translation to Russian", "ukrainian": "translation to Ukrainian"}. Include all three keys even if some languages match the original word.
            - transcription: The phonetic transcription (IPA format) of the ORIGINAL word "${word}"
            - explanation: A brief explanation of the meaning in ${userInterfaceLang}
            - examples: An array of 2 short example sentences using the ORIGINAL word "${word}"
            - distractors_en: An array of 3 incorrect translations in English
            - distractors_ru: An array of 3 incorrect translations in Russian
            - distractors_uk: An array of 3 incorrect translations in Ukrainian
            - distractors_original: An array of 3 words in the ORIGINAL language (${overrideLanguage}) that look/sound similar to "${word}" or are semantically related but wrong (for reverse translation quiz)
            - transcription_distractors: An array of 3 incorrect phonetic transcriptions that look plausible but are wrong

            Return ONLY the JSON.
            `;
        } else {
            // Auto-detect language
            prompt = `
            IMPORTANT: First, detect what language the word "${word}" is in.

            ALWAYS provide translations in ALL languages as an object.

            Provide the response in JSON format with the following fields:
            - word_language: The detected language of the input word (e.g., "English", "Russian", "Ukrainian", "Spanish", etc.)
            - translation: ALWAYS an object with ALL translation variants: {"english": "translation to English", "russian": "translation to Russian", "ukrainian": "translation to Ukrainian"}. Include all three keys even if some languages match the original word.
            - transcription: The phonetic transcription (IPA format) of the ORIGINAL word "${word}"
            - explanation: A brief explanation of the meaning in ${userInterfaceLang}
            - examples: An array of 2 short example sentences using the ORIGINAL word "${word}"
            - distractors_en: An array of 3 incorrect translations in English
            - distractors_ru: An array of 3 incorrect translations in Russian
            - distractors_uk: An array of 3 incorrect translations in Ukrainian
            - distractors_original: An array of 3 words in the ORIGINAL language that look/sound similar to "${word}" or are semantically related but wrong (for reverse translation quiz)
            - transcription_distractors: An array of 3 incorrect phonetic transcriptions that look plausible but are wrong

            Return ONLY the JSON.
            `;
        }

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
        const result = JSON.parse(jsonStr);

        // Backward compatibility: map current UI lang distractors to 'distractors' field
        const uiLangCode = language === 'uk' ? 'uk' : (language === 'ru' ? 'ru' : 'en');
        result.distractors = result[`distractors_${uiLangCode}`] || result.distractors_en || [];

        return result;
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

    CRITICAL LANGUAGE DETECTION: For EACH word, you MUST first detect what language it is in (English, Russian, Ukrainian, Spanish, German, French, Japanese, ANY language):
    - Detect the ORIGINAL language of the word
    - Determine the TARGET language for UI (${targetLang})
    - If word is in ${targetLang}, then TARGET language should be English instead

    IMPORTANT: Do NOT assume all words are English. Each word could be in ANY language!

    For each exercise, create:
    1. Detected language of the word (word_language field - e.g., "English", "Russian", "German", etc.)
    2. A sentence in the word's ORIGINAL language with the word replaced by _____
    3. A sentence in the TARGET/OPPOSITE language with translation replaced by _____
    4. The correct missing word in its ORIGINAL language
    5. Three distractors in the word's ORIGINAL language - plausible but wrong
    6. Three distractors in the TARGET language - translations of the original distractors
    7. A subtle hint in the ORIGINAL language
    8. A subtle hint in the TARGET language
    9. Explanation in ORIGINAL language
    10. Explanation in TARGET language

    Requirements:
    - Use different words for each exercise
    - Sentences should be natural and practical IN THEIR RESPECTIVE LANGUAGES
    - Both versions should have the blank in corresponding position
    - Make sentences interesting and memorable
    - Distractors should be in the same language as the word they're meant to replace
    - Hints should guide thinking without revealing the answer
    - Explanations should teach the word usage

        CRITICAL VALIDATION RULES FOR TARGET LANGUAGE TRANSLATIONS:
        - The TARGET language translation of the correct word MUST be the ONLY logically and semantically correct answer for the TARGET language sentence
        - Double-check that NONE of the TARGET language distractors would make semantic sense in the TARGET language sentence context
        - TARGET language distractors must be grammatically plausible but contextually and semantically wrong
        - Ensure the TARGET language sentence context strongly favors ONLY the correct answer
        - Example of BAD options: "The artist is known for _____ masterpieces" with options including "copying" as correct - this is WRONG because "destroying" might also make sense. The sentence must be written so only ONE answer is logically correct.
        - After generating TARGET language options, re-read the TARGET language sentence with EACH option to verify only the correct one makes logical sense

        Return ONLY a JSON array with this structure:
        [
          {
            "word_language": "English",
            "en": "I love to ___ movies on weekends",
            "ru": "Я люблю ___ фильмы по выходным",
            "word": "watch",
            "options_en": ["watch", "read", "listen", "play"],
            "options_ru": ["смотреть", "читать", "слушать", "играть"],
            "correct_answer_en": "watch",
            "correct_answer_ru": "смотреть",
            "hint_en": "Think about what you do with your eyes when enjoying visual content.",
            "hint_ru": "Подумайте, что вы делаете глазами, когда наслаждаетесь визуальным контентом.",
            "explanation_en": "The correct answer is 'watch' because...",
            "explanation_ru": "Правильный ответ - 'смотреть', потому что..."
          },
          ...
        ]

        IMPORTANT:
        - You MUST include "word_language" field indicating the detected language of the word
        - In options arrays, the correct answer must be included and shuffled randomly among the wrong answers
        - The TARGET language options must correspond exactly by index to the ORIGINAL language options
        - You MUST include "correct_answer_en" and "correct_answer_ru" fields that contain the exact correct answer text (word or phrase) that should fill the blank
        - The correct answers must EXACTLY match one of the options in their respective options arrays
        - Validate that in the TARGET language sentence, ONLY the correct TARGET language option makes complete logical and semantic sense

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
        let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        // Fix unquoted transcriptions
        jsonStr = jsonStr.replace(/"transcription"\s*:\s*\/([^\/]+)\//g, '"transcription": "/$1/"');
        return JSON.parse(jsonStr);
    }

    async generateSimpleFlashcards(words, apiKey, model = 'gemini-2.0-flash', language = 'ru') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const languageNames = {
            en: 'English',
            ru: 'Russian',
            uk: 'Ukrainian'
        };
        const targetLang = languageNames[language] || 'Russian';

        const shuffledWords = words.sort(() => Math.random() - 0.5);
        const wordList = shuffledWords.map(w => w.word).join(', ');

        const prompt = `
    Create simple translation flashcards for these words: ${wordList}

    CRITICAL: For EACH word, you MUST:
    1. FIRST detect what language the word is in (English, Russian, Ukrainian, Spanish, French, German, etc.)
    2. Generate content based on the detected language:
       - If word is in ENGLISH → translation should be in ${targetLang}, distractors_en should be English synonyms/related words
       - If word is in ${targetLang} → translation should be in English, distractors_ru should be ${targetLang} synonyms/related words  
       - If word is in ANY OTHER language → translation should be in ${targetLang}, distractors_en should be in the SAME language as the word

    For each word, provide:
    1. The word itself (in its ORIGINAL language - could be ANY language, not just English!)
    2. Translation to ${targetLang} (if word is English/other) OR to English (if word is ${targetLang})
    3. Phonetic transcription (IPA format) of the word in its ORIGINAL language
    4. One natural example sentence using the word (in the word's ORIGINAL language)
    5. Three distractors in the word's ORIGINAL language (distractors_en) - synonyms or related words
    6. Three distractors in the OPPOSITE language (distractors_ru) - translations of the original language distractors

    IMPORTANT RULES:
    - distractors_en should ALWAYS be in the SAME language as the original word (e.g., if word is "привет" in Russian, distractors_en should be Russian words like "пока", "здравствуй", "до свидания")
    - distractors_ru should be ${targetLang} translations of the distractors_en
    - The field names stay "distractors_en" and "distractors_ru" regardless of the actual word language (this is just for backwards compatibility)

    Return ONLY a JSON array with this structure:
    [
      {
        "word_language": "English",
        "word": "adventure",
        "translation": "приключение",
        "transcription": "/ədˈventʃər/",
        "example": "We risked losing a lot of money in this adventure.",
        "distractors_en": ["experience", "journey", "challenge"],
        "distractors_ru": ["опыт", "путешествие", "вызов"]
      },
      {
        "word_language": "Russian",
        "word": "привет",
        "translation": "hello",
        "transcription": "/prʲɪˈvʲet/",
        "example": "Привет, как дела?",
        "distractors_en": ["пока", "здравствуй", "до свидания"],
        "distractors_ru": ["bye", "greetings", "goodbye"]
      }
    ]

    CRITICAL JSON FORMATTING:
    - ALL field values MUST be valid JSON strings (in double quotes)
    - Transcription MUST be a quoted string like "/word/" NOT /word/ without quotes
    - Do NOT use unquoted values or regex-like syntax

    VALIDATION:
    - Include ALL words from the list
    - NEVER assume all words are English - detect language for each word
    - Distractors should be related but clearly different in meaning
    - Example sentence should be practical and natural in the word's language
    - Distractors should be single words or short phrases (max 3 words)

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
        let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();

        // Fix common JSON issues from Gemini
        // Fix unquoted transcriptions like: "transcription": /word/
        jsonStr = jsonStr.replace(/"transcription"\s*:\s*\/([^\/]+)\//g, '"transcription": "/$1/"');

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
        Create BILINGUAL definition cards for these words: ${wordList}

        CRITICAL LANGUAGE DETECTION: For EACH word you receive, you MUST:
        1. FIRST detect what language the word is in (could be English, Russian, Ukrainian, Spanish, French, German, Japanese, Chinese, ANY language!)
        2. Generate content appropriately:
           - If word is in ENGLISH → provide English definitions, examples, and ${targetLang} translations
           - If word is in ${targetLang} → provide ${targetLang} definitions, examples, and English translations
           - If word is in ANY OTHER language → provide definitions in that language and ${targetLang} translations

        IMPORTANT: NEVER assume all words are English! Detect each word's language individually.

        For each word, provide:
        1. The word itself (in its ORIGINAL language - could be ANY language!)
        2. Translation to opposite language (if English→${targetLang}, if ${targetLang}→English, if other→${targetLang})
        3. Phonetic transcription (IPA format) of the ORIGINAL word
        4. Three distractors in the word's ORIGINAL language (same language as the word!)
        5. Three distractors in the OPPOSITE language (translations of the original distractors)
        6. Multiple definitions IN BOTH LANGUAGES
        7. For each definition:
           - Clear explanation in the word's ORIGINAL language
           - Translation of explanation to opposite language  
           - 1-2 example sentences in ORIGINAL language with word replaced by "____"
           - 1-2 translated example sentences in OPPOSITE language
           - For VERBS: show different preposition usages if applicable
        
        SPECIAL RULES FOR VERBS:
        - If a verb ALWAYS uses the same preposition (e.g., "depend on"), show ONE example with that preposition
        - If a verb can use DIFFERENT prepositions with different meanings (e.g., "argue with someone" vs "argue against something"), show MULTIPLE examples demonstrating each usage
        - If a verb doesn't require a preposition (e.g., "deny"), just show regular examples

        Return ONLY a JSON array with this structure (NOTE: use 'ru' keys for ${targetLang} content):
        [
          {
            "word_language": "English",
            "word": "deny",
            "word_ru": "отрицать, отказывать", // ${targetLang} translation
            "transcription": "/dɪˈnaɪ/",
            "distractors_en": ["accept", "allow", "confirm"],
            "distractors_ru": ["принимать", "разрешать", "подтверждать"],
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
            "distractors_en": ["agree", "accept", "listen"],
            "distractors_ru": ["соглашаться", "принимать", "слушать"],
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
        - Distractors should be single words or short phrases that fit the context of a "definition match" quiz

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
        let jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        // Fix unquoted transcriptions
        jsonStr = jsonStr.replace(/"transcription"\s*:\s*\/([^\/]+)\//g, '"transcription": "/$1/"');
        return JSON.parse(jsonStr);
    }
}
