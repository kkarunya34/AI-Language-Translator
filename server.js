const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const { translate } = require('@vitalets/google-translate-api');
let transcriber = null;
const initTranscriber = async () => {
    if (!transcriber) {
        // dynamically import the ESM module
        const { pipeline } = await import('@xenova/transformers');
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    }
    return transcriber;
};
initTranscriber().catch(console.error); // start loading model on boot
const gTTS = require('gtts');
const cors = require('cors');

const app = express();
const port = 3000;

// Setup directories
const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static('frontend')); // Serve static frontend files
app.use('/outputs', express.static('outputs')); // Serve output videos

// In-memory store for Server-Sent Events clients
const clients = new Map();

// SSE endpoint
app.get('/api/status/:clientId', (req, res) => {
    const { clientId } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    clients.set(clientId, res);

    req.on('close', () => {
        clients.delete(clientId);
    });
});

// Helper to send status updates
const sendStatus = (clientId, step) => {
    const res = clients.get(clientId);
    if (res) {
        res.write(`data: ${JSON.stringify({ step })}\n\n`);
    } else {
        console.log(`Client ${clientId} not found for status update: ${step}`);
    }
};

// --- Helper Functions mapped to processing steps ---

const extractAudio = (videoPath, audioPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .noVideo()
            .audioChannels(1)
            .audioFrequency(16000)
            .format('wav')
            .on('end', () => resolve(audioPath))
            .on('error', (err) => reject(err))
            .save(audioPath);
    });
};

const performSpeechToText = async (audioPath) => {
    const { WaveFile } = require('wavefile');
    const buffer = fs.readFileSync(audioPath);
    const wav = new WaveFile(buffer);
    wav.toBitDepth('32f'); 
    wav.toSampleRate(16000); 
    
    let audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
      if (audioData.length > 1) {
        const SCALING_FACTOR = Math.sqrt(2);
        for (let i = 0; i < audioData[0].length; ++i) {
          audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
        }
      }
      audioData = audioData[0]; 
    }
    
    const tr = await initTranscriber();
    // Use chunk_length_s to process the entire audio file sequentially without truncating at 30 seconds
    let output = await tr(audioData, { chunk_length_s: 30, stride_length_s: 5 });
    return output.text;
};

const translateText = async (text, targetLanguage) => {
    try {
        const result = await translate(text, { to: targetLanguage });
        return result.text;
    } catch (error) {
        console.error("Translation Error:", error);
        throw error;
    }
};

const generateSpeech = (text, language, audioPath) => {
    return new Promise((resolve, reject) => {
        // gTTS supports short language codes like 'en', 'es', 'fr', etc.
        const gtts = new gTTS(text, language.split('-')[0]); // Split in case of zh-cn or similar
        gtts.save(audioPath, (err) => {
            if (err) reject(err);
            else resolve(audioPath);
        });
    });
};

const mergeAudioAndVideo = (originalVideoPath, newAudioPath, outputVideoPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(originalVideoPath)
            .input(newAudioPath)
            .outputOptions([
                '-c:v copy',      // Copy video codec to maintain quality and speed
                '-c:a aac',       // Use AAC for audio codec
                '-b:a 192k',      // Enforce audio bitrate
                '-ac 2',          // Ensure output is stereo (fixes some browser muting issues)
                '-map 0:v:0',     // Map only the video from the first input
                '-map 1:a:0'      // Map only the audio from the second input
                // Removed -shortest to prevent the video from being cut if the TTS audio is faster than the original video
            ])
            .on('end', () => resolve(outputVideoPath))
            .on('error', (err) => reject(err))
            .save(outputVideoPath);
    });
};

