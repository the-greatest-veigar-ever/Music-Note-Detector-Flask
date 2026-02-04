/**
 * Music Note Detector - Main JavaScript Application
 * Handles all frontend functionality
 */

// Global variables
let audioContext = null;
let analyser = null;
let microphone = null;
let isDetecting = false;
let animationId = null;
let noteHistory = [];
let frequencyHistory = [];
const HISTORY_SIZE = 20;
const NOTE_THRESHOLD = 0.6; // Reduced for better voice detection

// UI Hold Configuration
let lastDetectedNote = null;
let lastDetectionTime = 0;
const NOTE_HOLD_DURATION = 1000; // Hold note for 1 second after signal loss

// Voice detection configuration (loosened for better responsiveness)
// Voice detection configuration (tuned for stability and noise rejection)
const VOICE_CONFIG = {
    // Audio thresholds
    MIN_RMS_THRESHOLD: 0.01,        // Very sensitive (was 0.02)
    MAX_RMS_THRESHOLD: 0.95,

    // Zero crossing rate thresholds
    MIN_ZCR: 0.0,
    MAX_ZCR: 0.4,

    // Frequency range for human voice
    MIN_VOICE_FREQ: 65,
    MAX_VOICE_FREQ: 2000,

    // Spectral characteristics
    MIN_SPECTRAL_CENTROID: 150,
    MAX_SPECTRAL_CENTROID: 3000,

    // Confidence and agreement thresholds
    MIN_CONFIDENCE: 0.35,           // Increased to 0.35 (assuming 3.5 was a typo)
    AGREEMENT_THRESHOLD: 0.4,       // More lenient (was 0.6)
    MIN_SAMPLES_BEFORE_DISPLAY: 4,  // Faster display (was 6)

    // Noise rejection
    NOISE_REJECTION_THRESHOLD: 0.1, // Adjusted for lower signals
    CORRELATION_THRESHOLD: 0.45     // Allow breathier tones (was 0.55)
};

let currentFile = null;
// ─────────── PAGINATION STATE ───────────
let analysisResults = [];     // holds the full, unfiltered array
let filteredResults = [];     // holds the subset matching the search (initially the same as analysisResults)
let currentPage = 1;
let pageSize = 20;
let totalPages = 1;



// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
});

function initializeApp() {
    console.log("Initializing App...");
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    themeToggle.addEventListener('click', toggleTheme);

    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // File upload
    initializeFileUpload();

    // Analysis button
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', analyzeAudio);
    }

    // Real-time detection
    initializeRealtimeDetection();
}

// Theme Management
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    // Add transition effect
    document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';

    // Re-render staff to match new theme
    if (staffRenderer) {
        staffRenderer.initialize();
    }

    // Toggle Icons
    const btn = document.getElementById('themeToggle');
    const sun = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');

    if (newTheme === 'dark') {
        sun.style.opacity = '0';
        sun.style.transform = 'rotate(90deg) scale(0.5)';
        setTimeout(() => { sun.style.display = 'none'; }, 200);

        moon.style.display = 'block';
        setTimeout(() => {
            moon.style.opacity = '1';
            moon.style.transform = 'rotate(0) scale(1)';
        }, 50);
    } else {
        moon.style.opacity = '0';
        moon.style.transform = 'rotate(-90deg) scale(0.5)';
        setTimeout(() => { moon.style.display = 'none'; }, 200);

        sun.style.display = 'block';
        setTimeout(() => {
            sun.style.opacity = '1';
            sun.style.transform = 'rotate(0) scale(1)';
        }, 50);
    }
}

// Tab Management (Handled in HTML inline script for simplicity)
// function switchTab(tabName) { ... } 

// File Upload Management

