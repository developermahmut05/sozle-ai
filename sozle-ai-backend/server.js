import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(cors({ origin: "*" }));
app.use(express.static(path.join(__dirname, '../sozle-ai-frontend')));

// Uploads papkasy ýok bolsa döretmek
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Gemini API Açaryny barlamak
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY tapylmady!");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Multer sazlamasy (Ses faýllary üçin)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'sozle-ai-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // Iň köp 15 MB
});

const systemInstructionSozleAI = `
### ROLE & IDENTITY
Seniň adyň: Sözle AI. 
Sen dünýädäki ähli diller arasyndaky terjime, düşündiriş we sesli/ýazmaça transkripsiýa boýunça ýöriteleşen hünärmen emeli aň ulgamydyryn. Ulanyjy islendik dilde ýazmaça ýa-da sesli (audio) sorag berip biler, olaryň ikisini hem doly we dogry düşünip bilersiň.

### 1. SALAMLAŞYK DÜZGÜNI (STRICT PRIORITY 1)
- ŞERT: Ulanyjy islendik dilde (ýazmaça ýa-da sesli) salamlaşyk sözlerini ýazsa ýa-da aýtsa:
- JOGAP: "Salam! Men Sözle AI atly hünärmen terjimeçi we dil kömekçisi. Men dünýädäki ähli diller arasynda terjime etmek, sözleriň manysyny düşündirmek hem-de dil öwrenmäge ýardam etmek üçin döredilen emeli aň ulgamydyryn. Size nähili kömek edip bilerin?"

### 2. ÖZI BARADA SORALSA (STRICT PRIORITY 2)
- ŞERT: Ulanyjy "Sen kim?", "Özüň barada aýt", "Adyň näme?" diýen ýaly soraglar berse:
- JOGAP: "Men Sözle AI atly hünärmen terjimeçi we dil kömekçisi. Men dünýädäki ähli diller arasynda takyk we tebigy terjimeleri amala aşyrmak hem-de dil bilimi boýunça maslahat bermek üçin niýetlenen emeli aň ulgamydyryn. Size nähili kömek edip bilerin?"

### 3. ÇEŞME ÝA-DA KÄDILER BARADA SORALSA
- ŞERT: Ulanyjy çeşme barada sorasa:
- JOGAP: "Men Sözle AI atly hünärmen terjimeçi. Men maglumatlarymy we terjime kadalarymy ynamly lingwistik çeşmelere, halkara diller arasyndaky grammatik we leksik ensiklopediyalara esaslanyp berýärin. Size nähili kömek edip bilerin?"

### 4. MOWZUKDAN DAŞARY (OUT-OF-SCOPE) SORAGLAR
- ŞERT: Eger sorag dillere, terjimege ya-da AI-yň özüne hiç hili degişli bolmasa:
- JOGAP: "Hormatly ulanyjy, men Sözle AI atly hünärmen terjimeçisiyim. Men diňe dünýädäki ähli diller arasyndaky terjimeler we dil soraglary boýunça ýöriteleşenim sebäpli, siziň soran bu soragyňyz boýunça maglumat berip bilmeýärin."

### 5. TERJIME WE DIL SORAGLARY (GÖNI WE TAKYK)
- ŞERT: Ulanyjy islendik sözüň, sözlemiň terjimesini sorasa (ýazmaça ýa-da sesli):
- PROTOKOL: Soralan sözüň ýa-da sözlemiň beýleki dildäki göni we takyk terjimesini dury ýaz. Artykmaç başlyklary ulanma.

### TEKNIKI FORMAT (STRICT JSON)
Jogaby bereniňde açyk markdown kod bloklaryny ulanma. Diňe arassa JSON formatyny ulan:
{
  "text": "Terjime edilen söz, sözlem ýa-da jogap",
  "translations": ["Terjime edilen esasy söz"]
}
`;

function parseAIResponse(rawText) {
    if (!rawText) return { text: "Ýalňyşlyk ýüze çykdy.", translations: [] };
    
    let cleanedText = rawText.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
    
    try {
        const parsed = JSON.parse(cleanedText);
        return {
            text: parsed.text || rawText,
            translations: parsed.translations || []
        };
    } catch (e) {
        let formattedText = rawText
            .replace(/TERJIME EDILENI:\s*/gi, "")
            .replace(/GRAMMATIK BÖLÜMI:\s*/gi, "\n\nGrammatika: ")
            .replace(/ULANYLYŞ MYSALLY:\s*/gi, "\n\nMysallar: ");

        return {
            text: formattedText.trim(),
            translations: []
        };
    }
}

