const express = require('express');
const { speech_To_Text } = require('./STT');
const { translate_Text, detect_Language } = require('./Translate');
const { text_To_Speech } = require('./TTS');
const { detectLanguageFromDataUri } = require('./lid');

function toShortLanguageCode(languageTag) {
    if (!languageTag || typeof languageTag !== 'string') return undefined;
    const tag = languageTag.trim();
    const special = {
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'pt-BR': 'pt',
        'pt-PT': 'pt'
    };
    if (special[tag]) return special[tag];
    const dashIndex = tag.indexOf('-');
    return dashIndex > 0 ? tag.substring(0, dashIndex) : tag;
}

function isoToBcp47Preferred(iso) {
    if (!iso) return undefined;
    const s = iso.trim().toLowerCase();
    // preferred defaults for common languages
    const map = {
        en: 'en-US',
        ur: 'ur-PK',
        ar: 'ar-XA',
        de: 'de-DE',
        es: 'es-ES',
        fr: 'fr-FR',
        it: 'it-IT',
        pt: 'pt-BR',
        zh: 'zh-CN',
        hi: 'hi-IN',
        bn: 'bn-BD',
        ru: 'ru-RU',
        tr: 'tr-TR',
        id: 'id-ID',
    };
    // If not in map, return the short ISO (STT generally accepts base language)
    return map[s] || s;
}

function normalizeSttLanguageCode(lang) {
    if (!lang) return lang;
    const lc = lang.trim();
    // Fix common STT-incompatible codes
    if (/^ar-XA$/i.test(lc)) return 'ar-SA'; // choose Saudi as default regional Arabic
    if (/^zh-CN$/i.test(lc)) return 'cmn-Hans-CN'; // Mandarin Simplified (STT)
    if (/^zh-TW$/i.test(lc)) return 'cmn-Hant-TW'; // Mandarin Traditional (STT)
    return lc;
}

function getContentTypeForEncoding(audioEncoding) {
    const enc = (audioEncoding || 'MP3').toUpperCase();
    if (enc === 'MP3') return 'audio/mpeg';
    if (enc === 'OGG_OPUS') return 'audio/ogg';
    if (enc === 'LINEAR16') return 'audio/wav';
    return 'application/octet-stream';
}

const router = express.Router();
router.use(express.json({ limit: '20mb' }));

// Optional: Transcode input audio (m4a/aac/mp4) to OGG_OPUS using ffmpeg for STT stability.
let ffmpeg;
let ffmpegStatic;
try {
    ffmpeg = require('fluent-ffmpeg');
    ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) {
        ffmpeg.setFfmpegPath(ffmpegStatic);
    }
} catch (_) {
    // ffmpeg is optional; if not installed, we skip transcoding
}