function initializeFileUpload() {
    const uploadArea = document.getElementById('dropZone');
    const fileInput = document.getElementById('audioFile');

    if (!uploadArea || !fileInput) return;

    // Remove the previous click handler and add a proper one
    // The button in the HTML should trigger the file input

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

async function handleFileSelect(file) {
    if (!file) return;

    // Show status
    const statusDiv = document.getElementById('fileInfo');
    statusDiv.innerHTML = `<div style="color: var(--text-secondary)">Uploading ${file.name}...</div>`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const text = await response.text();
        let data;

        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error("Server returned non-JSON:", text);
            throw new Error("Server error: " + (text.substring(0, 50) + "..."));
        }

        if (response.ok && data.success) {
            currentFile = data;
            statusDiv.innerHTML = `<div style="color: #10b981">✓ Upload complete</div>`;
            displayFileInfo(data);
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Upload Error:', error);
        statusDiv.innerHTML = `<div style="color: #ef4444">Error: ${error.message}</div>`;
    }
}

function displayFileInfo(fileData) {
    const fileInfo = document.getElementById('fileInfo');
    if (!fileInfo) return;

    // Create minimal, luxury file info display
    fileInfo.innerHTML = `
        <div style="background: var(--bg-card); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border-color); margin-top: 2rem; display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
            <div style="width: 48px; height: 48px; background: var(--bg-subtle); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">🎵</div>
            <div style="flex: 1; min-width: 200px;">
                <h3 style="margin: 0; font-size: 1rem; font-weight: 600; word-break: break-all;">${fileData.filename}</h3>
                <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">
                    ${fileData.format.toUpperCase()} • ${formatDuration(fileData.duration)} • ${formatFileSize(fileData.file_size)}
                </p>
            </div>
            <audio id="audioPlayer" controls src="/static/uploads/${fileData.filename}" style="height: 36px; opacity: 0.8; flex-shrink: 0; min-width: 300px;"></audio>
        </div>
        
        <div id="analysisSection" style="margin-top: 2rem; display: none;">
             <!-- Placeholder for analysis results if needed -->
        </div>
    `;

    // Show Analyze button
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.style.display = 'inline-flex';
}

async function loadVisualizations(filepath) {
    try {
        const response = await fetch('/visualize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filepath: filepath })
        });

        const data = await response.json();

        if (data.success) {
            createWaveformPlot(data.visualizations.waveform);
            document.getElementById('visualizations').style.display = 'block';
        }
    } catch (error) {
        console.error('Visualization error:', error);
    }
}

function createWaveformPlot(waveformData) {
    const trace = {
        x: waveformData.x,
        y: waveformData.y,
        type: 'scatter',
        mode: 'lines',
        name: 'Waveform',
        line: {
            color: '#7c3aed',
            width: 1
        }
    };

    const xMax = Math.max(...waveformData.x);
    const layout = {
        title: 'Audio Waveform',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: 'var(--text-primary)', size: 12 },

        /* ─── FORCE X-AXIS TO GO FROM 0 → maxTime ─── */
        xaxis: {
            title: 'Time (seconds)',
            range: [0, xMax],
            titlefont: { size: 13, color: 'var(--text-primary)' },
            tickfont: { size: 10, color: '#aaaaaa' },
            /* For tick spacing, choose something like  maxTime/10 seconds */
            dtick: Math.max(1, Math.round(xMax / 10)),
            gridcolor: 'rgba(255,255,255,0.15)',
            zerolinecolor: 'rgba(255,255,255,0.2)'
        },

        yaxis: {
            title: 'Amplitude',
            titlefont: { size: 13, color: 'var(--text-primary)' },
            tickfont: { size: 10, color: '#aaaaaa' },
            dtick: 0.1,
            gridcolor: 'rgba(255,255,255,0.15)',
            zerolinecolor: 'rgba(255,255,255,0.2)'
        },

        margin: {
            l: 60,  // leave space for Y-axis labels
            r: 20,
            t: 40,
            b: 50   // leave space for X-axis labels
        }
    };

    Plotly.newPlot('waveform', [trace], layout, { responsive: true });
}

