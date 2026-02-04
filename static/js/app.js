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
    MAX_VOICE_FREQ: 1200,

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
    analyzeBtn.addEventListener('click', analyzeAudio);

    // Real-time detection
    initializeRealtimeDetection();

    // Search functionality
    const searchInput = document.getElementById('searchTime');
    searchInput.addEventListener('input', filterResults);
    // ─── PAGINATION EVENTS ───
    const pageSizeSelect = document.getElementById('pageSize');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');

    // When the user changes “items per page”
    pageSizeSelect.addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value, 10);
        currentPage = 1;

        // Recompute totalPages and re-render
        totalPages = Math.ceil(analysisResults.length / pageSize) || 1;
        document.getElementById('totalPages').textContent = totalPages;
        document.getElementById('currentPage').textContent = currentPage;
        renderTablePage();
    });

    // Previous page
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage();
        }
    });

    // Next page
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderTablePage();
        }
    });

}

// Theme Management
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    // Add transition effect
    document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
}

// Tab Management
function switchTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(tab => {
        tab.classList.remove('active');
    });

    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');

    // Set active button
    event.target.classList.add('active');
}

// File Upload Management

function initializeFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('audioFile');

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
    // Validate file type
    const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/ogg'];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(wav|mp3|flac|m4a|ogg|wma)$/i)) {
        showNotification('Please select a valid audio file', 'error');
        return;
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
        showNotification('File size must be less than 50MB', 'error');
        return;
    }

    // Upload file
    const formData = new FormData();
    formData.append('file', file);

    try {
        showLoading('Uploading file...');

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            currentFile = data;
            displayFileInfo(data);
            await loadVisualizations(data.filepath);
            showNotification('File uploaded successfully', 'success');
        } else {
            showNotification(data.error || 'Upload failed', 'error');
        }
    } catch (error) {
        showNotification('Upload failed: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function displayFileInfo(fileData) {
    // Show file info section
    document.getElementById('fileInfo').style.display = 'block';
    document.getElementById('analysisSection').style.display = 'block';

    // Update audio player - Fix: don't use currentFile directly, use the server URL
    const audioPlayer = document.getElementById('audioPlayer');
    // Create a URL for the uploaded file
    audioPlayer.src = `/static/uploads/${fileData.filename}`;

    // Update file details
    document.getElementById('duration').textContent = formatDuration(fileData.duration);
    document.getElementById('format').textContent = fileData.format;
    document.getElementById('fileSize').textContent = formatFileSize(fileData.file_size);
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
            createSpectrumPlot(data.visualizations.spectrum);
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

    const layout = {
        title: 'Audio Waveform',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: 'var(--text-primary)', size: 12 },

        /* ─── FORCE X-AXIS TO GO FROM 0 → maxTime ─── */
        xaxis: {
            title: 'Time (seconds)',
            range: [0, maxTime],
            titlefont: { size: 13, color: 'var(--text-primary)' },
            tickfont: { size: 10, color: '#aaaaaa' },
            /* For tick spacing, choose something like  maxTime/10 seconds */
            dtick: Math.max(1, Math.round(maxTime / 10)),
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

function createSpectrumPlot(spectrumData) {
    const trace = {
        x: spectrumData.x,
        y: spectrumData.y,
        type: 'scatter',
        mode: 'lines',
        name: 'Spectrum',
        line: {
            color: '#06b6d4',
            width: 1
        }
    };

    const layout = {
        title: 'Frequency Spectrum',
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: 'var(--text-primary)', size: 12 },

        /* ─── FORCE X-AXIS RANGE ─── */
        xaxis: {
            title: 'Frequency (Hz)',
            range: [minFreq, maxFreq],
            titlefont: { size: 13, color: 'var(--text-primary)' },
            tickfont: { size: 10, color: '#aaaaaa' },
            /* If you want a linear axis with “nice” tick spacing: */
            dtick: Math.max(10, Math.round(maxFreq / 10)),
            gridcolor: 'rgba(255,255,255,0.15)',
            zerolinecolor: 'rgba(255,255,255,0.2)'
        },

        yaxis: {
            title: 'Magnitude',
            titlefont: { size: 13, color: 'var(--text-primary)' },
            tickfont: { size: 10, color: '#aaaaaa' },
            dtick: 1,
            gridcolor: 'rgba(255,255,255,0.15)',
            zerolinecolor: 'rgba(255,255,255,0.2)'
        },

        margin: {
            l: 60,  // leave room for Y-axis labels
            r: 20,
            t: 40,
            b: 50  // leave room for X-axis labels
        }
    };

    Plotly.newPlot('spectrum', [trace], layout, { responsive: true });
}


// Audio Analysis
async function analyzeAudio() {
    if (!currentFile) {
        showNotification('Please upload a file first', 'error');
        return;
    }

    const mode = document.getElementById('analysisMode').value;
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    // Show progress
    progressContainer.style.display = 'block';

    try {
        // Start analysis
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

        // Monitor progress
        const progressInterval = setInterval(async () => {
            const progressResponse = await fetch(`/progress/${currentFile.filename}`);
            const progressData = await progressResponse.json();

            progressBar.style.width = progressData.progress + '%';
            progressText.textContent = `Analyzing: ${progressData.progress}%`;
        }, 500);

        const data = await response.json();
        clearInterval(progressInterval);

        if (data.success) {
            analysisResults = data.results;
            displayResults(data.results);
            showNotification('Analysis completed successfully', 'success');
        } else {
            showNotification(data.error || 'Analysis failed', 'error');
        }
    } catch (error) {
        showNotification('Analysis failed: ' + error.message, 'error');
    } finally {
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
    }
}

function displayResults(results) {
    analysisResults = results || [];
    // ─── Initialize filteredResults to be the same as analysisResults ───
    filteredResults = analysisResults.slice();

    currentPage = 1;
    totalPages = Math.ceil(filteredResults.length / pageSize) || 1;

    document.getElementById('totalPages').textContent = totalPages;
    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('prevPage').disabled = true;
    document.getElementById('nextPage').disabled = (totalPages <= 1);

    document.getElementById('resultsSection').style.display = 'block';
    renderTablePage();
}


/**
 * Renders only the rows for the current page in #resultsTable.
 */
function renderTablePage() {
    const resultsTable = document.getElementById('resultsTable');
    // If there are no filtered results at all, show “no results” and return.
    if (!filteredResults || filteredResults.length === 0) {
        resultsTable.innerHTML = '<p>No results found.</p>';
        return;
    }

    // Recompute totalPages based on filteredResults
    totalPages = Math.ceil(filteredResults.length / pageSize) || 1;
    document.getElementById('totalPages').textContent = totalPages;
    document.getElementById('currentPage').textContent = currentPage;

    document.getElementById('prevPage').disabled = (currentPage <= 1);
    document.getElementById('nextPage').disabled = (currentPage >= totalPages);

    // Slice out just the current page (from filteredResults, not analysisResults)
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredResults.length);
    const pageResults = filteredResults.slice(startIndex, endIndex);

    // Build the table with only this page's rows
    let tableHTML = `
        <table class="results-table">
            <thead>
                <tr>
                    <th>Time</th>
                    <th>Detected Note</th>
                    <th>Frequency (Hz)</th>
                    <th>Confidence</th>
                    <th>Energy</th>
                </tr>
            </thead>
            <tbody>
    `;

    pageResults.forEach(result => {
        tableHTML += `
            <tr>
                <td>${result.Time}</td>
                <td><strong>${result['Detected Note']}</strong></td>
                <td>${result['Frequency (Hz)']}</td>
                <td>${result.Confidence}</td>
                <td>${result.Energy}</td>
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    resultsTable.innerHTML = tableHTML;
}


function filterResults() {
    // 1) Grab the user‐typed search value (in this case, a substring of Time).
    const searchValue = document.getElementById('searchTime')
        .value
        .trim()
        .toLowerCase();

    // 2) If the search field is empty, reset filteredResults to the full array:
    if (!searchValue) {
        filteredResults = analysisResults.slice();
    } else {
        // Otherwise, keep only those entries whose Time cell includes the search string:
        filteredResults = analysisResults.filter(result => {
            // result.Time might be like "00:01:23.456"; convert to lowercase string
            const timeStr = String(result.Time).toLowerCase();
            return timeStr.includes(searchValue);
        });
    }

    // 3) Reset to page 1 because search results have changed:
    currentPage = 1;

    // 4) Recompute totalPages based on the new filteredResults length:
    totalPages = Math.ceil(filteredResults.length / pageSize) || 1;
    document.getElementById('totalPages').textContent = totalPages;
    document.getElementById('currentPage').textContent = currentPage;

    // 5) Enable/disable navigation buttons:
    document.getElementById('prevPage').disabled = true;
    document.getElementById('nextPage').disabled = (totalPages <= 1);

    // 6) Finally, re-render the first page of filteredResults:
    renderTablePage();
}


// Export functions
async function exportResults(format) {
    if (!analysisResults) {
        showNotification('No results to export', 'error');
        return;
    }

    try {
        const response = await fetch(`/export/${format}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                results: analysisResults,
                filename: currentFile.filename.split('.')[0]
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `note_detection_${currentFile.filename.split('.')[0]}_${Date.now()}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showNotification(`Results exported as ${format.toUpperCase()}`, 'success');
        } else {
            showNotification('Export failed', 'error');
        }
    } catch (error) {
        showNotification('Export failed: ' + error.message, 'error');
    }
}

// Real-time Detection
let staffRenderer = null; // SVG Renderer

function initializeRealtimeDetection() {
    const startBtn = document.getElementById('startDetection');
    const stopBtn = document.getElementById('stopDetection');

    startBtn.addEventListener('click', startRealtimeDetection);
    stopBtn.addEventListener('click', stopRealtimeDetection);

    // Initialize Staff Renderer
    setTimeout(() => {
        if (document.getElementById('staffSvg')) {
            staffRenderer = new StaffRenderer('staffSvg');
        }
    }, 100);
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
    try {
        // Update status
        document.getElementById('statusMessage').textContent = 'Requesting microphone access...';
        document.getElementById('statusMessage').className = 'status-message info';

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
        document.getElementById('statusMessage').textContent = '🎤 Listening... Sing or play a note!';
        document.getElementById('statusMessage').className = 'status-message success';

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
        document.getElementById('statusMessage').textContent = 'Error: ' + error.message;
        document.getElementById('statusMessage').className = 'status-message error';
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

    // Clear history
    noteHistory = [];
    frequencyHistory = [];

    // Disconnect audio nodes
    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }

    if (analyser) {
        analyser.disconnect();
        analyser = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    // Update UI
    document.getElementById('startDetection').disabled = false;
    document.getElementById('stopDetection').disabled = true;
    document.getElementById('noteDisplay').textContent = '—';
    document.getElementById('freqDisplay').textContent = 'Ready to detect';
    document.getElementById('confidenceBar').style.width = '0%';
    document.getElementById('statusMessage').textContent = 'Click "Start Detection" to begin';
    document.getElementById('statusMessage').className = 'status-message';
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