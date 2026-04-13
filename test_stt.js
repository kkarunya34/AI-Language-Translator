const processAudio = async () => {
    const fs = require('fs');
    const { WaveFile } = require('wavefile');
    
    // We will dynamically import the ESM module
    const { pipeline } = await import('@xenova/transformers');
    
    console.log("Loading model...");
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
    
    console.log("Reading audio...");
    // create a dummy 2 second WAV file to test
    const dummyPath = 'test_audio.wav';
    
    if(!fs.existsSync(dummyPath)) {
        // Just fail if not exists
        console.log("No test_audio.wav found");
        return;
    }

    let buffer = fs.readFileSync(dummyPath);
    let wav = new WaveFile(buffer);
    wav.toBitDepth('32f'); // float32
    wav.toSampleRate(16000); // 16kHz
    
    let audioData = wav.getSamples();
    if (Array.isArray(audioData)) {
      if (audioData.length > 1) {
        const SCALING_FACTOR = Math.sqrt(2);
        // Merge channels for mono
        for (let i = 0; i < audioData[0].length; ++i) {
          audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
        }
      }
      audioData = audioData[0]; // Take only the first channel
    }

    console.log("Transcribing...");
    let output = await transcriber(audioData);
    console.log("Transcription:", output.text);
};

processAudio().catch(console.error);
