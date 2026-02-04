"""
Audio processing utilities for file analysis.
"""

import os
import logging
from typing import Tuple, List, Dict, Optional, Any, Callable, Union

import numpy as np
import librosa
import soundfile as sf
import parselmouth
from scipy import signal

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
    """Professional audio processing class."""

    def __init__(self, config: Any):
        """
        Initialize AudioProcessor with configuration.

        Args:
           config: Configuration object containing audio parameters.
        """
        self.config = config
        self.sample_rate = getattr(config, 'SAMPLE_RATE', 22050)
        self.min_freq = getattr(config, 'MIN_FREQUENCY', 80)
        self.max_freq = getattr(config, 'MAX_FREQUENCY', 2000)

    def load_audio(self, filepath: str) -> Tuple[np.ndarray, int, Dict[str, Any]]:
        """
        Load audio file with metadata.

        Args:
            filepath: Path to audio file.

        Returns:
            Tuple containing:
            - audio_data (np.ndarray): The audio signal.
            - sample_rate (int): The sample rate.
            - metadata (Dict[str, Any]): Audio file metadata.

        Raises:
            Exception: If loading fails.
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
            logger.error(f"Error loading audio file {filepath}: {str(e)}")
            raise

    def preprocess_audio(self, y: np.ndarray, sr: int) -> np.ndarray:
        """
        Preprocess audio for better pitch detection.

        Args:
            y: Audio signal.
            sr: Sample rate.

        Returns:
            Preprocessed audio signal.
        """
        # Remove DC offset
        y = y - np.mean(y)

        # Apply high-pass filter to remove low frequency noise
        nyquist = sr / 2
        low_cutoff = 50 / nyquist
        if low_cutoff < 1:
            try:
                b, a = signal.butter(5, low_cutoff, btype='high')
                y = signal.filtfilt(b, a, y)
            except Exception as e:
               logger.warning(f"Filter error (skipping): {e}")

        # Normalize
        max_val = np.max(np.abs(y))
        if max_val > 0:
            y = y / max_val

        return y

    def detect_pitch_librosa(self, y: np.ndarray, sr: int) -> Tuple[float, float]:
        """
        Detect pitch using librosa's piptrack.

        Args:
            y: Audio signal.
            sr: Sample rate.

        Returns:
            Tuple of (frequency, confidence).
        """
        try:
            pitches, magnitudes = librosa.piptrack(
                y=y, sr=sr,
                fmin=self.min_freq,
                fmax=self.max_freq,
                threshold=0.1
            )
        except Exception as e:
            logger.warning(f"Librosa piptrack failed: {e}")
            return 0.0, 0.0

        # Get the pitch with highest magnitude for each frame
        pitch_values = []
        confidence_values = []

        # Iterate through frames; optimization: vectorize if possible, but loop is readable for now
        # given typical segment sizes.
        if pitches.shape[1] > 0:
            for t in range(pitches.shape[1]):
                index = magnitudes[:, t].argmax()
                pitch = pitches[index, t]

                if pitch > 0:
                    pitch_values.append(pitch)
                    # Normalize magnitude to confidence
                    max_mag = np.max(magnitudes)
                    conf = min(1.0, magnitudes[index, t] / max_mag) if max_mag > 0 else 0
                    confidence_values.append(conf)

        if pitch_values:
            # Use median for robustness
            frequency = float(np.median(pitch_values))
            confidence = float(np.mean(confidence_values))
            return frequency, confidence

        return 0.0, 0.0

    def detect_pitch_parselmouth(self, y: np.ndarray, sr: int) -> Tuple[float, float]:
        """
        Detect pitch using Parselmouth (Praat).

        Args:
            y: Audio signal.
            sr: Sample rate.

        Returns:
            Tuple of (frequency, confidence).
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
            # Filter zero values (unvoiced)
            pitch_values = pitch_values[pitch_values > 0]

            if len(pitch_values) > 0:
                # Calculate confidence based on pitch strength
                strength_values = pitch.selected_array['strength']
                # Filter for when frequency > 0
                strength_values = strength_values[pitch.selected_array['frequency'] > 0]

                frequency = float(np.median(pitch_values))
                confidence = float(np.mean(strength_values)) if len(strength_values) > 0 else 0.5

                return frequency, confidence

        except Exception as e:
            logger.warning(f"Parselmouth error: {str(e)}")

        return 0.0, 0.0

    def analyze_segment(self, y: np.ndarray, sr: int, method: str = 'advanced') -> Dict[str, Any]:
        """
        Analyze a segment of audio.

        Args:
            y: Audio segment.
            sr: Sample rate.
            method: Detection method ('quick', 'standard', 'advanced').

        Returns:
            Dictionary with analysis results.
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
            if freq == 0: # Fallback if standard fails
                 freq, conf = self.detect_pitch_librosa(y_processed, sr)
            note_info = frequency_to_note(freq)
            note_info['confidence'] = conf
            note_info['method'] = 'parselmouth'

        else:  # advanced
            note_info = detect_pitch_advanced(y_processed, sr)

        note_info['energy'] = round(float(energy), 3)
        return note_info

    def analyze_file(self, filepath: str, mode: str = 'standard',
                    progress_callback: Optional[Callable[[float], None]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Analyze entire audio file.

        Args:
            filepath: Path to audio file.
            mode: Analysis mode ('quick', 'standard', 'advanced').
            progress_callback: Optional callback for progress updates.

        Returns:
            Tuple of (results_list, metadata).
        """
        # Load audio
        y, sr, metadata = self.load_audio(filepath)

        # Determine hop length based on mode
        # Using getattr to fallback safely if config attributes missing
        if mode == 'quick':
            hop_time = getattr(self.config, 'HOP_LENGTH_QUICK', 1.0)
        elif mode == 'standard':
            hop_time = getattr(self.config, 'HOP_LENGTH_STANDARD', 0.25)
        else:  # advanced
            hop_time = getattr(self.config, 'HOP_LENGTH_ADVANCED', 0.1)
            
        hop_length = int(sr * hop_time)

        # Analyze in segments
        results = []
        total_segments = (len(y) - hop_length) // hop_length + 1
        
        if total_segments <= 0:
             # Handle very short files
             total_segments = 1
             hop_length = len(y)

        for i, start in enumerate(range(0, len(y) - hop_length + 1, hop_length)):
            if start + hop_length > len(y):
                break
                
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
                progress = min(1.0, (i + 1) / total_segments)
                progress_callback(progress)
        
        # Ensure progress reaches 100%
        if progress_callback:
            progress_callback(1.0)

        return results, metadata

    def _format_time(self, seconds: float) -> str:
        """
        Format time in HH:MM:SS.ffff format.
        
        Args:
            seconds: Time in seconds.
            
        Returns:
            Formatted time string.
        """
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        milliseconds = int((seconds % 1) * 10000)

        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:04d}"

    def create_visualizations(self, filepath: str) -> Dict[str, Any]:
        """
        Create visualization data for the audio file.

        Args:
            filepath: Path to audio file.

        Returns:
            Dictionary with visualization data (waveform, spectrum).
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