// Audio Analysis
async function analyzeAudio() {
    if (!currentFile) {
        showNotification('Please upload a file first', 'error');
        return;
    }

    // Default analysis mode if element doesn't exist
    const modeEl = document.getElementById('analysisMode');
    const mode = modeEl ? modeEl.value : 'basic';

    // Dynamic Progress UI
    let progressContainer = document.getElementById('progressContainer');
    let progressBar = document.getElementById('progressBar');
    let progressText = document.getElementById('progressText');

    if (!progressContainer) {
        // Create progress UI if missing
        const resultsDiv = document.getElementById('results') || document.getElementById('fileInfo');
        if (resultsDiv) {
            const pDiv = document.createElement('div');
            pDiv.id = 'progressContainer';
            pDiv.style.marginTop = '1.5rem';
            pDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">
                    <span>Analyzing...</span>
                    <span id="progressText">0%</span>
                </div>
                <div style="height: 6px; background: var(--border-color); border-radius: 99px; overflow: hidden;">
                    <div id="progressBar" style="width: 0%; height: 100%; background: var(--text-main); transition: width 0.3s ease;"></div>
                </div>
            `;
            resultsDiv.appendChild(pDiv);
            progressContainer = pDiv;
            progressBar = pDiv.querySelector('#progressBar');
            progressText = pDiv.querySelector('#progressText');
        }
    }

    // Show progress
    if (progressContainer) progressContainer.style.display = 'block';

    // Monitor progress - Start BEFORE the fetch
    const progressInterval = setInterval(async () => {
        try {
            const progressResponse = await fetch(`/progress/${currentFile.filename}`);
            const progressData = await progressResponse.json();

            if (progressBar) progressBar.style.width = progressData.progress + '%';
            if (progressText) progressText.textContent = `${progressData.progress}%`;
        } catch (e) {
            console.error("Progress poll error:", e);
        }
    }, 800);

    try {
        // Start analysis (Blocking call)
        const response = await fetch('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filepath: currentFile.filepath,
                mode: mode
            })
        });

        const data = await response.json();
        clearInterval(progressInterval);

        if (data.success) {
            // Load visualizations only when analysis is finished
            await loadVisualizations(currentFile.filepath);

            analysisResults = data.results;
            displayResults(data.results);
            showNotification('Analysis completed successfully', 'success');
        } else {
            showNotification(data.error || 'Analysis failed', 'error');
        }
    } catch (error) {
        showNotification('Analysis failed: ' + error.message, 'error');
    } finally {
        if (progressContainer) progressContainer.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
    }
}

function displayResults(results) {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    if (!results || results.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-state" style="padding: 2rem; text-align: center; color: var(--text-secondary);">No notes detected in this file.</div>';
        return;
    }

    analysisResults = results;
    filteredResults = [...results]; // Initialize filtered results
    currentPage = 1;

    renderTablePage();
}

function renderTablePage() {
    const resultsDiv = document.getElementById('results');
    if (!resultsDiv) return;

    const totalPagesCount = Math.ceil(filteredResults.length / pageSize) || 1;
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageResults = filteredResults.slice(start, end);

    // Premium Table Container with Search & Pagination Controls
    resultsDiv.innerHTML = `
        <div style="margin-top: 2rem; animation: slideUp 0.4s ease-out;">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem; gap: 2rem; flex-wrap: wrap;">
                <div>
                    <h2 style="font-family: var(--font-heading); font-size: 1.25rem; margin: 0 0 0.5rem 0;">Analysis Results</h2>
                    <div style="position: relative; width: 280px;">
                        <input type="text" id="timestampSearch" placeholder="Search timestamp (e.g. 00:01)..." 
                            oninput="filterResults(this.value)"
                            style="width: 100%; padding: 0.6rem 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); font-size: 0.9rem; outline: none; transition: border-color 0.2s;"
                            onfocus="this.style.borderColor='var(--text-main)'"
                            onblur="this.style.borderColor='var(--border-color)'"
                        >
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; gap: 1rem; font-size: 0.9rem; color: var(--text-secondary);">
                    <button class="btn btn-ghost" onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} style="padding: 0.5rem 1rem;">Previous</button>
                    <span>Page ${currentPage} of ${totalPagesCount}</span>
                    <button class="btn btn-ghost" onclick="changePage(1)" ${currentPage === totalPagesCount ? 'disabled' : ''} style="padding: 0.5rem 1rem;">Next</button>
                </div>
            </div>
            
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                    <thead>
                        <tr style="background: var(--bg-subtle); border-bottom: 1px solid var(--border-color);">
                            <th style="padding: 1rem; text-align: left; font-weight: 600;">Time</th>
                            <th style="padding: 1rem; text-align: left; font-weight: 600;">Note</th>
                        </tr>
                    </thead>
                    <tbody id="resultsTableBody">
                        ${pageResults.length > 0 ? pageResults.map(r => `
                            <tr style="border-bottom: 1px solid var(--border-color-subtle);">
                                <td style="padding: 1rem; color: var(--text-secondary);">
                                    ${r.timestamp || (r.time !== undefined && r.time !== null ? r.time.toFixed(2) + 's' : '—')}
                                </td>
                                <td style="padding: 1rem; font-family: var(--font-heading); font-weight: 600;">${r.note}</td>
                            </tr>
                        `).join('') : `
                            <tr>
                                <td colspan="2" style="padding: 3rem; text-align: center; color: var(--text-tertiary);">
                                    No results match your search
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Restore focus to search input if it exists
    const searchInput = document.getElementById('timestampSearch');
    if (searchInput && window.lastSearchValue) {
        searchInput.value = window.lastSearchValue;
        searchInput.focus();
        // Move cursor to end
        const len = searchInput.value.length;
        searchInput.setSelectionRange(len, len);
    }
}

function filterResults(query) {
    window.lastSearchValue = query;
    const searchTerm = query.toLowerCase().trim();

    if (!searchTerm) {
        filteredResults = [...analysisResults];
    } else {
        filteredResults = analysisResults.filter(r => {
            const ts = (r.timestamp || "").toLowerCase();
            const timeVal = (r.time !== undefined ? r.time.toString() : "").toLowerCase();
            return ts.includes(searchTerm) || timeVal.includes(searchTerm);
        });
    }

    currentPage = 1;
    renderTablePage();
}

function changePage(delta) {
    const totalPagesCount = Math.ceil(filteredResults.length / pageSize) || 1;
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPagesCount) {
        currentPage = newPage;
        renderTablePage();
        // Scroll to results header
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
    }
}



/**
 * Updates the real-time history list UI.
 */

function updateHistoryUI(note, freq) {
    const list = document.getElementById('historyList');
    const emptyState = document.querySelector('.empty-state');

    if (emptyState && emptyState.style.display !== 'none') {
        emptyState.style.display = 'none';
    }

    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
        <span class="history-note">${note}</span>
        <span class="history-freq">${freq.toFixed(1)} Hz</span>
    `;

    // Insert at top
    list.insertBefore(li, list.firstChild);

    // Limit to 10 items
    if (list.children.length > 10) {
        list.removeChild(list.lastChild);
    }
}

// Real-time Detection
let staffRenderer = null; // SVG Renderer

function initializeRealtimeDetection() {
    console.log("Initializing Realtime Detection...");
    const startBtn = document.getElementById('startDetection');
    const stopBtn = document.getElementById('stopDetection');

    startBtn.addEventListener('click', startRealtimeDetection);
    stopBtn.addEventListener('click', stopRealtimeDetection);

    // Initialize Staff Renderer (Disabled)
    /*
    setTimeout(() => {
        if (document.getElementById('staffSvg')) {
            staffRenderer = new StaffRenderer('staffSvg');
        }
    }, 100);
    */
}

function updateDisplay(frequency, confidence) {
    // Use configuration-based confidence threshold for voice detection
    if (frequency > 0 && confidence > VOICE_CONFIG.MIN_CONFIDENCE) {
        const noteData = frequencyToNote(frequency);

        if (noteData && noteData.note !== '—') {
            // Add to history
            noteHistory.push(noteData.note);
            frequencyHistory.push(frequency);

            // Keep history size limited but require more samples for stability
            if (noteHistory.length > HISTORY_SIZE) {
                noteHistory.shift();
                frequencyHistory.shift();
            }

            // Wait for configured number of samples before displaying
            if (noteHistory.length < VOICE_CONFIG.MIN_SAMPLES_BEFORE_DISPLAY) {
                return;
            }

            // Count occurrences of each note in recent history
            const noteCounts = {};
            // Only consider the last 10 samples for more responsive but stable detection
            const recentNotes = noteHistory.slice(-10);
            recentNotes.forEach(note => {
                noteCounts[note] = (noteCounts[note] || 0) + 1;
            });

            // Find the most common note
            let mostCommonNote = null;
            let maxCount = 0;
            for (const [note, count] of Object.entries(noteCounts)) {
                if (count > maxCount) {
                    maxCount = count;
                    mostCommonNote = note;
                }
            }

            // Require stronger agreement for voice detection
            if (maxCount >= recentNotes.length * VOICE_CONFIG.AGREEMENT_THRESHOLD) {
                document.getElementById('noteDisplay').textContent = mostCommonNote;
                document.getElementById('noteDisplay').style.opacity = '1';

                // Draw Note on Staff
                if (staffRenderer) {
                    staffRenderer.drawNote(mostCommonNote);
                }

                // Update hold state
                lastDetectedNote = mostCommonNote;
                lastDetectionTime = Date.now();

                // Calculate median frequency for stable display
                const recentFreqs = frequencyHistory.slice(-10);
                const sortedFreqs = [...recentFreqs].sort((a, b) => a - b);
                const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
                document.getElementById('freqDisplay').textContent = medianFreq.toFixed(1) + ' Hz';

                // Update History UI (Only if changed or sufficiently periodic - basic debounce for now)
                if (mostCommonNote !== lastDetectedNote) {
                    updateHistoryUI(mostCommonNote, medianFreq);
                }

                // Update confidence bar with smoothed confidence
                const avgConfidence = confidence * 0.3 + (confidence * maxCount / recentNotes.length) * 0.7;
                document.getElementById('confidenceBar').style.width = (avgConfidence * 100) + '%';
            } else {
                // Not enough agreement - don't update display but keep confidence low
                document.getElementById('confidenceBar').style.width = (confidence * 0.3 * 100) + '%';
            }
        }
    } else {
        // More aggressive clearing for noise rejection
        if (confidence < VOICE_CONFIG.NOISE_REJECTION_THRESHOLD) {
            // Remove multiple samples when confidence is very low
            const removals = Math.min(3, noteHistory.length);
            for (let i = 0; i < removals; i++) {
                if (noteHistory.length > 0) {
                    noteHistory.pop();
                    frequencyHistory.pop();
                }
            }

            if (noteHistory.length === 0) {
                // Check if we should hold the note
                if (lastDetectedNote && (Date.now() - lastDetectionTime < NOTE_HOLD_DURATION)) {
                    document.getElementById('noteDisplay').textContent = lastDetectedNote;
                    document.getElementById('noteDisplay').style.opacity = '0.7'; // Visual cue for "holding"

                    // Keep drawing the held note
                    if (staffRenderer) {
                        staffRenderer.drawNote(lastDetectedNote);
                    }
                    // Keep frequency display as is
                } else {
                    document.getElementById('noteDisplay').textContent = '—';
                    document.getElementById('noteDisplay').style.opacity = '1';
                    document.getElementById('freqDisplay').textContent = 'Listening for voice...';
                    lastDetectedNote = null;

                    // Clear Staff
                    if (staffRenderer) {
                        staffRenderer.drawNote(null);
                    }
                }
            }
        }
        document.getElementById('confidenceBar').style.width = '0%';
    }
}

async function startRealtimeDetection() {
    console.log("Start Detection Clicked!");
    try {
        // Update status - using new status label if available
        const freqLabel = document.getElementById('freqDisplay');
        if (freqLabel) freqLabel.textContent = 'Requesting mic access...';

        // Get microphone access with improved settings for voice detection
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,      // Enable echo cancellation for cleaner voice
                autoGainControl: true,       // Enable AGC for consistent levels
                noiseSuppression: true,      // Enable noise suppression for background noise
                latency: 0,
                sampleRate: 44100,           // Higher sample rate for better accuracy
                channelCount: 1              // Mono audio
            }
        });

        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 8192;             // Larger FFT for better frequency resolution
        analyser.smoothingTimeConstant = 0.3; // Less smoothing for more responsive detection

        // Create microphone source
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        // Update UI
        isDetecting = true;
        document.getElementById('startDetection').disabled = true;
        document.getElementById('stopDetection').disabled = false;
        if (freqLabel) {
            freqLabel.textContent = '🎤 Listening...';
            freqLabel.style.color = 'var(--text-main)';
        }

        function detectPitch() {
            if (!isDetecting) return;

            const bufferLength = analyser.fftSize;
            const buffer = new Float32Array(bufferLength);
            analyser.getFloatTimeDomainData(buffer);

            // Simple autocorrelation
            const result = autoCorrelate(buffer, audioContext.sampleRate);

            // Debug logging (remove after testing)
            if (result && result.frequency > 0) {
                console.log(`Detected: ${result.frequency.toFixed(1)} Hz, Confidence: ${result.confidence.toFixed(2)}`);
                updateDisplay(result.frequency, result.confidence);
            } else {
                updateDisplay(-1, 0);
            }

            // Continue detection
            animationId = requestAnimationFrame(detectPitch);
        }
        // Start detection loop
        detectPitch();

        showNotification('Microphone connected successfully', 'success');

    } catch (error) {
        console.error('Microphone error:', error);
        const freqLabel = document.getElementById('freqDisplay');
        if (freqLabel) {
            freqLabel.textContent = 'Error: ' + error.message;
            freqLabel.style.color = 'red';
        }
        showNotification('Microphone access denied or error occurred', 'error');
    }
}

