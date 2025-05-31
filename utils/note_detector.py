"""
Musical note detection algorithms and utilities
"""

import numpy as np
from typing import Tuple, Optional, List, Dict

# Musical constants
A4_FREQUENCY = 440.0
NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Frequency ranges for different octaves
OCTAVE_FREQUENCIES = {
    0: (16.35, 30.87),
    1: (32.70, 61.74),
    2: (65.41, 123.47),
    3: (130.81, 246.94),
    4: (261.63, 493.88),
    5: (523.25, 987.77),
    6: (1046.50, 1975.53),
    7: (2093.00, 3951.07),
    8: (4186.01, 7902.13)
}

def frequency_to_note(frequency: float, precision: float = 0.5) -> Dict[str, any]:
    """
    Convert frequency to musical note with detailed information

    Args:
        frequency: Frequency in Hz
        precision: Cents tolerance for note matching

    Returns:
        Dictionary with note information
    """
    if frequency <= 0:
        return {
            'note': '—',
            'frequency': 0,
            'cents': 0,
            'octave': 0,
            'confidence': 0
        }

    # Calculate distance from A4 in semitones
    semitones_from_a4 = 12 * np.log2(frequency / A4_FREQUENCY)

    # Find the nearest note
    nearest_note_index = int(round(semitones_from_a4))

    # Calculate cents deviation
    cents_deviation = (semitones_from_a4 - nearest_note_index) * 100

    # Calculate octave and note within octave
    note_number = nearest_note_index + 69  # A4 is MIDI note 69
    octave = (note_number // 12) - 1
    note_index = note_number % 12

    # Determine confidence based on how close we are to the note
    confidence = max(0, 1 - abs(cents_deviation) / 50)  # 50 cents = 50% confidence

    return {
        'note': f"{NOTE_NAMES[note_index]}{octave}",
        'note_name': NOTE_NAMES[note_index],
        'octave': octave,
        'frequency': frequency,
        'cents': round(cents_deviation, 1),
        'confidence': round(confidence, 2),
        'midi_number': note_number
    }

def autocorrelation_pitch(signal: np.ndarray, sr: int,
                         fmin: float = 80, fmax: float = 2000) -> Tuple[float, float]:
    """
    Detect pitch using autocorrelation method

    Args:
        signal: Audio signal
        sr: Sample rate
        fmin: Minimum frequency to detect
        fmax: Maximum frequency to detect

    Returns:
        Tuple of (frequency, confidence)
    """
    # Window the signal
    signal = signal * np.hanning(len(signal))

    # Normalize
    signal = signal - np.mean(signal)
    if np.max(np.abs(signal)) > 0:
        signal = signal / np.max(np.abs(signal))

    # Calculate autocorrelation
    corr = np.correlate(signal, signal, mode='full')
    corr = corr[len(corr)//2:]

    # Find the first peak after the zero lag
    min_period = int(sr / fmax)
    max_period = int(sr / fmin)

    # Skip the zero lag peak
    corr[:min_period] = 0

    # Find peaks
    peaks = []
    for i in range(min_period, min(max_period, len(corr)-1)):
        if corr[i] > corr[i-1] and corr[i] > corr[i+1]:
            peaks.append((i, corr[i]))

    if not peaks:
        return 0.0, 0.0

    # Sort by correlation value
    peaks.sort(key=lambda x: x[1], reverse=True)

    # Use the strongest peak
    best_period, best_corr = peaks[0]

    # Refine using parabolic interpolation
    if best_period > 0 and best_period < len(corr) - 1:
        y1 = corr[best_period - 1]
        y2 = corr[best_period]
        y3 = corr[best_period + 1]

        a = (y1 - 2 * y2 + y3) / 2
        b = (y3 - y1) / 2

        if a < 0:  # Make sure we have a peak
            x_offset = -b / (2 * a)
            best_period = best_period + x_offset

    frequency = sr / best_period
    confidence = min(1.0, best_corr)

    return frequency, confidence

def harmonic_product_spectrum(signal: np.ndarray, sr: int,
                            n_harmonics: int = 5) -> Tuple[float, float]:
    """
    Detect pitch using Harmonic Product Spectrum method

    Args:
        signal: Audio signal
        sr: Sample rate
        n_harmonics: Number of harmonics to consider

    Returns:
        Tuple of (frequency, confidence)
    """
    # Window the signal
    windowed = signal * np.hanning(len(signal))

    # Compute FFT
    fft = np.fft.rfft(windowed)
    magnitude = np.abs(fft)

    # Build harmonic product spectrum
    hps = magnitude.copy()

    for h in range(2, n_harmonics + 1):
        decimated = magnitude[::h]
        hps[:len(decimated)] *= decimated

    # Find the peak
    # Limit search to meaningful frequency range
    freq_bins = np.fft.rfftfreq(len(windowed), 1/sr)
    min_bin = np.where(freq_bins >= 80)[0][0] if len(np.where(freq_bins >= 80)[0]) > 0 else 0
    max_bin = np.where(freq_bins <= 2000)[0][-1] if len(np.where(freq_bins <= 2000)[0]) > 0 else len(hps)-1

    peak_bin = np.argmax(hps[min_bin:max_bin]) + min_bin

    # Get frequency
    frequency = freq_bins[peak_bin]

    # Estimate confidence based on peak prominence
    if peak_bin > 0 and peak_bin < len(hps) - 1:
        prominence = hps[peak_bin] / np.mean(hps[max(0, peak_bin-10):peak_bin+10])
        confidence = min(1.0, prominence / 10)
    else:
        confidence = 0.0

    return frequency, confidence

def detect_pitch_advanced(signal: np.ndarray, sr: int) -> Dict[str, any]:
    """
    Advanced pitch detection combining multiple methods

    Args:
        signal: Audio signal
        sr: Sample rate

    Returns:
        Dictionary with pitch information
    """
    # Method 1: Autocorrelation
    freq1, conf1 = autocorrelation_pitch(signal, sr)

    # Method 2: Harmonic Product Spectrum
    freq2, conf2 = harmonic_product_spectrum(signal, sr)

    # Combine results weighted by confidence
    if conf1 > 0 and conf2 > 0:
        total_conf = conf1 + conf2
        frequency = (freq1 * conf1 + freq2 * conf2) / total_conf
        confidence = (conf1 + conf2) / 2
    elif conf1 > 0:
        frequency = freq1
        confidence = conf1
    elif conf2 > 0:
        frequency = freq2
        confidence = conf2
    else:
        frequency = 0
        confidence = 0

    # Get note information
    note_info = frequency_to_note(frequency)
    note_info['confidence'] = round(confidence, 2)
    note_info['method'] = 'combined'

    return note_info

def analyze_note_stability(note_history: List[str], frequency_history: List[float]) -> Dict[str, any]:
    """
    Analyze the stability of detected notes over time

    Args:
        note_history: List of detected notes
        frequency_history: List of detected frequencies

    Returns:
        Dictionary with stability analysis
    """
    if not note_history:
        return {'stable': False, 'dominant_note': None, 'stability_score': 0}

    # Count note occurrences
    note_counts = {}
    for note in note_history:
        if note != '—':
            note_counts[note] = note_counts.get(note, 0) + 1

    if not note_counts:
        return {'stable': False, 'dominant_note': None, 'stability_score': 0}

    # Find dominant note
    dominant_note = max(note_counts, key=note_counts.get)
    dominance_ratio = note_counts[dominant_note] / len(note_history)

    # Calculate frequency variance for the dominant note
    dominant_frequencies = [
        freq for note, freq in zip(note_history, frequency_history)
        if note == dominant_note and freq > 0
    ]

    if dominant_frequencies:
        freq_variance = np.std(dominant_frequencies) / np.mean(dominant_frequencies)
        stability_score = dominance_ratio * (1 - min(freq_variance, 1))
    else:
        stability_score = 0

    return {
        'stable': stability_score > 0.7,
        'dominant_note': dominant_note,
        'stability_score': round(stability_score, 2),
        'dominance_ratio': round(dominance_ratio, 2),
        'note_distribution': note_counts
    }