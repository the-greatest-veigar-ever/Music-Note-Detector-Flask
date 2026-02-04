# Music Note Detector

A robust Flask-based web application for analyzing audio files and detecting musical notes, pitch frequencies, and note stability.

## Features

- **Audio Analysis**: Upload common audio formats (MP3, WAV, etc.) for instant analysis.
- **Multiple Detection Algorithms**:
  - **Quick**: Fast detection using `Librosa`.
  - **Standard**: Accurate pitch tracking using `Parselmouth` (Praat).
  - **Advanced**: Custom hybrid algorithm combining Autocorrelation and Harmonic Product Spectrum.
- **Visualizations**: Interactive Waveform and Frequency Spectrum displays.
- **Detailed Reporting**:
  - Detects Note Name, Octave, and Frequency (Hz).
  - Calculates Confidence scores and Energy levels.
  - Analyzes Note Stability.
- **Export Options**: Download results as CSV, Excel, or Text files.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/note-detector.git
    cd note-detector
    ```

2.  **Create a virtual environment** (recommended):
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
    *Note: You may need `ffmpeg` installed on your system for audio processing.*

## Usage

1.  **Start the application**:
    ```bash
    python app.py
    ```

2.  **Open in Browser**:
    Navigate to `http://localhost:5000`

3.  **Analyze Audio**:
    - Click "Upload Audio" to select a file.
    - Choose an analysis mode (Quick, Standard, or Advanced).
    - View the detected notes, visualization, and statistics.
    - Export the data if needed.

## Project Structure

- `app.py`: Main Flask application handling routes and API endpoints.
- `utils/audio_processor.py`: Core logic for loading and processing audio data.
- `utils/note_detector.py`: Algorithms for pitch and note detection.
- `templates/`: HTML templates for the frontend.
- `static/`: CSS, JavaScript, and uploaded files.
