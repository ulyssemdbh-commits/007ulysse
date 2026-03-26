"""
Speaker Recognition Service using librosa for voice embeddings.
Uses MFCC features + cosine similarity for speaker identification.
"""

import os
import json
import numpy as np
import librosa
from flask import Flask, request, jsonify
from scipy.spatial.distance import cosine
from pathlib import Path
import base64
import tempfile
import hashlib

app = Flask(__name__)

# Configuration
EMBEDDINGS_DIR = Path("speaker_recognition/embeddings")
EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

# Speaker verification threshold (lower = more strict)
SIMILARITY_THRESHOLD = 0.75

def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convert any audio format to WAV using ffmpeg."""
    import subprocess
    try:
        result = subprocess.run([
            "ffmpeg", "-y", "-i", input_path,
            "-ar", "16000", "-ac", "1", "-f", "wav", output_path
        ], capture_output=True, timeout=30)
        return result.returncode == 0
    except Exception as e:
        print(f"[Speaker] FFmpeg conversion failed: {e}")
        return False

def extract_voice_embedding(audio_path: str, sr: int = 16000) -> np.ndarray:
    """
    Extract voice embedding from audio file using MFCC features.
    Returns a fixed-size embedding vector representing the speaker's voice.
    """
    try:
        # Try to load directly first
        try:
            y, sr = librosa.load(audio_path, sr=sr, mono=True)
        except Exception:
            # If direct load fails, try converting with ffmpeg
            wav_path = audio_path + ".converted.wav"
            if convert_to_wav(audio_path, wav_path):
                y, sr = librosa.load(wav_path, sr=sr, mono=True)
                os.unlink(wav_path)
            else:
                raise ValueError("Could not load audio file (conversion failed)")
        
        # Remove silence
        y_trimmed, _ = librosa.effects.trim(y, top_db=20)
        
        if len(y_trimmed) < sr * 0.5:  # Less than 0.5 seconds
            raise ValueError("Audio too short (need at least 0.5 seconds)")
        
        # Extract MFCC features (13 coefficients is standard)
        mfccs = librosa.feature.mfcc(y=y_trimmed, sr=sr, n_mfcc=20)
        
        # Add delta and delta-delta features for more robust representation
        mfcc_delta = librosa.feature.delta(mfccs)
        mfcc_delta2 = librosa.feature.delta(mfccs, order=2)
        
        # Combine all features
        combined = np.vstack([mfccs, mfcc_delta, mfcc_delta2])
        
        # Create fixed-size embedding by computing statistics across time
        embedding = np.concatenate([
            np.mean(combined, axis=1),
            np.std(combined, axis=1),
            np.min(combined, axis=1),
            np.max(combined, axis=1)
        ])
        
        # Normalize the embedding
        embedding = embedding / (np.linalg.norm(embedding) + 1e-8)
        
        return embedding
        
    except Exception as e:
        raise ValueError(f"Failed to extract embedding: {str(e)}")

def get_speaker_profile_path(user_id: str) -> Path:
    """Get the path to a speaker's profile file."""
    safe_id = hashlib.md5(user_id.encode()).hexdigest()
    return EMBEDDINGS_DIR / f"{safe_id}.json"

def load_speaker_profile(user_id: str) -> dict | None:
    """Load a speaker's voice profile from disk."""
    profile_path = get_speaker_profile_path(user_id)
    if profile_path.exists():
        with open(profile_path, 'r') as f:
            data = json.load(f)
            data['embeddings'] = [np.array(e) for e in data['embeddings']]
            if 'mean_embedding' in data:
                data['mean_embedding'] = np.array(data['mean_embedding'])
            return data
    return None

def save_speaker_profile(user_id: str, profile: dict):
    """Save a speaker's voice profile to disk."""
    profile_path = get_speaker_profile_path(user_id)
    save_data = {
        'user_id': user_id,
        'embeddings': [e.tolist() for e in profile['embeddings']],
        'sample_count': profile['sample_count']
    }
    if 'mean_embedding' in profile:
        save_data['mean_embedding'] = profile['mean_embedding'].tolist()
    with open(profile_path, 'w') as f:
        json.dump(save_data, f)

def compute_similarity(embedding1: np.ndarray, embedding2: np.ndarray) -> float:
    """Compute cosine similarity between two embeddings (0-1, higher = more similar)."""
    return 1 - cosine(embedding1, embedding2)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'service': 'speaker-recognition'})