// 0️⃣ TEKST CHAT ENDPOINTİ
app.post("/api/chat", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ success: false, error: "Prompt ýok!" });
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Ulanyjynyň soragy / Tapsyrygy: "${prompt}". Munuň terjimesini ýa-da degişli jogabyny ber.`,
            config: {
                systemInstruction: systemInstructionSozleAI,
            }
        });

        const rawText = response.text || "";
        const parsed = parseAIResponse(rawText);

        return res.status(200).json({
            success: true,
            response: parsed.text,
            translations: parsed.translations
        });
    } catch (error) {
        console.error("Chat API ýalňyşlygy:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// 1️⃣ Sesli habar ugratmak we Terjime / Jogap almak üçin Endpoint
app.post("/api/upload-audio", upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Ses faýly tapylmady!" });
        }

        filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Audio = fileBuffer.toString("base64");
        const mimeType = req.file.mimetype && req.file.mimetype !== 'application/octet-stream' 
            ? req.file.mimetype 
            : "audio/webm";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: mimeType
                    }
                },
                { 
                    text: "Bu ses faýlyndaky soragy ýa-da sözleri diňläp, systemInstruction kadalaryna laýyklykda terjime et we jogap taýýarla." 
                }
            ],
            config: {
                systemInstruction: systemInstructionSozleAI,
            }
        });

        const parsed = parseAIResponse(response.text);

        return res.status(200).json({
            success: true,
            message: "Ses üstünlikli terjime edildi!",
            filename: req.file.filename,
            response: parsed.text,
            translations: parsed.translations
        });

    } catch (error) {
        console.error("Ses ýükleme ýa-da AI ýalňyşlygy:", error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

// 2️⃣ Ses ýazgy / Diktofon düwmesi üçin Aýratyn Endpoint
app.post("/api/dictate-audio", upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Ses faýly tapylmady!" });
        }

        filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Audio = fileBuffer.toString("base64");
        const mimeType = req.file.mimetype && req.file.mimetype !== 'application/octet-stream' 
            ? req.file.mimetype 
            : "audio/webm";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    inlineData: {
                        data: base64Audio,
                        mimeType: mimeType
                    }
                },
                { 
                    text: "Bu ses faýlynda ulanyjynyň aýdan sözlerini haýsy dilde gürländigine garamazdan HİÇ HİLİ TERJİME ETMÄN, göni asyl dildäki aýdylyşy bilen takyk tekste öwür. Jogaby arassa JSON formatynda şeýle ber: {\"transcription\": \"eşidilen sözlerin asyl dildäki takyk tekst ýazuwy\"}" 
                }
            ]
        });

        let responseText = response.text || "";
        let cleanedText = responseText.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
        let transcribedText = "";
        try {
            const parsed = JSON.parse(cleanedText);
            transcribedText = parsed.transcription || "";
        } catch (e) {
            transcribedText = responseText.trim();
        }

        return res.status(200).json({
            success: true,
            transcription: transcribedText
        });

    } catch (error) {
        console.error("Sesli ýazgy ýalňyşlygy:", error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

let recognition;
let isRecording = false;

function toggleDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert("Siziň brauzeriňiz göni sesli ýazgyny goldanok!");
        return;
    }

    const inputField = document.getElementById('girisTeksti'); // Öz inputyňyzyň ID-si

    if (!isRecording) {
        recognition = new SpeechRecognition();
        recognition.lang = 'tk-TM'; // Türkmen dili
        recognition.continuous = false; 
        recognition.interimResults = true; // Okap durkäň göni ekranda görkezmek

        recognition.onstart = () => {
            isRecording = true;
            console.log("Sesli ýazgy başlandy...");
        };

        recognition.onresult = (event) => {
            let interimText = '';
            let finalText = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalText += event.results[i][0].transcript;
                } else {
                    interimText += event.results[i][0].transcript;
                }
            }

            if (inputField) {
                inputField.value = finalText || interimText;
            }
        };

        recognition.onerror = (event) => {
            console.error("Ýalňyşlyk:", event.error);
            isRecording = false;
        };

        recognition.onend = () => {
            isRecording = false;
            console.log("Ses gutarandygy üçin awtomatiki ugradylýar...");
            
            // Ses gutaranda awtomatiki işleýän funksiýa (Meselem: barlag ýa-da API ugratmak)
            if (inputField && inputField.value.trim() !== "") {
                // textiBarla(); ýa-da API çagyryşy
            }
        };

        recognition.start();
    } else {
        recognition.stop();
    }
}
function startServer() {
    app.listen(PORT, () => {
        console.log(` 'Sözle AI' localhost:${PORT} salgysynda işe başlady!`);
    });
}

startServer();