// Main Processing Endpoint
app.post('/api/translate', upload.single('video'), async (req, res) => {
    const clientId = req.body.clientId;
    let targetLanguage = req.body.targetLanguage || 'en';
    
    if (!req.file || !clientId) {
        return res.status(400).json({ success: false, message: 'Missing file or client ID' });
    }

    // Adjust target language for TTS and Translation compatibility
    // `gTTS` and `@vitalets/google-translate-api` use slightly different codes sometimes.
    if(targetLanguage === 'zh-cn') targetLanguage = 'zh-CN'; 

    const videoId = uuidv4();
    const originalVideoPath = req.file.path;
    
    const extractedAudioPath = path.join(uploadsDir, `${videoId}_extracted.wav`);
    const translatedAudioPath = path.join(uploadsDir, `${videoId}_translated.mp3`);
    const outputVideoFilename = `${videoId}_output.mp4`;
    const outputVideoPath = path.join(outputsDir, outputVideoFilename);

    try {
        sendStatus(clientId, 'upload'); // Actually uploaded now, but we'll show status

        // Step 1: Extract Audio
        sendStatus(clientId, 'extract');
        await extractAudio(originalVideoPath, extractedAudioPath);
        console.log(`Audio extracted: ${extractedAudioPath}`);

        // Step 2: Speech-to-Text
        sendStatus(clientId, 'stt');
        const text = await performSpeechToText(extractedAudioPath);
        console.log(`Transcription: ${text}`);

        // Step 3: Translate Text
        sendStatus(clientId, 'translate');
        const translatedText = await translateText(text, targetLanguage);
        console.log(`Translated text (${targetLanguage}): ${translatedText}`);

        // Step 4: Text-to-Speech
        sendStatus(clientId, 'tts');
        await generateSpeech(translatedText, targetLanguage, translatedAudioPath);
        console.log(`Speech generated: ${translatedAudioPath}`);

        // Step 5: Merge Audio and Video
        sendStatus(clientId, 'merge');
        await mergeAudioAndVideo(originalVideoPath, translatedAudioPath, outputVideoPath);
        console.log(`Video processing complete: ${outputVideoPath}`);

        sendStatus(clientId, 'completed');
        
        // Clean up temporary files asynchronously
        fs.unlink(originalVideoPath, () => {});
        fs.unlink(extractedAudioPath, () => {});
        fs.unlink(translatedAudioPath, () => {});

        res.json({
            success: true,
            videoUrl: `/outputs/${outputVideoFilename}`
        });

    } catch (error) {
        console.error("Processing Pipeline Error:", error);
        sendStatus(clientId, 'error');
        res.status(500).json({ success: false, message: error.message });
    }
});

// Text Translation Endpoint
app.post('/api/translate-text', async (req, res) => {
    let { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) return res.status(400).json({ success: false, message: 'Missing text or target language' });
    if(targetLanguage === 'zh-cn') targetLanguage = 'zh-CN'; 
    try {
        const translatedText = await translateText(text, targetLanguage);
        res.json({ success: true, translatedText });
    } catch (error) {
        console.error("Text Translation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Live Audio Translation Endpoint
app.post('/api/translate-audio', upload.single('audio'), async (req, res) => {
    const clientId = req.body.clientId;
    let targetLanguage = req.body.targetLanguage || 'en';
    if (!req.file || !clientId) return res.status(400).json({ success: false, message: 'Missing audio or client ID' });
    if(targetLanguage === 'zh-cn') targetLanguage = 'zh-CN'; 

    const audioId = uuidv4();
    const originalAudioPath = req.file.path;
    const extractedWavPath = path.join(uploadsDir, `${audioId}_extracted.wav`);
    const translatedAudioPath = path.join(outputsDir, `${audioId}_translated.mp3`);

    try {
        sendStatus(clientId, 'upload');
        sendStatus(clientId, 'extract');
        await extractAudio(originalAudioPath, extractedWavPath);

        sendStatus(clientId, 'stt');
        const text = await performSpeechToText(extractedWavPath);

        sendStatus(clientId, 'translate');
        const translatedText = await translateText(text, targetLanguage);

        sendStatus(clientId, 'tts');
        await generateSpeech(translatedText, targetLanguage, translatedAudioPath);

        sendStatus(clientId, 'completed');
        
        fs.unlink(originalAudioPath, () => {});
        fs.unlink(extractedWavPath, () => {});

        res.json({
            success: true,
            transcribedText: text,
            translatedText: translatedText,
            audioUrl: `/outputs/${audioId}_translated.mp3`
        });
    } catch (error) {
        console.error("Audio Pipeline Error:", error);
        sendStatus(clientId, 'error');
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(port, () => {
    console.log(`AI Video Translator running at http://localhost:${port}`);
});
