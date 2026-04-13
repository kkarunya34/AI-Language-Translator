const gTTS = require('gtts');
const fs = require('fs');

const testTTS = () => {
    return new Promise((resolve, reject) => {
        const text = "Hello this is a test of the audio.";
        const gtts = new gTTS(text, 'en');
        gtts.save('test_gtts.mp3', (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

testTTS().then(() => {
    const stats = fs.statSync('test_gtts.mp3');
    console.log("File size:", stats.size);
}).catch(console.error);
