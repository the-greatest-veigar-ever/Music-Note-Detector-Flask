# Use Python 3.11 slim image for smaller size and better compatibility
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libsndfile1 \
    libffi-dev \
    libasound2-dev \
    portaudio19-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p static/uploads

# Set environment variables
ENV FLASK_ENV=production
ENV PYTHONPATH=/app

# Expose port
EXPOSE 8080

# Command to run the application
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120", "app:app"]