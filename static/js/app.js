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
const NOTE_THRESHOLD = 0.7;
let currentFile = null;
// ─────────── PAGINATION STATE ───────────
let analysisResults = [];     // holds the full, unfiltered array
let filteredResults = [];     // holds the subset matching the search (initially the same as analysisResults)
let currentPage = 1;
let pageSize = 20;
let totalPages = 1;



// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
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
function initializeRealtimeDetection() {
    const startBtn = document.getElementById('startDetection');
    const stopBtn = document.getElementById('stopDetection');

    startBtn.addEventListener('click', startRealtimeDetection);
    stopBtn.addEventListener('click', stopRealtimeDetection);
}

function updateDisplay(frequency, confidence) {
    if (frequency > 0 && confidence > 0.5) {
        const noteData = frequencyToNote(frequency);

        if (noteData && noteData.note !== '—') {
            // Add to history
            noteHistory.push(noteData.note);
            frequencyHistory.push(frequency);

            // Keep history size limited
            if (noteHistory.length > HISTORY_SIZE) {
                noteHistory.shift();
                frequencyHistory.shift();
            }

            // Wait for enough samples before displaying
            if (noteHistory.length < 5) {
                return;
            }

            // Count occurrences of each note
            const noteCounts = {};
            noteHistory.forEach(note => {
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

            // Only display if we have enough agreement
            if (maxCount >= noteHistory.length * NOTE_THRESHOLD) {
                document.getElementById('noteDisplay').textContent = mostCommonNote;

                // Calculate median frequency for stable display
                const sortedFreqs = [...frequencyHistory].sort((a, b) => a - b);
                const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
                document.getElementById('freqDisplay').textContent = medianFreq.toFixed(1) + ' Hz';
            }

            // Update confidence bar
            document.getElementById('confidenceBar').style.width = (confidence * 100) + '%';
        }
    } else {
        // Clear history if no valid pitch for several frames
        if (confidence < 0.3) {
            if (noteHistory.length > 0) {
                noteHistory.pop();
                frequencyHistory.pop();
            }
            if (noteHistory.length === 0) {
                document.getElementById('noteDisplay').textContent = '—';
                document.getElementById('freqDisplay').textContent = 'No pitch detected';
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

        // Get microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                latency: 0
            }
        });

        // Create audio context
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.8;

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

            if (result && result.frequency > 0) {
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
    // Check if buffer has enough signal
    let SIZE = buffer.length;
    let sumOfSquares = 0;
    for (let i = 0; i < SIZE; i++) {
        sumOfSquares += buffer[i] * buffer[i];
    }
    const rootMeanSquare = Math.sqrt(sumOfSquares / SIZE);

    if (rootMeanSquare < 0.01) {
        return { frequency: -1, confidence: 0 };
    }

    // Find the first zero crossing
    let start = 0;
    for (let i = 0; i < SIZE / 2; i++) {
        if (buffer[i] > 0 && buffer[i + 1] <= 0) {
            start = i;
            break;
        }
    }

    // Autocorrelation
    const MIN_SAMPLES = Math.floor(sampleRate / 1000); // 1000 Hz max
    const MAX_SAMPLES = Math.floor(sampleRate / 80);   // 80 Hz min

    let bestOffset = -1;
    let bestCorrelation = 0;
    let correlations = new Array(MAX_SAMPLES + 1);

    for (let offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;

        for (let i = 0; i < SIZE - offset; i++) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }

        correlation = 1 - correlation / SIZE;
        correlations[offset] = correlation;

        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
        }
    }

    if (bestCorrelation < 0.9) {
        return { frequency: -1, confidence: 0 };
    }

    // Interpolation for better precision
    if (bestOffset > 0 && bestOffset < MAX_SAMPLES - 1) {
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
    return { frequency: frequency, confidence: bestCorrelation };
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