function stopRealtimeDetection() {
    isDetecting = false;

    // Cancel animation frame
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // Stop microphone stream tracks
    if (microphone && microphone.mediaStream) {
        microphone.mediaStream.getTracks().forEach(track => track.stop());
    }

    // Close Audio Context
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => {
            audioContext = null;
            analyser = null;
            microphone = null;
        });
    }

    // Clear history
    noteHistory = [];
    frequencyHistory = [];

    // Disconnect audio nodes
    if (microphone) {
        try { microphone.disconnect(); } catch (e) { }
        microphone = null;
    }

    if (analyser) {
        try { analyser.disconnect(); } catch (e) { }
        analyser = null;
    }

    if (audioContext) {
        try { audioContext.close(); } catch (e) { }
        audioContext = null;
    }

    // Update UI
    document.getElementById('startDetection').disabled = false;
    document.getElementById('stopDetection').disabled = true;
    document.getElementById('noteDisplay').textContent = '—';
    document.getElementById('freqDisplay').textContent = 'Ready to detect';
    document.getElementById('confidenceBar').style.width = '0%';
    const statusMsg = document.getElementById('statusMessage');
    if (statusMsg) {
        statusMsg.textContent = 'Click "Start Detection" to begin';
        statusMsg.className = 'status-message';
    }
}



