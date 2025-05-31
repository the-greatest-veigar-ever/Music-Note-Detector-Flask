"""
Audio processing utilities for file analysis
"""

import os
import numpy as np
import librosa
import soundfile as sf
import parselmouth
from scipy import signal
from typing import Tuple, List, Dict, Optional
import logging

from .note_detector import (
    frequency_to_note,
    detect_pitch_advanced,
    autocorrelation_pitch,
    harmonic_product_spectrum
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AudioProcessor:
    """Professional audio processing class"""

    def __init__(self, config):
        self.config = config
        self.sample_rate = config.SAMPLE_RATE
        self.min_freq = config.MIN_FREQUENCY
        self.max_freq = config.MAX_FREQUENCY

    def load_audio(self, filepath: str) -> Tuple[np.ndarray, int, Dict]:
        """
        Load audio file with metadata

        Args:
            filepath: Path to audio file

        Returns:
            Tuple of (audio_data, sample_rate, metadata)
        """
        try:
            # Load with librosa for consistency
            y, sr = librosa.load(filepath, sr=None)

            # Get file info
            info = sf.info(filepath)

            metadata = {
                'duration': len(y) / sr,
                'sample_rate': sr,
                'channels': info.channels,
                'format': info.format,
                'subtype': info.subtype,
                'frames': len(y),
                'file_size': os.path.getsize(filepath)
            }

            # Convert to mono if stereo
            if len(y.shape) > 1:
                y = np.mean(y, axis=1)

            return y, sr, metadata

        except Exception as e:
            logger.error(f"Error loading audio file: {str(e)}")
            raise

    def preprocess_audio(self, y: np.ndarray, sr: int) -> np.ndarray:
        """
        Preprocess audio for better pitch detection

        Args:
            y: Audio signal
            sr: Sample rate

        Returns:
            Preprocessed audio signal
        """
        # Remove DC offset
        y = y - np.mean(y)

        # Apply high-pass filter to remove low frequency noise
        nyquist = sr / 2
        low_cutoff = 50 / nyquist
        if low_cutoff < 1:
            b, a = signal.butter(5, low_cutoff, btype='high')
            y = signal.filtfilt(b, a, y)

        # Normalize
        max_val = np.max(np.abs(y))
        if max_val > 0:
            y = y / max_val

        return y

    def detect_pitch_librosa(self, y: np.ndarray, sr: int) -> Tuple[float, float]:
        """
        Detect pitch using librosa's piptrack

        Args:
            y: Audio signal
            sr: Sample rate

        Returns:
            Tuple of (frequency, confidence)
        """
        pitches, magnitudes = librosa.piptrack(
            y=y, sr=sr,
            fmin=self.min_freq,
            fmax=self.max_freq,
            threshold=0.1
        )

        # Get the pitch with highest magnitude for each frame
        pitch_values = []
        confidence_values = []

        for t in range(pitches.shape[1]):
            index = magnitudes[:, t].argmax()
            pitch = pitches[index, t]

            if pitch > 0:
                pitch_values.append(pitch)
                # Normalize magnitude to confidence
                conf = min(1.0, magnitudes[index, t] / np.max(magnitudes))
                confidence_values.append(conf)

        if pitch_values:
            # Use median for robustness
            frequency = np.median(pitch_values)
            confidence = np.mean(confidence_values)
            return frequency, confidence

        return 0.0, 0.0

    def detect_pitch_parselmouth(self, y: np.ndarray, sr: int) -> Tuple[float, float]:
        """
        Detect pitch using Parselmouth (Praat)

        Args:
            y: Audio signal
            sr: Sample rate

        Returns:
            Tuple of (frequency, confidence)
        """
        try:
            # Create Parselmouth Sound object
            sound = parselmouth.Sound(y, sampling_frequency=sr)

            # Extract pitch
            pitch = sound.to_pitch(
                pitch_floor=self.min_freq,
                pitch_ceiling=self.max_freq
            )

            # Get pitch values
            pitch_values = pitch.selected_array['frequency']
            pitch_values = pitch_values[pitch_values > 0]

            if len(pitch_values) > 0:
                # Calculate confidence based on pitch strength
                strength_values = pitch.selected_array['strength']
                strength_values = strength_values[pitch.selected_array['frequency'] > 0]

                frequency = np.median(pitch_values)
                confidence = np.mean(strength_values) if len(strength_values) > 0 else 0.5

                return frequency, confidence

        except Exception as e:
            logger.warning(f"Parselmouth error: {str(e)}")

        return 0.0, 0.0

    def analyze_segment(self, y: np.ndarray, sr: int, method: str = 'advanced') -> Dict:
        """
        Analyze a segment of audio

        Args:
            y: Audio segment
            sr: Sample rate
            method: Detection method ('quick', 'standard', 'advanced')

        Returns:
            Dictionary with analysis results
        """
        # Preprocess
        y_processed = self.preprocess_audio(y, sr)

        # Check if segment has enough energy
        energy = np.sqrt(np.mean(y_processed**2))
        if energy < 0.01:  # Silence threshold
            return {
                'note': '—',
                'frequency': 0,
                'confidence': 0,
                'method': method,
                'energy': energy
            }

        # Select detection method
        if method == 'quick':
            freq, conf = self.detect_pitch_librosa(y_processed, sr)
            note_info = frequency_to_note(freq)
            note_info['confidence'] = conf
            note_info['method'] = 'librosa'

        elif method == 'standard':
            freq, conf = self.detect_pitch_parselmouth(y_processed, sr)
            note_info = frequency_to_note(freq)
            note_info['confidence'] = conf
            note_info['method'] = 'parselmouth'

        else:  # advanced
            note_info = detect_pitch_advanced(y_processed, sr)

        note_info['energy'] = round(energy, 3)
        return note_info

    def analyze_file(self, filepath: str, mode: str = 'standard',
                    progress_callback: Optional[callable] = None) -> List[Dict]:
        """
        Analyze entire audio file

        Args:
            filepath: Path to audio file
            mode: Analysis mode ('quick', 'standard', 'advanced')
            progress_callback: Optional callback for progress updates

        Returns:
            List of analysis results
        """
        # Load audio
        y, sr, metadata = self.load_audio(filepath)

        # Determine hop length based on mode
        if mode == 'quick':
            hop_length = int(sr * self.config.HOP_LENGTH_QUICK)
        elif mode == 'standard':
            hop_length = int(sr * self.config.HOP_LENGTH_STANDARD)
        else:  # advanced
            hop_length = int(sr * self.config.HOP_LENGTH_ADVANCED)

        # Analyze in segments
        results = []
        total_segments = (len(y) - hop_length) // hop_length + 1

        for i, start in enumerate(range(0, len(y) - hop_length, hop_length)):
            # Extract segment
            segment = y[start:start + hop_length]

            # Analyze segment
            result = self.analyze_segment(segment, sr, mode)

            # Add timing information
            time_seconds = start / sr
            result['time'] = time_seconds
            result['time_formatted'] = self._format_time(time_seconds)

            results.append(result)

            # Update progress
            if progress_callback:
                progress = (i + 1) / total_segments
                progress_callback(progress)

        return results, metadata

    def _format_time(self, seconds: float) -> str:
        """Format time in HH:MM:SS.ffff format"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        milliseconds = int((seconds % 1) * 10000)

        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:04d}"

    def create_visualizations(self, filepath: str) -> Dict:
        """
        Create visualization data for the audio file

        Args:
            filepath: Path to audio file

        Returns:
            Dictionary with visualization data
        """
        # Load audio with lower sample rate for visualization
        y, sr = librosa.load(filepath, sr=22050, duration=30)  # Limit to 30 seconds

        # Waveform data (downsample for performance)
        target_points = 5000
        if len(y) > target_points:
            indices = np.linspace(0, len(y) - 1, target_points, dtype=int)
            y_downsampled = y[indices]
            time_downsampled = indices / sr
        else:
            y_downsampled = y
            time_downsampled = np.arange(len(y)) / sr

        # Spectrum data
        # Use smaller FFT size for performance
        n_fft = min(2048, len(y))
        D = np.abs(librosa.stft(y, n_fft=n_fft))
        frequencies = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

        # Focus on audible range
        freq_mask = (frequencies > 20) & (frequencies < 4000)
        frequencies_filtered = frequencies[freq_mask]
        magnitude = np.mean(D[freq_mask, :], axis=1)

        return {
            'waveform': {
                'x': time_downsampled.tolist(),
                'y': y_downsampled.tolist()
            },
            'spectrum': {
                'x': frequencies_filtered.tolist(),
                'y': magnitude.tolist()
            }
        }