export class TTSService {
    constructor() {
        this.MODEL_ID = 'gemini-2.5-flash-preview-tts';

        // Map difficulty levels to speaking styles
        this.DIFFICULTY_STYLES = {
            'A1': 'very slowly and clearly, like for a beginner',
            'A2': 'slowly and clearly',
            'B1': 'clearly and at a moderate pace',
            'B2': 'naturally, like a native speaker',
            'C1': 'quickly and fluently, with advanced intonation',
            'C2': 'very quickly and with complex native nuances'
        };
    }

    /**
     * Generate TTS audio for a word using Gemini API
     * @param {string} word - The word to pronounce
     * @param {string} language - Language code (e.g., 'en', 'ru', 'uk')
     * @param {string} apiKey - Gemini API key
     * @param {string} difficultyLevel - Speaking difficulty (A1, A2, B1, B2, C1, C2)
     * @param {string} voiceModel - Voice model name (e.g., 'Zephyr', 'Puck', etc.)
     * @returns {Promise<string>} - Base64 encoded audio data
     */
    async generateSpeech(word, language, apiKey, difficultyLevel = 'B2', voiceModel = 'Zephyr') {
        console.log('[TTS Service] Starting generateSpeech:', { word, language, difficultyLevel, voiceModel });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL_ID}:generateContent?key=${apiKey}`;

        const styleDescription = this.DIFFICULTY_STYLES[difficultyLevel] || this.DIFFICULTY_STYLES['B2'];
        console.log('[TTS Service] Style description:', styleDescription);

        const requestBody = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `You are a pronunciation assistant. Read the text exactly as written. The text is in the language with code: "${language}". Speak ${styleDescription}. The word to pronounce is: "${word}"` }
                    ]
                }
            ],
            generationConfig: {
                responseModalities: ['audio'],
                temperature: 1,
                speech_config: {
                    voice_config: {
                        prebuilt_voice_config: {
                            voice_name: voiceModel
                        }
                    }
                }
            }
        };

        try {
            console.log('[TTS Service] Sending request to:', url);
            console.log('[TTS Service] Request body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            console.log('[TTS Service] Response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[TTS Service] Error response:', errorData);

                // Check for quota exceeded
                const errorMessage = errorData.error?.status || '';
                if (errorMessage.includes('Quota exceeded') || errorMessage.includes('429')) {
                    throw new Error('TTS QUOTA EXCEEDED. Try again tomorrow.');
                }

                throw new Error(errorMessage || 'TTS generation failed');
            }

            const data = await response.json();
            console.log('[TTS Service] Response data:', JSON.stringify(data, null, 2).substring(0, 500));

            // Extract audio data from response
            const result = this.extractAudioFromResponse(data);

            if (!result || !result.audio) {
                console.error('[TTS Service] No audio data extracted from response');
                throw new Error('No audio data in response');
            }

            console.log('[TTS Service] Audio data length:', result.audio.length);
            console.log('[TTS Service] MIME type:', result.mimeType);
            return result; // { audio: base64, mimeType: string }
        } catch (error) {
            console.error('[TTS Service] Error generating speech:', error);
            throw error;
        }
    }

    /**
     * Extract base64 audio data from Gemini response
     * @param {Object} data - The JSON response from Gemini API
     * @returns {string|null} - Base64 audio data or null
     */
    extractAudioFromResponse(data) {
        try {
            console.log('[TTS Service] Extracting audio from response');

            // Extract audio data from candidates
            if (data.candidates && data.candidates[0]) {
                const candidate = data.candidates[0];
                console.log('[TTS Service] Found candidate');

                if (candidate.content && candidate.content.parts) {
                    console.log('[TTS Service] Found parts, count:', candidate.content.parts.length);

                    for (const part of candidate.content.parts) {
                        if (part.inlineData && part.inlineData.data) {
                            console.log('[TTS Service] Found audio data, length:', part.inlineData.data.length);
                            console.log('[TTS Service] MIME type:', part.inlineData.mimeType);
                            return {
                                audio: part.inlineData.data,
                                mimeType: part.inlineData.mimeType
                            };
                        }
                    }
                }
            }

            console.error('[TTS Service] No audio data found in response');
            return null;
        } catch (error) {
            console.error('[TTS Service] Error extracting audio:', error);
            return null;
        }
    }

    /**
     * Play audio from base64 data
     * @param {string} base64Audio - Base64 encoded audio
     * @param {string} mimeType - Audio MIME type (default: audio/mpeg for Gemini TTS)
     */
    async playAudio(base64Audio, mimeType = 'audio/mpeg') {
        try {
            const audioBlob = this.base64ToBlob(base64Audio, mimeType);
            const audioUrl = URL.createObjectURL(audioBlob);

            const audio = new Audio(audioUrl);

            // Clean up URL after playing
            audio.addEventListener('ended', () => {
                URL.revokeObjectURL(audioUrl);
            });

            await audio.play();

            return audio;
        } catch (error) {
            console.error('[TTS] Error playing audio:', error);
            throw error;
        }
    }

    /**
     * Convert base64 to Blob
     * @param {string} base64 - Base64 encoded data
     * @param {string} mimeType - MIME type
     * @returns {Blob}
     */
    base64ToBlob(base64, mimeType) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
}