@app.route('/enroll', methods=['POST'])
def enroll_speaker():
    """
    Enroll a voice sample for a user.
    Expects: multipart form with 'audio' file and 'user_id' field.
    """
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        user_id = request.form.get('user_id')
        if not user_id:
            return jsonify({'error': 'No user_id provided'}), 400
        
        audio_file = request.files['audio']
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            # Extract embedding
            embedding = extract_voice_embedding(tmp_path)
            
            # Load existing profile or create new one
            profile = load_speaker_profile(user_id) or {
                'user_id': user_id,
                'embeddings': [],
                'sample_count': 0
            }
            
            # Add new embedding
            profile['embeddings'].append(embedding)
            profile['sample_count'] += 1
            
            # Compute mean embedding from all samples
            profile['mean_embedding'] = np.mean(profile['embeddings'], axis=0)
            
            # Save profile
            save_speaker_profile(user_id, profile)
            
            return jsonify({
                'success': True,
                'user_id': user_id,
                'sample_count': profile['sample_count'],
                'message': f"Enrolled sample {profile['sample_count']} for user {user_id}"
            })
            
        finally:
            os.unlink(tmp_path)
            
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Enrollment failed: {str(e)}'}), 500

@app.route('/identify', methods=['POST'])
def identify_speaker():
    """
    Identify the speaker from an audio sample.
    Expects: multipart form with 'audio' file.
    Returns: speaker identity and confidence score.
    """
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            # Extract embedding from input audio
            input_embedding = extract_voice_embedding(tmp_path)
            
            # Compare against all enrolled speakers
            best_match = None
            best_score = 0.0
            
            for profile_file in EMBEDDINGS_DIR.glob('*.json'):
                with open(profile_file, 'r') as f:
                    profile = json.load(f)
                    mean_embedding = np.array(profile.get('mean_embedding', []))
                    
                    if len(mean_embedding) > 0:
                        similarity = compute_similarity(input_embedding, mean_embedding)
                        
                        if similarity > best_score:
                            best_score = similarity
                            best_match = profile['user_id']
            
            # Check if match exceeds threshold
            if best_score >= SIMILARITY_THRESHOLD:
                return jsonify({
                    'speaker': best_match,
                    'confidence': round(best_score, 3),
                    'verified': True
                })
            else:
                return jsonify({
                    'speaker': 'unknown',
                    'confidence': round(best_score, 3),
                    'verified': False,
                    'best_match': best_match,
                    'threshold': SIMILARITY_THRESHOLD
                })
                
        finally:
            os.unlink(tmp_path)
            
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Identification failed: {str(e)}'}), 500

@app.route('/verify', methods=['POST'])
def verify_speaker():
    """
    Verify if audio matches a specific user's voice.
    Expects: multipart form with 'audio' file and 'user_id' field.
    Returns: verification result and confidence score.
    """
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        user_id = request.form.get('user_id')
        if not user_id:
            return jsonify({'error': 'No user_id provided'}), 400
        
        # Load user profile
        profile = load_speaker_profile(user_id)
        if not profile or 'mean_embedding' not in profile:
            return jsonify({
                'error': f'No voice profile found for user {user_id}',
                'verified': False
            }), 404
        
        audio_file = request.files['audio']
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            # Extract embedding from input audio
            input_embedding = extract_voice_embedding(tmp_path)
            
            # Compare with user's profile
            mean_embedding = np.array(profile['mean_embedding'])
            similarity = compute_similarity(input_embedding, mean_embedding)
            
            # Convert numpy.bool_ to Python bool for JSON serialization
            verified = bool(similarity >= SIMILARITY_THRESHOLD)
            
            return jsonify({
                'user_id': user_id,
                'verified': verified,
                'confidence': float(round(similarity, 3)),
                'threshold': float(SIMILARITY_THRESHOLD)
            })
            
        finally:
            os.unlink(tmp_path)
            
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Verification failed: {str(e)}'}), 500

@app.route('/profiles', methods=['GET'])
def list_profiles():
    """List all enrolled speaker profiles."""
    profiles = []
    for profile_file in EMBEDDINGS_DIR.glob('*.json'):
        with open(profile_file, 'r') as f:
            profile = json.load(f)
            profiles.append({
                'user_id': profile['user_id'],
                'sample_count': profile['sample_count']
            })
    return jsonify({'profiles': profiles})

@app.route('/profiles/<user_id>', methods=['DELETE'])
def delete_profile(user_id: str):
    """Delete a speaker's profile."""
    profile_path = get_speaker_profile_path(user_id)
    if profile_path.exists():
        os.unlink(profile_path)
        return jsonify({'success': True, 'message': f'Profile deleted for {user_id}'})
    return jsonify({'error': 'Profile not found'}), 404

if __name__ == '__main__':
    port = int(os.environ.get('SPEAKER_PORT', 5001))
    print(f"[Speaker Recognition] Starting on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
