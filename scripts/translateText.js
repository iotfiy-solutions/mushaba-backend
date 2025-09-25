// Google Cloud credentials are handled in the service files

const fs = require('fs');
const path = require('path');
const { translate_Text } = require('../services/Translate');

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 2) {
		console.error('Usage: node scripts/translateText.js <targetLanguage> <inputFilePath or "-"> [<outputFilePath>] [<sourceLanguage>]');
		process.exit(1);
	}

	const targetLanguage = args[0];
	const inputSpecifier = args[1];
	const outputPathArg = args[2];
	const sourceLanguage = args[3];

	let inputText = '';
	if (inputSpecifier === '-') {
		inputText = await new Promise((resolve) => {
			let data = '';
			process.stdin.setEncoding('utf8');
			process.stdin.on('data', chunk => data += chunk);
			process.stdin.on('end', () => resolve(data));
		});
	} else {
		const absInputPath = path.isAbsolute(inputSpecifier)
			? inputSpecifier
			: path.join(__dirname, '..', inputSpecifier);
		if (!fs.existsSync(absInputPath)) {
			console.error(`Input file not found: ${absInputPath}`);
			process.exit(1);
		}
		inputText = fs.readFileSync(absInputPath, 'utf8');
	}

	const translatedText = await translate_Text(inputText, targetLanguage, sourceLanguage);

	if (outputPathArg) {
		const absOut = path.isAbsolute(outputPathArg)
			? outputPathArg
			: path.join(__dirname, '..', outputPathArg);
		fs.mkdirSync(path.dirname(absOut), { recursive: true });
		fs.writeFileSync(absOut, translatedText, 'utf8');
		console.log(absOut);
	} else {
		process.stdout.write(translatedText);
	}
}

main().catch(err => {
	console.error('Translation failed:', err);
	process.exit(1);
});