async function maybeTranscodeToOggOpus(dataUri) {
    if (!ffmpeg || !dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;
    const header = dataUri.split(',')[0] || '';
    // If already a supported format, skip
    if (/audio\/(webm|ogg|wav|x-wav|mpeg)/i.test(header)) return null;

    const base64 = dataUri.split(',')[1] || '';
    if (!base64) return null;
    const inputBuffer = Buffer.from(base64, 'base64');

    const tmp = require('os').tmpdir();
    const path = require('path');
    const fs = require('fs');
    const inPath = path.join(tmp, `in_${Date.now()}.bin`);
    const outPath = path.join(tmp, `out_${Date.now()}.ogg`);
    fs.writeFileSync(inPath, inputBuffer);

    await new Promise((resolve, reject) => {
        ffmpeg(inPath)
            .audioCodec('libopus')
            .format('ogg')
            .audioChannels(1)
            .audioFrequency(48000)
            .outputOptions(['-b:a 64k'])
            .on('end', resolve)
            .on('error', reject)
            .save(outPath);
    });

    const outBuffer = require('fs').readFileSync(outPath);
    try { fs.unlinkSync(inPath); } catch (_) {}
    try { fs.unlinkSync(outPath); } catch (_) {}
    const outBase64 = outBuffer.toString('base64');
    return `data:audio/ogg;base64,${outBase64}`;
}

function inferSttEncodingFromDataUri(dataUri) {
    if (!dataUri || typeof dataUri !== 'string') return undefined;
    if (!dataUri.startsWith('data:')) return undefined;
    const header = dataUri.split(',')[0] || '';
    // Example: data:audio/webm;base64,...
    if (/audio\/webm/i.test(header)) return 'WEBM_OPUS';
    if (/audio\/ogg/i.test(header)) return 'OGG_OPUS';
    if (/audio\/wav/i.test(header)) return 'LINEAR16';
    if (/audio\/x-wav/i.test(header)) return 'LINEAR16';
    if (/audio\/mpeg/i.test(header)) return 'MP3';
    // For m4a/mp4/aac, let API inspect container; do not force encoding
    // if (/audio\/(mp4|m4a|aac)/i.test(header)) return undefined;
    return undefined;
}

// POST /api/pipeline/stt-translate-tts
// Body:
// {
//   data: string (base64 or data URI),
//   // EITHER single-direction mode (legacy):
//   sttLanguageCode?: string (e.g., 'en-US'),
//   translateTargetLanguage?: string (e.g., 'ur'),
//   translateSourceLanguage?: string (e.g., 'en'),
//   ttsLanguageCode?: string (e.g., 'ur-PK'),
//
//   // OR bidirectional mode (auto-detect):
//   languageA?: string (e.g., 'en-US'),
//   languageB?: string (e.g., 'ur-PK'),
//
//   sttAudioEncoding?: string,
//   sampleRateHertz?: number,
//   ttsVoiceName?: string,
//   ttsSsmlGender?: string,
//   ttsAudioEncoding?: 'MP3' | 'OGG_OPUS' | 'LINEAR16',
//   useLongRunning?: boolean,
//
//   // Any-language detection mode (unknown vs known):
//   autoDetectUnknown?: boolean,
//   conversationId?: string,
//   knownLanguageA?: string,
//   partnerLanguagePreferred?: string
// }
router.post('/stt-translate-tts', async (req, res) => {
    try {
        const {
            data,
            sttLanguageCode,
            sttAudioEncoding,
            sampleRateHertz,
            model,
            enableWordTimeOffsets,
            enableAutomaticPunctuation,
            profanityFilter,
            audioChannelCount,
            translateTargetLanguage,
            translateSourceLanguage,
            ttsLanguageCode,
            ttsVoiceName,
            ttsSsmlGender,
            ttsAudioEncoding,
            useLongRunning,
            // New bidirectional inputs
            languageA,
            languageB,
            autoDetectUnknown,
            conversationId,
            knownLanguageA,
            partnerLanguagePreferred,
            resetUnknown,
            proposedLanguageB
        } = req.body || {};

        if (!data) {
            return res.status(400).json({ success: false, message: 'Missing required field: data' });
        }

        const isBidirectional = Boolean(languageA && languageB);
        const isUnknownVsKnown = Boolean(autoDetectUnknown && conversationId && knownLanguageA);
        if (!isBidirectional && !isUnknownVsKnown) {
            if (!sttLanguageCode || !translateTargetLanguage || !ttsLanguageCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: (sttLanguageCode, translateTargetLanguage, ttsLanguageCode) or provide (languageA, languageB) for bidirectional mode or (autoDetectUnknown, conversationId, knownLanguageA)'
                });
            }
        }

        // 1) Speech-to-Text
        // Transcode if needed for iOS m4a/aac/mp4 to improve STT compatibility
        const maybeTranscoded = await maybeTranscodeToOggOpus(data).catch(() => null);
        const finalData = maybeTranscoded || data;
        const inferredEncoding = sttAudioEncoding || inferSttEncodingFromDataUri(finalData) || (maybeTranscoded ? 'OGG_OPUS' : undefined);
        let sttResult;
        if (isBidirectional) {
            // Single STT with A as primary and B as alternative to classify spoken language
            const sttCommon = {
                audioEncoding: inferredEncoding,
                sampleRateHertz,
                model,
                enableWordTimeOffsets,
                enableAutomaticPunctuation,
                profanityFilter,
                audioChannelCount,
                useLongRunning
            };

            const sttRes = await speech_To_Text(finalData, {
                languageCode: languageA,
                alternativeLanguageCodes: [languageB],
                ...sttCommon
            });
            sttResult = sttRes;
            if (!sttRes.detectedLanguageCode) {
                const guess = await detect_Language(sttRes.transcript || '');
                if (guess) sttResult.detectedLanguageCode = guess;
            }
        } else if (isUnknownVsKnown) {
            // Any-language detection for unknown vs known
            // Cache storage (in-memory) for conversation languageB and confidence
            global.__convCache = global.__convCache || new Map();
            const cache = global.__convCache;

            if (resetUnknown) {
                cache.delete(conversationId);
            }

            let cached = cache.get(conversationId);
            // Seed from explicit proposals or partnerPreferred
            let languageBCode = proposedLanguageB || partnerLanguagePreferred || languageB || (cached && cached.languageB) || undefined;
            let lidFirst = null;
            if (!languageBCode) {
                // Detect on this utterance to seed other language
                lidFirst = await detectLanguageFromDataUri(finalData);
                if (lidFirst && lidFirst.language) {
                    const guessB = isoToBcp47Preferred(lidFirst.language);
                    if (toShortLanguageCode(guessB) !== toShortLanguageCode(knownLanguageA)) {
                        languageBCode = guessB;
                        cached = {
                            languageBISO: lidFirst.language,
                            confidenceB: typeof lidFirst.confidence === 'number' ? lidFirst.confidence : undefined,
                            languageB: guessB
                        };
                        cache.set(conversationId, cached);
                    }
                }
            }

            // Single STT with known A and alt B
            const sttCommon = {
                audioEncoding: inferredEncoding,
                sampleRateHertz,
                model,
                enableWordTimeOffsets,
                enableAutomaticPunctuation,
                profanityFilter,
                audioChannelCount,
                useLongRunning
            };

            const altCodes = [];
            const normA = normalizeSttLanguageCode(knownLanguageA);
            const normB = languageBCode ? normalizeSttLanguageCode(languageBCode) : undefined;
            if (normB && toShortLanguageCode(normB) !== toShortLanguageCode(normA)) {
                altCodes.push(normB);
            }
            let sttRes = await speech_To_Text(finalData, {
                languageCode: normA,
                alternativeLanguageCodes: altCodes,
                ...sttCommon
            });
            
            // // Enhanced fallback for Urdu and other aggressive models
            // const shouldTryFallback = (!sttRes.transcript || sttRes.transcript.length === 0) ||
            //     (toShortLanguageCode(normA) === 'ur' && !sttRes.detectedLanguageCode);
                
            // if (shouldTryFallback && normB) {
                        // Simple fallback: if no transcript and we have a partner B, retry once with B primary
                        if ((!sttRes.transcript || sttRes.transcript.length === 0) && normB) {
                const altBack = [];
                if (normA && toShortLanguageCode(normA) !== toShortLanguageCode(normB)) altBack.push(normA);
                // const fallbackRes = await speech_To_Text(finalData, {
                    sttRes = await speech_To_Text(finalData, {
                    languageCode: normB,
                    alternativeLanguageCodes: altBack,
                    ...sttCommon
                });
                
                // // For Urdu primary: prefer fallback if it has better language detection
                // if (toShortLanguageCode(normA) === 'ur' && fallbackRes.detectedLanguageCode && 
                //     toShortLanguageCode(fallbackRes.detectedLanguageCode) !== 'ur') {
                //     sttRes = fallbackRes;
                // } else if (!sttRes.transcript || sttRes.transcript.length === 0) {
                //     sttRes = fallbackRes;
                // }
            }

            sttResult = sttRes;
            // If detection is unclear, fallback to LID snippet
            if (!sttRes.detectedLanguageCode) {
                const lid2 = lidFirst || await detectLanguageFromDataUri(finalData);
                if (lid2 && lid2.language) sttResult.detectedLanguageCode = lid2.language;
            }
        } else {
            sttResult = await speech_To_Text(finalData, {
                languageCode: sttLanguageCode,
                audioEncoding: inferredEncoding,
                sampleRateHertz,
                model,
                enableWordTimeOffsets,
                enableAutomaticPunctuation,
                profanityFilter,
                audioChannelCount,
                useLongRunning
            });
        }

        const transcript = (sttResult && sttResult.transcript) || '';
        if (!transcript) {
            return res.status(400).json({ success: false, message: 'No transcript detected from audio' });
        }

        // 2) Translate
        let translatedText;
        if (isBidirectional) {
            // Decide target based on detected spoken language
            const detected = sttResult.detectedLanguageCode || toShortLanguageCode(languageA);
            const detectedShort = toShortLanguageCode(detected);
            const langAShort = toShortLanguageCode(languageA);
            const langBShort = toShortLanguageCode(languageB);
            // If speaker used A -> translate to B; else translate to A
            const targetShort = detectedShort === langAShort ? langBShort : langAShort;
            const targetForTts = targetShort === langAShort ? languageA : languageB;

            translatedText = await translate_Text(transcript, targetShort, detectedShort);

            // 3) TTS in the matching BCP-47 code of the target language
            const finalAudioEncoding = ttsAudioEncoding || 'MP3';
            const audioBuffer = await text_To_Speech(
                translatedText,
                ttsVoiceName,
                targetForTts,
                ttsSsmlGender,
                finalAudioEncoding
            );
            const audioContentType = getContentTypeForEncoding(finalAudioEncoding);

            return res.json({
                success: true,
                transcript,
                detectedLanguageCode: sttResult.detectedLanguageCode,
                translatedText,
                audioContent: (audioBuffer || Buffer.alloc(0)).toString('base64'),
                audioContentType
            });
        } else if (isUnknownVsKnown) {
            const detected = sttResult.detectedLanguageCode || toShortLanguageCode(knownLanguageA);
            const detectedShort = toShortLanguageCode(detected);
            const aShort = toShortLanguageCode(knownLanguageA);
            // Pick opposite as target
            global.__convCache = global.__convCache || new Map();
            const cached = global.__convCache.get(conversationId) || {};
            let bCode = cached.languageB || partnerLanguagePreferred || languageB;
            // If B is still undefined or equals A, try to derive from detected when different from A
            if (!bCode && detectedShort !== aShort) bCode = isoToBcp47Preferred(detectedShort);
            if (!bCode) bCode = knownLanguageA; // fallback for this turn
            const bShort = toShortLanguageCode(bCode);

            const targetShort = detectedShort === aShort ? bShort : aShort;
            const targetForTts = targetShort === aShort ? knownLanguageA : bCode;
            const translatedText2 = await translate_Text(transcript, targetShort, detectedShort);

            // Update cache if we discovered a new B (different from A and previous B)
            if (detectedShort !== aShort && (!cached.languageB || toShortLanguageCode(cached.languageB) !== detectedShort)) {
                const newB = isoToBcp47Preferred(detectedShort);
                global.__convCache.set(conversationId, {
                    languageBISO: detectedShort,
                    confidenceB: undefined,
                    languageB: newB
                });
            }

            const finalAudioEncoding2 = ttsAudioEncoding || 'MP3';
            const audioBuffer2 = await text_To_Speech(
                translatedText2,
                ttsVoiceName,
                targetForTts,
                ttsSsmlGender,
                finalAudioEncoding2
            );
            const audioContentType2 = getContentTypeForEncoding(finalAudioEncoding2);

            return res.json({
                success: true,
                transcript,
                detectedLanguageCode: sttResult.detectedLanguageCode,
                translatedText: translatedText2,
                audioContent: (audioBuffer2 || Buffer.alloc(0)).toString('base64'),
                audioContentType: audioContentType2
            });
        } else {
            const sourceLang = translateSourceLanguage || toShortLanguageCode(sttLanguageCode);
            translatedText = await translate_Text(transcript, translateTargetLanguage, sourceLang);
        }

        // 3) Text-to-Speech (single-direction)
        const finalAudioEncoding = ttsAudioEncoding || 'MP3';
        const audioBuffer = await text_To_Speech(translatedText, ttsVoiceName, ttsLanguageCode, ttsSsmlGender, finalAudioEncoding);
        const audioContentType = getContentTypeForEncoding(finalAudioEncoding);

        return res.json({
            success: true,
            transcript,
            translatedText,
            audioContent: (audioBuffer || Buffer.alloc(0)).toString('base64'),
            audioContentType
        });
    } catch (error) {
        console.error('Error in pipeline (STT -> Translate -> TTS):', error);
        return res.status(500).json({ success: false, message: 'Pipeline error' });
    }
});

module.exports = { router };


