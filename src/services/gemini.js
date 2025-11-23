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
        if (this.modelsCache && this.modelsCache.length > 0 && (now - this.cacheTimestamp < this.CACHE_DURATION)) {
            console.log('Returning cached models');
            return this.modelsCache;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        console.log('[GeminiService] Fetching models from:', url);

        const response = await fetch(url);
        const data = await response.json();
        console.log('[GeminiService] Models response:', data);

        if (data.error) {
            console.error('[GeminiService] Error fetching models:', data.error);
            throw new Error(data.error.message);
        }

        // Filter for generateContent models and exclude unwanted types
        const models = data.models
            .filter(m => {
                // If supportedGenerationMethods is present, it MUST include generateContent
                if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
                    return false;
                }
                const name = m.name.toLowerCase();
                return !name.includes('image') &&
                    !name.includes('imagen') &&
                    !name.includes('tts') &&
                    !name.includes('computer-use') &&
                    !name.includes('embedding');
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

        const targetLangCode = language;

        const prompt = `
Create fill-in-the-blank flashcard exercises for EACH of the following words: ${wordList}

CRITICAL LANGUAGE DETECTION: For EACH word, you MUST first detect what language it is in (English, Russian, Ukrainian, Spanish, German, French, Japanese, ANY language):
- Detect the ORIGINAL language of the word and determine its 2-letter code (en, ru, uk, es, de, fr, ja, etc.)
- Determine the TARGET language for UI (${targetLang})
- If word is in ${targetLang}, then TARGET language should be English instead

IMPORTANT: Do NOT assume all words are English. Each word could be in ANY language!

For each exercise, create:
1. **word_language**: Full detected language name (e.g., "English", "German", "Spanish")
2. **word_language_code**: 2-letter ISO code (e.g., "en", "de", "es")
3. Sentence key in ORIGINAL language code: "[WORD_LANG_CODE]": "sentence with _____"
4. Sentence key in TARGET language code: "${targetLangCode}": "translated sentence with _____"
5. Options in ORIGINAL language: "options_[WORD_LANG_CODE]": [...]
6. Options in TARGET language: "options_${targetLangCode}": [...]
7. Correct answer keys: "correct_answer_[WORD_LANG_CODE]" and "correct_answer_${targetLangCode}"
8. Hint keys: "hint_[WORD_LANG_CODE]" and "hint_${targetLangCode}"
9. Explanation keys: "explanation_[WORD_LANG_CODE]" and "explanation_${targetLangCode}"

Requirements:
- Sentences should be natural and practical IN THEIR RESPECTIVE LANGUAGES
- Both versions should have the blank in corresponding position
- Distractors should be in the same language as the word they're meant to replace
- Hints should guide thinking without revealing the answer
- Explanations should teach the word usage IN THE ORIGINAL LANGUAGE

CRITICAL VALIDATION RULES FOR TARGET LANGUAGE TRANSLATIONS:
- The TARGET language translation of the correct word MUST be the ONLY logically and semantically correct answer for the TARGET language sentence
- Double-check that NONE of the TARGET language distractors would make semantic sense in the TARGET language sentence context

**EXAMPLE FOR ENGLISH WORD (when UI is ${targetLang}):**
{
  "word_language": "English",
  "word_language_code": "en",
  "en": "I love to ___ movies on weekends",
  "${targetLangCode}": "Я люблю ___ фильмы по выходным",
  "word": "watch",
  "options_en": ["watch", "read", "listen", "play"],
  "options_${targetLangCode}": ["смотреть", "читать", "слушать", "играть"],
  "correct_answer_en": "watch",
  "correct_answer_${targetLangCode}": "смотреть",
  "hint_en": "Think about what you do with your eyes when enjoying visual content.",
  "hint_${targetLangCode}": "Подумайте, что вы делаете глазами, когда наслаждаетесь визуальным контентом.",
  "explanation_en": "The correct answer is 'watch' because...",
  "explanation_${targetLangCode}": "Правильный ответ - 'смотреть', потому что..."
}

**EXAMPLE FOR GERMAN WORD (when UI is ${targetLang}):**
{
  "word_language": "German",
  "word_language_code": "de",
  "de": "Er hat ___ im Park gesehen.",
  "${targetLangCode}": "Он видел ___ в парке.",
  "word": "uns",
  "options_de": ["uns", "mir", "dir", "ihm"],
  "options_${targetLangCode}": ["нас", "мне", "тебе", "ему"],
  "correct_answer_de": "uns",
  "correct_answer_${targetLangCode}": "нас",
  "hint_de": "Denken Sie an das Objektpronomen für 'wir'.",
  "hint_${targetLangCode}": "Подумайте об объектном местоимении для 'мы'.",
  "explanation_de": "Die richtige Antwort ist 'uns', weil...",
  "explanation_${targetLangCode}": "Правильный ответ - 'нас', потому что..."
}

IMPORTANT:
- You MUST include "word_language" and "word_language_code" fields
- Use dynamic keys based on detected language code
- In options arrays, the correct answer must be included and shuffled randomly among the wrong answers
- The TARGET language options must correspond exactly by index to the ORIGINAL language options
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

        const languageCodeMap = {
            'English': 'en',
            'Russian': 'ru',
            'Ukrainian': 'uk',
            'Spanish': 'es',
            'French': 'fr',
            'German': 'de',
            'Italian': 'it',
            'Portuguese': 'pt',
            'Japanese': 'ja',
            'Chinese': 'zh',
            'Korean': 'ko',
            'Arabic': 'ar'
        };
        const targetLangCode = language; // ru, uk, en

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
        2. Determine the language CODE for that language (en, ru, uk, es, fr, de, ja, zh, etc.)
        3. Generate content appropriately:
           - If word is in ENGLISH → provide English definitions, examples, and ${targetLang} translations
           - If word is in ${targetLang} → provide ${targetLang} definitions, examples, and English translations
           - If word is in ANY OTHER language → provide definitions in that language and ${targetLang} translations

        IMPORTANT: NEVER assume all words are English! Detect each word's language individually.

        For each word, provide:
        1. The word itself (in its ORIGINAL language - could be ANY language!)
        2. **word_language**: Full language name (e.g., "English", "German", "Spanish")
        3. **word_language_code**: 2-letter ISO code (e.g., "en", "de", "es")
        4. Translation to ${targetLang} (use key "word_${targetLangCode}")
        5. Phonetic transcription (IPA format) of the ORIGINAL word
        6. Three distractors in the word's ORIGINAL language using key "distractors_[WORD_LANG_CODE]"
        7. Three distractors in ${targetLang} using key "distractors_${targetLangCode}"
        8. Multiple definitions with:
           - Explanation in ORIGINAL language using key "meaning_[WORD_LANG_CODE]"
           - Explanation in ${targetLang} using key "meaning_${targetLangCode}"
           - Examples in ORIGINAL language using key "examples_[WORD_LANG_CODE]"
           - Examples in ${targetLang} using key "examples_${targetLangCode}"
        
        SPECIAL RULES FOR VERBS:
        - If a verb ALWAYS uses the same preposition (e.g., "depend on"), show ONE example with that preposition
        - If a verb can use DIFFERENT prepositions with different meanings (e.g., "argue with someone" vs "argue against something"), show MULTIPLE examples demonstrating each usage
        - If a verb doesn't require a preposition (e.g., "deny"), just show regular examples

        **EXAMPLE FOR ENGLISH WORD (when UI language is ${targetLang}):**
        {
          "word_language": "English",
          "word_language_code": "en",
          "word": "deny",
          "word_${targetLangCode}": "отрицать, отказывать",
          "transcription": "/dɪˈnaɪ/",
          "distractors_en": ["accept", "allow", "confirm"],
          "distractors_${targetLangCode}": ["принимать", "разрешать", "подтверждать"],
          "definitions": [
            {
              "meaning_en": "to not allow someone to have or do something",
              "meaning_${targetLangCode}": "не разрешать кому-либо иметь или делать что-либо",
              "examples_en": [
                {
                  "text": "They ____ food to the prisoners.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Они ____ еду заключенным.",
                  "preposition": null
                }
              ]
            }
          ]
        }

        **EXAMPLE FOR GERMAN WORD (when UI language is ${targetLang}):**
        {
          "word_language": "German",
          "word_language_code": "de",
          "word": "uns",
          "word_${targetLangCode}": "нас, нам",
          "transcription": "/ʊns/",
          "distractors_de": ["mir", "dir", "ihm"],
          "distractors_${targetLangCode}": ["мне", "тебе", "ему"],
          "definitions": [
            {
              "meaning_de": "Akkusativ des Personalpronomens 'wir', bedeutet 'uns'",
              "meaning_${targetLangCode}": "Винительный падеж местоимения 'мы', означает 'нас'",
              "examples_de": [
                {
                  "text": "Er hat ____ im Park gesehen.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Он видел ____ в парке.",
                  "preposition": null
                }
              ]
            }
          ]
        }

        IMPORTANT:
        - Include "word_language_code" field with 2-letter ISO code
        - Use dynamic keys: distractors_[DETECTED_LANG_CODE], meaning_[DETECTED_LANG_CODE], examples_[DETECTED_LANG_CODE]
        - Always include ${targetLangCode} versions: distractors_${targetLangCode}, meaning_${targetLangCode}, examples_${targetLangCode}
        - Examples should be natural and practical IN BOTH LANGUAGES
        - Replace the word with ____ in examples
        - Distractors should fit the context of a "definition match" quiz

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
