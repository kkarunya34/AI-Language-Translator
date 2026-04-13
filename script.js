document.addEventListener('DOMContentLoaded', () => {
    // --- State and UI Elements ---
    const targetLanguageSelect = document.getElementById('targetLanguage');
    
    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    // Text Tab Elements
    const textInput = document.getElementById('textInput');
    const translateTextBtn = document.getElementById('translateTextBtn');
    const textOutput = document.getElementById('textOutput');

    // Audio Tab Elements
    const recordBtn = document.getElementById('recordBtn');
    const micContainer = document.getElementById('micContainer');
    const recordingStatus = document.getElementById('recordingStatus');
    const audioProcessingSteps = document.getElementById('audioProcessingSteps');
    const audioResults = document.getElementById('audioResults');
    const audioTranscribed = document.getElementById('audioTranscribed');
    const audioTranslated = document.getElementById('audioTranslated');
    const audioPlayback = document.getElementById('audioPlayback');

    // Video Tab Elements
    const dropZone = document.getElementById('dropZone');
    const videoFileInput = document.getElementById('videoFileInput');
    const selectedFileInfo = document.getElementById('selectedFileInfo');
    const fileNameDisplay = document.getElementById('fileName');
    const removeVideoBtn = document.getElementById('removeVideoBtn');
    const processVideoBtn = document.getElementById('processVideoBtn');
    const videoProcessingSteps = document.getElementById('videoProcessingSteps');
    const videoResult = document.getElementById('videoResult');
    const videoPlayback = document.getElementById('videoPlayback');
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');

    // --- Tab Switching Logic ---
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // --- Helper for SSE Steps ---
    const generateClientId = () => Math.random().toString(36).substring(2, 15);
    
    const updateSteps = (containerId, currentStep) => {
        const container = document.getElementById(containerId);
        if(!container) return;
        
        container.classList.remove('hidden');
        const steps = container.querySelectorAll('.step');
        const lines = container.querySelectorAll('.step-line');
        let reachedCurrent = false;

        steps.forEach((step, index) => {
            const stepId = step.id.split('-').pop(); // e.g., 'upload'
            
            if (!reachedCurrent) {
                step.classList.add('completed');
                step.classList.remove('active');
                if (index < lines.length) lines[index].classList.add('completed');
            } else {
                step.classList.remove('completed', 'active');
                if (index < lines.length) lines[index].classList.remove('completed');
            }
            
            if (stepId === currentStep) {
                step.classList.remove('completed');
                step.classList.add('active');
                reachedCurrent = true;
            }
        });
        
        if(currentStep === 'completed') {
            steps.forEach(s => { s.classList.add('completed'); s.classList.remove('active'); });
            lines.forEach(l => l.classList.add('completed'));
            setTimeout(() => {
                container.classList.add('hidden');
            }, 3000);
        }
    };

    const resetSteps = (containerId) => {
        const container = document.getElementById(containerId);
        container.querySelectorAll('.step').forEach(s => s.classList.remove('completed', 'active'));
        container.querySelectorAll('.step-line').forEach(l => l.classList.remove('completed'));
    };

    // --- 1. Text Translation Logic ---
    translateTextBtn.addEventListener('click', async () => {
        const text = textInput.value.trim();
        const targetLanguage = targetLanguageSelect.value;

        if (!text) return alert("Please enter text to translate");

        // UI Loading State
        translateTextBtn.classList.add('disabled');
        translateTextBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Translating...';
        textOutput.innerHTML = '<p class="placeholder-text"><i class="fa-solid fa-wave-square fa-fade"></i> Processing translation...</p>';

        try {
            const response = await fetch('/api/translate-text', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, targetLanguage })
            });
            const data = await response.json();
            
            if (data.success) {
                textOutput.innerHTML = `<p>${data.translatedText}</p>`;
            } else {
                throw new Error(data.message || 'Translation failed');
            }
        } catch (err) {
            textOutput.innerHTML = `<p style="color: var(--error)">Error: ${err.message}</p>`;
        } finally {
            translateTextBtn.classList.remove('disabled');
            translateTextBtn.innerHTML = '<span>Translate</span><i class="fa-solid fa-arrow-right"></i>';
        }
    });

    // --- 2. Live Audio Translation Logic ---
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    recordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            // Start Recording
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = e => {
                    if (e.data.size > 0) audioChunks.push(e.data);
                };

                mediaRecorder.onstop = processAudio;

                mediaRecorder.start();
                isRecording = true;
                micContainer.classList.add('recording');
                recordingStatus.innerHTML = '<span style="color:var(--accent)"><i class="fa-solid fa-circle fa-beat"></i> Recording... Click to stop</span>';
                audioResults.classList.add('hidden');
                resetSteps('audioProcessingSteps');
            } catch (err) {
                alert("Microphone access denied or unavailable.");
                console.error(err);
            }
        } else {
            // Stop Recording
            mediaRecorder.stop();
            isRecording = false;
            micContainer.classList.remove('recording');
            recordingStatus.textContent = 'Processing Audio...';
            // Stop all tracks to release mic
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    });

    const processAudio = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const formData = new FormData();
        const clientId = generateClientId();
        const targetLanguage = targetLanguageSelect.value;
        
        formData.append('audio', audioBlob, 'recording.wav');
        formData.append('clientId', clientId);
        formData.append('targetLanguage', targetLanguage);

        audioProcessingSteps.classList.remove('hidden');
        recordBtn.disabled = true;

        // Listen for SSE updates
        const eventSource = new EventSource(`/api/status/${clientId}`);
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            updateSteps('audioProcessingSteps', data.step);
            if (data.step === 'completed' || data.step === 'error') eventSource.close();
        };

        try {
            const response = await fetch('/api/translate-audio', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (data.success) {
                audioTranscribed.textContent = data.transcribedText;
                audioTranslated.textContent = data.translatedText;
                audioPlayback.src = data.audioUrl;
                audioResults.classList.remove('hidden');
                recordingStatus.textContent = 'Ready to record';
            } else {
                throw new Error(data.message);
            }
        } catch (err) {
            recordingStatus.innerHTML = `<span style="color:var(--error)">Error: ${err.message}</span>`;
            updateSteps('audioProcessingSteps', 'error');
        } finally {
            recordBtn.disabled = false;
        }
    };

    // --- 3. Video Translation Logic ---
    let selectedVideoFile = null;

    // Drag and Drop handlers
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) handleVideoSelection(files[0]);
    });

    videoFileInput.addEventListener('change', function() {
        if (this.files.length) handleVideoSelection(this.files[0]);
    });

    const handleVideoSelection = (file) => {
        if (!file.type.startsWith('video/')) {
            return alert('Please select a valid video file.');
        }
        selectedVideoFile = file;
        fileNameDisplay.textContent = file.name;
        dropZone.querySelector('.upload-content').classList.add('hidden');
        selectedFileInfo.classList.remove('hidden');
        processVideoBtn.classList.remove('disabled');
        videoResult.classList.add('hidden');
    };

    removeVideoBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent triggering file input
        selectedVideoFile = null;
        videoFileInput.value = '';
        dropZone.querySelector('.upload-content').classList.remove('hidden');
        selectedFileInfo.classList.add('hidden');
        processVideoBtn.classList.add('disabled');
    });

    processVideoBtn.addEventListener('click', async () => {
        if (!selectedVideoFile || processVideoBtn.classList.contains('disabled')) return;

        const formData = new FormData();
        const clientId = generateClientId();
        const targetLanguage = targetLanguageSelect.value;
        
        formData.append('video', selectedVideoFile);
        formData.append('clientId', clientId);
        formData.append('targetLanguage', targetLanguage);

        processVideoBtn.classList.add('disabled');
        processVideoBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
        videoProcessingSteps.classList.remove('hidden');
        resetSteps('videoProcessingSteps');
        videoResult.classList.add('hidden');

        // Listen for SSE updates
        const eventSource = new EventSource(`/api/status/${clientId}`);
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            updateSteps('videoProcessingSteps', data.step);
            if (data.step === 'completed' || data.step === 'error') eventSource.close();
        };

        try {
            const response = await fetch('/api/translate', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (data.success) {
                videoPlayback.src = data.videoUrl;
                downloadVideoBtn.href = data.videoUrl;
                videoResult.classList.remove('hidden');
            } else {
                throw new Error(data.message);
            }
        } catch (err) {
            alert(`Video processing failed: ${err.message}`);
            updateSteps('videoProcessingSteps', 'error');
        } finally {
            processVideoBtn.classList.remove('disabled');
            processVideoBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Translate Video';
        }
    });
});
