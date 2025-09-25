process.env.GOOGLE_APPLICATION_CREDENTIALS;

const express = require('express');
const fs = require('fs');
const path = require('path');
const { TranslationServiceClient } = require('@google-cloud/translate').v3;

const translateClient = new TranslationServiceClient();

async function translate_Text(text, targetLanguage, sourceLanguage) {
	if (!text || !targetLanguage) {
		throw new Error('Missing required parameters: text and targetLanguage');
	}

	const location = 'global';
	const projectId = await translateClient.getProjectId();
	const request = {
		parent: `projects/${projectId}/locations/${location}`,
		contents: [text],
		mimeType: 'text/plain',
		targetLanguageCode: targetLanguage
	};
	if (sourceLanguage) request.sourceLanguageCode = sourceLanguage;

	const [response] = await translateClient.translateText(request);
	const translations = (response.translations || []);
	const translatedText = translations.map(t => t.translatedText || '').join('\n');
	return translatedText;
}

async function detect_Language(text) {
    if (!text) return undefined;
    const location = 'global';
    const projectId = await translateClient.getProjectId();
    const request = {
        parent: `projects/${projectId}/locations/${location}`,
        content: text,
    };
    const [response] = await translateClient.detectLanguage(request);
    const languages = (response.languages || []);
    // Pick the highest confidence language
    const best = languages.sort((a, b) => (Number(b.confidence || 0) - Number(a.confidence || 0)))[0];
    return best && best.languageCode ? best.languageCode : undefined;
}

const router = express.Router();
router.use(express.json({ limit: '5mb' }));

router.post('/translate', async (req, res) => {
	try {
		const { text, targetLanguage, sourceLanguage } = req.body || {};
		if (!text || !targetLanguage) {
			return res.status(400).json({ success: false, message: 'Missing required fields: text, targetLanguage' });
		}
		const translatedText = await translate_Text(text, targetLanguage, sourceLanguage);
		return res.json({ success: true, translatedText });
	} catch (error) {
		console.error('Error translating text:', error);
		return res.status(500).json({ success: false, message: 'Error translating text' });
	}
});

router.post('/translate-to-file', async (req, res) => {
	try {
		const {
			text,
			inputFilePath,
			targetLanguage,
			sourceLanguage,
			outputDir,
			outputFileName
		} = req.body || {};

		if ((!text && !inputFilePath) || !targetLanguage) {
			return res.status(400).json({ success: false, message: 'Missing required fields: (text or inputFilePath) and targetLanguage' });
		}

		const serverRoot = path.join(__dirname, '..');
		let inputText = text;
		if (!inputText && inputFilePath) {
			const absInputPath = path.isAbsolute(inputFilePath) ? inputFilePath : path.join(serverRoot, inputFilePath);
			if (!fs.existsSync(absInputPath)) {
				return res.status(404).json({ success: false, message: `Input file not found: ${absInputPath}` });
			}
			inputText = fs.readFileSync(absInputPath, 'utf8');
		}

		const translatedText = await translate_Text(inputText, targetLanguage, sourceLanguage);

		const defaultOutDir = path.join(serverRoot, 'uploads', 'translated');
		const finalOutDir = outputDir ? (path.isAbsolute(outputDir) ? outputDir : path.join(serverRoot, outputDir)) : defaultOutDir;
		if (!fs.existsSync(finalOutDir)) {
			fs.mkdirSync(finalOutDir, { recursive: true });
		}

		const fileBase = outputFileName && outputFileName.trim().length > 0
			? outputFileName.trim()
			: `translated_${Date.now()}_${targetLanguage}.txt`;
		const absOutputPath = path.join(finalOutDir, fileBase);
		fs.writeFileSync(absOutputPath, translatedText, 'utf8');

		let publicUrl = null;
		const uploadsDir = path.join(serverRoot, 'uploads');
		if (absOutputPath.startsWith(uploadsDir)) {
			publicUrl = '/uploads' + absOutputPath.substring(uploadsDir.length).replace(/\\/g, '/');
		}

		return res.json({
			success: true,
			translatedText,
			absolutePath: absOutputPath,
			fileUrl: publicUrl
		});
	} catch (error) {
		console.error('Error translating text to file:', error);
		return res.status(500).json({ success: false, message: 'Error translating text to file' });
	}
});

module.exports = { translate_Text, detect_Language, router };