function detectNotes() {
    if (!isDetecting) return;

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    // Simple autocorrelation for pitch detection
    const result = autoCorrelate(buffer, audioContext.sampleRate);

    if (result.frequency > 0) {
        const note = frequencyToNote(result.frequency);
        document.getElementById('noteDisplay').textContent = note.note;
        document.getElementById('freqDisplay').textContent = `${result.frequency.toFixed(1)} Hz`;
        document.getElementById('confidenceBar').style.width = `${result.confidence * 100}%`;
    }

    // Continue detection
    requestAnimationFrame(detectNotes);
}

function autoCorrelate(buffer, sampleRate) {
    let SIZE = buffer.length;

    // Advanced signal analysis for voice detection
    let sumOfSquares = 0;
    let zeroCrossings = 0;
    let spectralCentroid = 0;

    // Calculate RMS and zero crossings
    for (let i = 0; i < SIZE; i++) {
        sumOfSquares += buffer[i] * buffer[i];
        if (i > 0 && Math.sign(buffer[i]) !== Math.sign(buffer[i - 1])) {
            zeroCrossings++;
        }
    }
    const rootMeanSquare = Math.sqrt(sumOfSquares / SIZE);

    // Enhanced voice activity detection
    // 1. Check if signal level is sufficient for voice
    if (rootMeanSquare < VOICE_CONFIG.MIN_RMS_THRESHOLD || rootMeanSquare > VOICE_CONFIG.MAX_RMS_THRESHOLD) {
        return { frequency: -1, confidence: 0 };
    }

    // 2. Check zero crossing rate (voice typically has moderate ZCR)
    const zeroCrossingRate = zeroCrossings / SIZE;
    if (zeroCrossingRate < VOICE_CONFIG.MIN_ZCR || zeroCrossingRate > VOICE_CONFIG.MAX_ZCR) {
        return { frequency: -1, confidence: 0 };
    }

    // 3. Spectral analysis for voice characteristics (simplified for debugging)
    // Temporarily disabled for testing
    // if (!isVoiceLikeSpectrum(buffer, sampleRate)) {
    //     return { frequency: -1, confidence: 0 };
    // }

    // Pre-emphasis filter to enhance higher frequencies (common in voice processing)
    const filtered = new Float32Array(SIZE);
    filtered[0] = buffer[0];
    for (let i = 1; i < SIZE; i++) {
        filtered[i] = buffer[i] - 0.97 * buffer[i - 1];
    }

    // Autocorrelation with voice-optimized frequency range
    const MIN_SAMPLES = Math.floor(sampleRate / VOICE_CONFIG.MAX_VOICE_FREQ);
    const MAX_SAMPLES = Math.floor(sampleRate / VOICE_CONFIG.MIN_VOICE_FREQ);

    let bestOffset = -1;
    let maxCorrelation = 0;
    let bestCorrelation = 0; // Fixed: Declare this missing variable
    let correlations = new Array(MAX_SAMPLES + 1);

    // 1. First pass: Find the global maximum correlation
    for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;
        let normalizer = 0;

        // Normalized cross-correlation for better accuracy
        for (let i = 0; i < SIZE - offset; i++) {
            correlation += filtered[i] * filtered[i + offset];
            normalizer += filtered[i] * filtered[i];
        }

        if (normalizer > 0) {
            correlation = correlation / normalizer;
        }

        correlations[offset] = correlation;

        if (correlation > maxCorrelation) {
            maxCorrelation = correlation;
        }
    }

    // Much stricter correlation threshold for voice
    if (maxCorrelation < VOICE_CONFIG.CORRELATION_THRESHOLD) {
        return { frequency: -1, confidence: 0 };
    }

    // 2. Second pass: Subharmonic Pruning (Sub-harmonic check)
    // Find the first peak that is "strong enough" (e.g., within 95% of the global max).
    // Tightened to 0.95 to filter out weak harmonics and fix high-pitch errors (e.g. F6 when singing B2).
    let threshold = maxCorrelation * 0.95;

    for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
        if (correlations[offset] >= threshold) {
            // Found the first significant peak (highest frequency fundamental)

            // Local peak check: ensure it's actually a peak
            if (offset > MIN_SAMPLES && offset < MAX_SAMPLES - 1) {
                if (correlations[offset] > correlations[offset - 1] &&
                    correlations[offset] > correlations[offset + 1]) {
                    bestOffset = offset;
                    bestCorrelation = correlations[offset];
                    break; // Stop at the first significant peak (highest frequency)
                }
            }
        }
    }

    // Fallback if no local peak found (shouldn't happen if maxCorrelation > threshold)
    if (bestOffset === -1) {
        // Find the offset corresponding to maxCorrelation
        for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
            if (correlations[offset] === maxCorrelation) {
                bestOffset = offset;
                bestCorrelation = maxCorrelation;
                break;
            }
        }
    }


    // Parabolic interpolation for sub-sample accuracy
    if (bestOffset > MIN_SAMPLES && bestOffset < MAX_SAMPLES - 1) {
        const y1 = correlations[bestOffset - 1];
        const y2 = correlations[bestOffset];
        const y3 = correlations[bestOffset + 1];

        const a = (y1 - 2 * y2 + y3) / 2;
        const b = (y3 - y1) / 2;

        if (a < 0) {
            const xmax = -b / (2 * a);
            bestOffset += xmax;
        }
    }

    const frequency = sampleRate / bestOffset;

    // Final voice frequency validation
    if (frequency < VOICE_CONFIG.MIN_VOICE_FREQ || frequency > VOICE_CONFIG.MAX_VOICE_FREQ) {
        return { frequency: -1, confidence: 0 };
    }

    // Confidence based on correlation strength and voice characteristics
    const voiceConfidence = Math.min(1.0, bestCorrelation * 2.0);

    return { frequency: frequency, confidence: voiceConfidence };
}

