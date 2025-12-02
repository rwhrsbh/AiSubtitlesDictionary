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
                const displayName = (m.displayName || '').toLowerCase();
                return !name.includes('image') &&
                    !name.includes('imagen') &&
                    !name.includes('tts') &&
                    !name.includes('nano') &&
                    !name.includes('computer-use') &&
                    !name.includes('embedding') &&
                    !displayName.includes('image') &&
                    !displayName.includes('imagen') &&
                    !displayName.includes('nano') &&
                    !displayName.includes('tts') &&
                    !displayName.includes('computer-use') &&
                    !displayName.includes('embedding')&& !name.inc;
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
- **CRITICAL: DO NOT use the target word itself or any related/derived forms in the sentence (except in the blank)!**
  * BAD: "długa" → "Ta droga ma dużą **długość**" ❌ (uses derived form "długość")
  * GOOD: "długa" → "Ta droga jest bardzo ___" ✓
  * BAD: "бежать" → "Во время **бега** я ___" ❌ (uses derived noun "бега")
  * GOOD: "бежать" → "Каждое утро я ___ в парке" ✓

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
        const targetLangCode = language;

        const shuffledWords = words.sort(() => Math.random() - 0.5);
        const wordList = shuffledWords.map(w => w.word).join(', ');

        const prompt = `
    Create translation flashcards with examples for these words: ${wordList}

    CRITICAL LANGUAGE DETECTION: For EACH word you receive, you MUST:
    1. FIRST detect what language the word is in (could be English, Russian, Ukrainian, Spanish, French, German, Japanese, Chinese, ANY language!)
    2. Determine the language CODE for that language (en, ru, uk, es, fr, de, ja, zh, etc.)
    3. Generate content appropriately:
       - If word is in ENGLISH → provide English examples and ${targetLang} translations
       - If word is in ${targetLang} → provide ${targetLang} examples and English translations
       - If word is in ANY OTHER language → provide examples in that language and ${targetLang} translations

    IMPORTANT: NEVER assume all words are English! Detect each word's language individually.

    For each word, provide:
    1. The word itself (in its ORIGINAL language - could be ANY language!)
    2. **word_language**: Full language name (e.g., "English", "German", "Spanish")
    3. **word_language_code**: 2-letter ISO code (e.g., "en", "de", "es")
    4. Translation to ${targetLang} using key "word_${targetLangCode}"
    5. Phonetic transcription (IPA format) of the ORIGINAL word
    6. Three distractors in the word's ORIGINAL language using key "distractors_[WORD_LANG_CODE]"
    7. Three distractors in ${targetLang} using key "distractors_${targetLangCode}"
    8. 2-3 FULL, DETAILED example sentences with blanks showing DIFFERENT CONTEXTS:
       - Examples in ORIGINAL language using key "examples_[WORD_LANG_CODE]"
       - Examples in ${targetLang} using key "examples_${targetLangCode}"
       - CRITICAL RULES FOR EXAMPLES:
         * Use COMPLETE, NATURAL sentences with full context (not short phrases)
         * Show DIVERSE real-life situations and contexts
         * If word has multiple parts of speech, show examples for EACH
         * If word has multiple meanings, show examples for DIFFERENT meanings
         * Examples should be rich in context to help understand usage
       - GOOD EXAMPLES:
         * "run" → "I try to ____ at least 5 kilometers every morning before work." (verb - exercise)
         * "run" → "My father has been helping to ____ our family business for over 20 years." (verb - manage)
         * "run" → "After a long ____ in the park, I felt completely refreshed and energized." (noun - activity)
       - BAD EXAMPLES (too short, no context):
         * "I ____" ❌
         * "Let's ____" ❌
         * "She ____ it" ❌
    9. Explanation in both languages mentioning ALL possible uses:
       - Explanation in ORIGINAL language using key "explanation_[WORD_LANG_CODE]"
       - Explanation in ${targetLang} using key "explanation_${targetLangCode}"
       - Include information about different parts of speech, different meanings, and common contexts

    **EXAMPLE FOR ENGLISH WORD (when UI language is ${targetLang}):**
    {
      "word_language": "English",
      "word_language_code": "en",
      "word": "run",
      "word_${targetLangCode}": "бегать, бежать, управлять",
      "transcription": "/rʌn/",
      "distractors_en": ["walk", "jog", "sprint"],
      "distractors_${targetLangCode}": ["ходить", "бегать трусцой", "спринт"],
      "examples_en": [
        { "text": "I try to ____ at least 5 kilometers every morning before I start my workday, because it helps me stay healthy and energized." },
        { "text": "My father has been helping to ____ our family business for over 20 years, and he taught me everything I know about managing a company." },
        { "text": "After a long ____ in the park with my dog, I always feel completely refreshed and ready to tackle any challenges that come my way." }
      ],
      "examples_${targetLangCode}": [
        { "text": "Я стараюсь ____ не менее 5 километров каждое утро перед началом рабочего дня, потому что это помогает мне оставаться здоровым и энергичным." },
        { "text": "Мой отец помогает ____ нашим семейным бизнесом уже более 20 лет, и он научил меня всему, что я знаю об управлении компанией." },
        { "text": "После долгой ____ в парке с моей собакой я всегда чувствую себя полностью обновленным и готовым справиться с любыми трудностями." }
      ],
      "explanation_en": "The word 'run' can be used as a VERB meaning 'to move quickly on foot' (физическая активность), 'to manage or operate' (управление бизнесом), or as a NOUN meaning 'an act of running' (пробежка как событие). It shows completely different meanings depending on context.",
      "explanation_${targetLangCode}": "Слово 'run' может использоваться как ГЛАГОЛ со значением 'быстро двигаться' (физическая активность), 'управлять' (бизнесом), или как СУЩЕСТВИТЕЛЬНОЕ со значением 'пробежка' (как событие). Оно имеет совершенно разные значения в зависимости от контекста."
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
      "examples_de": [
        { "text": "Mein alter Freund aus der Schule hat ____ gestern zufällig im Park gesehen und war sehr überrascht, uns nach so vielen Jahren wiederzutreffen." },
        { "text": "Die freundliche Bibliothekarin gab ____ das seltene Buch, das wir seit Wochen gesucht hatten, und erklärte uns ausführlich die Ausleihbedingungen." },
        { "text": "Der Professor hat ____ während der Vorlesung mehrmals gelobt, weil wir die schwierige Aufgabe als einzige Gruppe richtig gelöst hatten." }
      ],
      "examples_${targetLangCode}": [
        { "text": "Мой старый друг из школы случайно увидел ____ вчера в парке и был очень удивлен встрече с нами после стольких лет." },
        { "text": "Дружелюбная библиотекарь дала ____ редкую книгу, которую мы искали несколько недель, и подробно объяснила нам условия выдачи." },
        { "text": "Профессор несколько раз хвалил ____ во время лекции, потому что мы были единственной группой, которая правильно решила сложную задачу." }
      ],
      "explanation_de": "Das Wort 'uns' ist ein Personalpronomen der 1. Person Plural im Akkusativ und Dativ, das 'wir' im Objektfall bedeutet. Es kann sowohl als AKKUSATIVOBJEKT (wen? - uns sehen) als auch als DATIVOBJEKT (wem? - uns geben) verwendet werden.",
      "explanation_${targetLangCode}": "Слово 'uns' (нас/нам) - это личное местоимение 1-го лица множественного числа в винительном и дательном падежах. Может использоваться как ПРЯМОЕ ДОПОЛНЕНИЕ (кого? - видеть нас) и как КОСВЕННОЕ ДОПОЛНЕНИЕ (кому? - давать нам)."
    }

    IMPORTANT:
    - Include "word_language_code" field with 2-letter ISO code
    - Use dynamic keys: distractors_[DETECTED_LANG_CODE], examples_[DETECTED_LANG_CODE], explanation_[DETECTED_LANG_CODE]
    - Always include ${targetLangCode} versions: word_${targetLangCode}, distractors_${targetLangCode}, examples_${targetLangCode}, explanation_${targetLangCode}
    - Examples should be natural and practical IN BOTH LANGUAGES
    - Replace the word with ____ in examples
    - Distractors should be similar words that could be confused with the target word
    - Explanation should clarify the meaning and usage
    - In case the word is a verb and it is in the infinitive form, you can use different verb forms in the examples.
    - For german verbs with a separable prefix you should generate at least one example where the prefix is separated.

    CRITICAL JSON FORMATTING:
    - ALL field values MUST be valid JSON strings (in double quotes)
    - Transcription MUST be a quoted string like "/word/" NOT /word/ without quotes
    - Do NOT use unquoted values or regex-like syntax

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

        CRITICAL RULES FOR EXAMPLES:
        - Use COMPLETE, NATURAL, DETAILED sentences with full context (NOT short phrases!)
        - Examples should be rich in context to help understand real-world usage
        - Show DIVERSE situations and contexts
        - GOOD: "The government decided to ____ humanitarian aid to the conflict zone, despite international pressure to provide assistance."
        - BAD: "They ____ food." ❌ (too short, no context)
        - **CRITICAL: DO NOT use the target word itself or any related/derived forms in examples or definitions!**
          * BAD: "długa" → "Mająca dużą **długość**" ❌ (uses derived form "długość")
          * GOOD: "długa" → "Mająca znaczny wymiar od jednego końca do drugiego" ✓
          * BAD: "бежать" → "Действие **бега**" ❌ (uses derived noun "бега")
          * GOOD: "бежать" → "Быстро перемещаться на ногах" ✓

        CRITICAL: SHOW ALL PARTS OF SPEECH:
        - If a word can be MULTIPLE parts of speech (noun, verb, adjective, etc.), create SEPARATE definitions for EACH
        - Example: "run" → definition 1 as VERB ("to move quickly"), definition 2 as VERB ("to manage"), definition 3 as NOUN ("an act of running")
        - Example: "glue" → definition 1 as NOUN ("adhesive substance"), definition 2 as VERB ("to stick together")
        - Example: "light" → definition 1 as NOUN ("illumination"), definition 2 as VERB ("to ignite"), definition 3 as ADJECTIVE ("not heavy")
        - Each definition should clearly show the part of speech and context

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
              "meaning_en": "to refuse to give someone something they want or need",
              "meaning_${targetLangCode}": "отказывать кому-либо в чем-то, что им нужно или хочется",
              "examples_en": [
                {
                  "text": "The government decided to ____ humanitarian aid to the conflict zone, despite international pressure to provide assistance to the suffering population.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Правительство решило ____ гуманитарную помощь зоне конфликта, несмотря на международное давление оказать помощь страдающему населению.",
                  "preposition": null
                }
              ]
            },
            {
              "meaning_en": "to say that something is not true or that you did not do something",
              "meaning_${targetLangCode}": "отрицать что-то или утверждать, что вы чего-то не делали",
              "examples_en": [
                {
                  "text": "The suspect continued to ____ any involvement in the crime, even though the evidence strongly suggested otherwise.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Подозреваемый продолжал ____ какую-либо причастность к преступлению, хотя улики явно свидетельствовали об обратном.",
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
              "meaning_de": "Akkusativ des Personalpronomens 'wir' - bezeichnet eine Gruppe, zu der der Sprecher gehört, als direktes Objekt einer Handlung",
              "meaning_${targetLangCode}": "Винительный падеж местоимения 'мы' - обозначает группу, к которой принадлежит говорящий, как прямое дополнение действия",
              "examples_de": [
                {
                  "text": "Mein alter Freund aus der Schule hat ____ gestern zufällig im Park gesehen und war sehr überrascht, uns nach so vielen Jahren wiederzutreffen.",
                  "preposition": null
                },
                {
                  "text": "Der freundliche Nachbar hat ____ letzte Woche zum Grillen eingeladen und wir hatten einen wunderbaren Abend mit köstlichem Essen und interessanten Gesprächen.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Мой старый друг из школы случайно увидел ____ вчера в парке и был очень удивлен встрече с нами после стольких лет.",
                  "preposition": null
                },
                {
                  "text": "Дружелюбный сосед пригласил ____ на барбекю на прошлой неделе, и мы провели прекрасный вечер с вкусной едой и интересными разговорами.",
                  "preposition": null
                }
              ]
            },
            {
              "meaning_de": "Dativ des Personalpronomens 'wir' - bezeichnet eine Gruppe als indirektes Objekt, dem etwas gegeben oder gesagt wird",
              "meaning_${targetLangCode}": "Дательный падеж местоимения 'мы' - обозначает группу как косвенное дополнение, которому что-то дают или говорят",
              "examples_de": [
                {
                  "text": "Die freundliche Bibliothekarin gab ____ das seltene Buch, das wir seit Wochen gesucht hatten, und erklärte uns ausführlich die Ausleihbedingungen.",
                  "preposition": null
                },
                {
                  "text": "Der Professor hat ____ während der Vorlesung mehrmals gelobt, weil wir die schwierige Aufgabe als einzige Gruppe richtig gelöst hatten.",
                  "preposition": null
                }
              ],
              "examples_${targetLangCode}": [
                {
                  "text": "Дружелюбная библиотекарь дала ____ редкую книгу, которую мы искали несколько недель, и подробно объяснила нам условия выдачи.",
                  "preposition": null
                },
                {
                  "text": "Профессор несколько раз хвалил ____ во время лекции, потому что мы были единственной группой, которая правильно решила сложную задачу.",
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
        - In case the word is a verb and it is in the infinitive form, you can use different verb forms in the examples.
        - For German verbs with a separable prefix you should generate at least one example where the prefix is separated.


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
