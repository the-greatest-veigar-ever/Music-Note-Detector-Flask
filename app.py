import os
import json
from flask import Flask, render_template, request, jsonify, send_file
from flask import send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
import pandas as pd
from datetime import datetime
import io
import logging

from config import config
from utils.audio_processor import AudioProcessor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app(config_name='default'):
    """Create and configure the Flask application"""
    app = Flask(__name__)
    app.config.from_object(config[config_name])
    CORS(app)  # Enable CORS for API calls

    # Ensure upload directory exists
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

    return app


app = create_app(os.environ.get('FLASK_ENV', 'development'))

# Initialize audio processor with the config class (not app.config)
config_name = os.environ.get('FLASK_ENV', 'development')
audio_processor = AudioProcessor(config[config_name])

# Store analysis progress (in production, use Redis or similar)
analysis_progress = {}


@app.route('/')
def index():
    """Main page route"""
    return render_template('index.html')


@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Music Note Detector is running!',
        'version': '1.0.0'
    })


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and \
        filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        if file and allowed_file(file.filename):
            # Generate unique filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = secure_filename(file.filename)
            name, ext = os.path.splitext(filename)
            unique_filename = f"{name}_{timestamp}{ext}"

            filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(filepath)

            # Get file size
            file_size = os.path.getsize(filepath)

            # Load audio metadata
            try:
                _, _, metadata = audio_processor.load_audio(filepath)

                return jsonify({
                    'success': True,
                    'filename': unique_filename,
                    'filepath': filepath,
                    'file_size': file_size,
                    'duration': metadata['duration'],
                    'sample_rate': metadata['sample_rate'],
                    'format': ext[1:].upper(),
                    'metadata': metadata
                })
            except Exception as e:
                os.remove(filepath)  # Clean up on error
                return jsonify({'error': f'Invalid audio file: {str(e)}'}), 400

        return jsonify({'error': 'File type not allowed'}), 400

    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Upload failed'}), 500


@app.route('/analyze', methods=['POST'])
def analyze_audio():
    """Analyze uploaded audio file"""
    try:
        data = request.json
        filepath = data.get('filepath')
        mode = data.get('mode', 'standard')

        if not filepath or not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

        # Start analysis
        session_id = os.path.basename(filepath)
        analysis_progress[session_id] = 0

        def progress_callback(progress):
            analysis_progress[session_id] = int(progress * 100)

        # Perform analysis
        results, metadata = audio_processor.analyze_file(
            filepath, mode, progress_callback
        )

        # Format results for display
        formatted_results = []
        for result in results:
            formatted_results.append({
                'Time': result['time_formatted'],
                'Detected Note': result['note'],
                'Frequency (Hz)': f"{result['frequency']:.2f}" if result['frequency'] > 0 else "—",
                'Confidence': f"{result['confidence']:.2f}",
                'Energy': f"{result['energy']:.3f}"
            })

        # Clean up progress
        analysis_progress.pop(session_id, None)

        return jsonify({
            'success': True,
            'results': formatted_results,
            'summary': {
                'total_segments': len(results),
                'duration': metadata['duration'],
                'mode': mode
            }
        })

    except Exception as e:
        logger.error(f"Analysis error: {str(e)}")
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500


@app.route('/progress/<filename>')
def get_progress(filename):
    """Get analysis progress"""
    progress = analysis_progress.get(filename, 0)
    return jsonify({'progress': progress})


@app.route('/visualize', methods=['POST'])
def create_visualizations():
    """Create visualization data for audio file"""
    try:
        data = request.json
        filepath = data.get('filepath')

        if not filepath or not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

        # Create visualizations
        viz_data = audio_processor.create_visualizations(filepath)

        return jsonify({
            'success': True,
            'visualizations': viz_data
        })

    except Exception as e:
        logger.error(f"Visualization error: {str(e)}")
        return jsonify({'error': 'Visualization failed'}), 500


@app.route('/export/<format>', methods=['POST'])
def export_results(format):
    """Export analysis results in different formats"""
    try:
        data = request.json
        results = data.get('results', [])
        filename = data.get('filename', 'results')

        if not results:
            return jsonify({'error': 'No results to export'}), 400

        # Create DataFrame
        df = pd.DataFrame(results)

        # Generate filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        base_filename = f"note_detection_{filename}_{timestamp}"

        if format == 'csv':
            output = io.StringIO()
            df.to_csv(output, index=False)
            output.seek(0)

            return send_file(
                io.BytesIO(output.getvalue().encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{base_filename}.csv"
            )

        elif format == 'excel':
            output = io.BytesIO()
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df.to_excel(writer, index=False, sheet_name='Note Detection Results')

                # Get workbook and worksheet
                workbook = writer.book
                worksheet = writer.sheets['Note Detection Results']

                # Add formatting
                header_format = workbook.add_format({
                    'bold': True,
                    'bg_color': '#7c3aed',
                    'font_color': 'white',
                    'border': 1
                })

                # Write headers with formatting
                for col_num, value in enumerate(df.columns.values):
                    worksheet.write(0, col_num, value, header_format)

                # Auto-adjust column widths
                for i, col in enumerate(df.columns):
                    max_len = max(df[col].astype(str).str.len().max(), len(col)) + 2
                    worksheet.set_column(i, i, max_len)

            output.seek(0)

            return send_file(
                output,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                as_attachment=True,
                download_name=f"{base_filename}.xlsx"
            )

        elif format == 'txt':
            output = io.StringIO()
            output.write("Music Note Detection Results\n")
            output.write("=" * 50 + "\n\n")
            output.write(df.to_string(index=False))
            output.seek(0)

            return send_file(
                io.BytesIO(output.getvalue().encode()),
                mimetype='text/plain',
                as_attachment=True,
                download_name=f"{base_filename}.txt"
            )

        else:
            return jsonify({'error': 'Invalid format'}), 400

    except Exception as e:
        logger.error(f"Export error: {str(e)}")
        return jsonify({'error': 'Export failed'}), 500


@app.route('/cleanup', methods=['POST'])
def cleanup_file():
    """Remove uploaded file"""
    try:
        data = request.json
        filepath = data.get('filepath')

        if filepath and os.path.exists(filepath):
            os.remove(filepath)
            return jsonify({'success': True, 'message': 'File removed'})

        return jsonify({'error': 'File not found'}), 404

    except Exception as e:
        logger.error(f"Cleanup error: {str(e)}")
        return jsonify({'error': 'Cleanup failed'}), 500

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    """Serve uploaded files"""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large. Maximum size is 50MB'}), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)