// Helper function to detect voice-like spectral characteristics
function isVoiceLikeSpectrum(buffer, sampleRate) {
    const fftSize = 1024;
    const fft = new Float32Array(fftSize);

    // Copy buffer data for FFT (simplified approach)
    for (let i = 0; i < Math.min(fftSize, buffer.length); i++) {
        fft[i] = buffer[i];
    }

    // Calculate spectral centroid (simplified)
    let weightedSum = 0;
    let magnitudeSum = 0;

    for (let i = 1; i < fftSize / 2; i++) {
        const magnitude = Math.abs(fft[i]);
        const frequency = (i * sampleRate) / fftSize;

        weightedSum += frequency * magnitude;
        magnitudeSum += magnitude;
    }

    if (magnitudeSum === 0) return false;

    const spectralCentroid = weightedSum / magnitudeSum;

    // Voice typically has spectral centroid between configured range
    return spectralCentroid >= VOICE_CONFIG.MIN_SPECTRAL_CENTROID &&
        spectralCentroid <= VOICE_CONFIG.MAX_SPECTRAL_CENTROID;
}

function frequencyToNote(frequency) {
    const A4 = 440;
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    if (frequency <= 0) return { note: '—' };

    const semitones = 12 * Math.log2(frequency / A4);
    const noteNumber = Math.round(semitones) + 69; // A4 is MIDI note 69
    const octave = Math.floor(noteNumber / 12) - 1;
    const noteIndex = ((noteNumber % 12) + 12) % 12; // Ensure positive

    return {
        note: noteNames[noteIndex] + octave,
        cents: Math.round((semitones - Math.round(semitones)) * 100)
    };
}

// Utility Functions
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${minutes}:${secs.padStart(4, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

function showLoading(message = 'Loading...') {
    const loading = document.createElement('div');
    loading.id = 'loadingOverlay';
    loading.innerHTML = `
        <div class="loading-content">
            <div class="loading"></div>
            <p>${message}</p>
        </div>
    `;
    document.body.appendChild(loading);
}

function hideLoading() {
    const loading = document.getElementById('loadingOverlay');
    if (loading) {
        loading.remove();
    }
}

// Add notification styles
const notificationStyles = `
.notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    z-index: 9999;
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.notification.success {
    background: #10b981;
    color: white;
}

.notification.error {
    background: #ef4444;
    color: white;
}

.notification.info {
    background: #3b82f6;
    color: white;
}

#loadingOverlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}

.loading-content {
    text-align: center;
    color: white;
}

.loading-content p {
    margin-top: 1rem;
    font-size: 1.125rem;
}
`;

// Add styles to page
const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);