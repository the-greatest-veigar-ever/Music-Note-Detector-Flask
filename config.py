import os
from datetime import timedelta


class Config:
    """Base configuration"""
    # Basic Flask config
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'

    # File upload config
    UPLOAD_FOLDER = os.path.join('static', 'uploads')
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB max file size
    ALLOWED_EXTENSIONS = {'wav', 'mp3', 'flac', 'm4a', 'ogg', 'wma'}

    # Session config
    PERMANENT_SESSION_LIFETIME = timedelta(hours=1)

    # Audio processing config
    SAMPLE_RATE = 22050  # Default sample rate for processing
    HOP_LENGTH_QUICK = 1.0  # seconds
    HOP_LENGTH_STANDARD = 0.25  # seconds
    HOP_LENGTH_ADVANCED = 0.1  # seconds

    # Pitch detection range
    MIN_FREQUENCY = 80  # Hz (E2)
    MAX_FREQUENCY = 2000  # Hz (B6)


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    TESTING = False
    # In production, SECRET_KEY should come from environment variable


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}