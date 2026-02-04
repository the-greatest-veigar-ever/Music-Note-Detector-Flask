
import os
import logging
from typing import Dict, List, Optional, Tuple, Any

from utils.audio_processor import AudioProcessor

logger = logging.getLogger(__name__)

class AudioService:
    """
    Service layer for handling audio processing tasks.
    Encapsulates AudioProcessor and manages analysis state.
    """

    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the AudioService.

        Args:
            config: Application configuration dictionary.
        """
        self.config = config
        self.processor = AudioProcessor(config)
        # Store analysis progress in memory (note: not scalable for multiple workers)
        self._analysis_progress: Dict[str, int] = {}
        
        # Ensure upload directory exists
        if hasattr(config, 'UPLOAD_FOLDER'):
             os.makedirs(config.UPLOAD_FOLDER, exist_ok=True)
        elif isinstance(config, dict) and 'UPLOAD_FOLDER' in config:
             os.makedirs(config['UPLOAD_FOLDER'], exist_ok=True)

    def load_audio_metadata(self, filepath: str) -> Dict[str, Any]:
        """
        Load metadata for an audio file.

        Args:
            filepath: Path to the audio file.

        Returns:
            Dictionary containing audio metadata.
        """
        try:
            _, _, metadata = self.processor.load_audio(filepath)
            return metadata
        except Exception as e:
            logger.error(f"Error loading metadata for {filepath}: {str(e)}")
            raise

    def analyze_audio(self, filepath: str, mode: str = 'standard') -> Dict[str, Any]:
        """
        Perform audio analysis on a file.

        Args:
            filepath: Path to the audio file.
            mode: Analysis mode ('quick', 'standard', 'advanced').

        Returns:
            Dictionary containing analysis results and summary.
        """
        session_id = os.path.basename(filepath)
        self._analysis_progress[session_id] = 0

        def progress_callback(progress: float):
            self._analysis_progress[session_id] = int(progress * 100)

        try:
            results, metadata = self.processor.analyze_file(
                filepath, mode, progress_callback
            )
            
            # Format results for consistent output
            formatted_results = []
            for result in results:
                formatted_results.append({
                    'time': result.get('time', 0),
                    'timestamp': result.get('time_formatted', ''),
                    'note': result.get('note', '—'),
                    'frequency': result.get('frequency', 0),
                    'confidence': result.get('confidence', 0)
                })
                
            return {
                'success': True,
                'results': formatted_results,
                'summary': {
                    'total_segments': len(results),
                    'duration': metadata.get('duration', 0),
                    'mode': mode
                }
            }
        except Exception as e:
            logger.error(f"Analysis failed for {filepath}: {str(e)}")
            raise
        finally:
            # Clean up progress
            self._analysis_progress.pop(session_id, None)

    def get_progress(self, filename: str) -> int:
        """
        Get the current analysis progress for a file.

        Args:
            filename: Name of the file (session ID).

        Returns:
            Progress percentage (0-100).
        """
        return self._analysis_progress.get(filename, 0)

    def create_visualizations(self, filepath: str) -> Dict[str, Any]:
        """
        Generate visualization data for an audio file.

        Args:
            filepath: Path to the audio file.

        Returns:
            Dictionary containing waveform and spectrum data.
        """
        try:
            return self.processor.create_visualizations(filepath)
        except Exception as e:
            logger.error(f"Visualization failed for {filepath}: {str(e)}")
            raise

    def cleanup_file(self, filepath: str) -> bool:
        """
        Remove a file from the filesystem.

        Args:
            filepath: Path to the file to remove.

        Returns:
            True if successful, False otherwise.
        """
        try:
            if filepath and os.path.exists(filepath):
                os.remove(filepath)
                return True
            return False
        except Exception as e:
            logger.error(f"Error cleaning up file {filepath}: {str(e)}")
            raise
