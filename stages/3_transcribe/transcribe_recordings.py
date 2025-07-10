#!/usr/bin/env python3

import os
import json
import requests
import time
from pathlib import Path

# Load configuration
config_path = os.environ.get('CONFIG_PATH', '../../config/pipeline_config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

# Load environment variables
from dotenv import load_dotenv
env_path = Path(config['directories']['base_dir']) / '.env'
load_dotenv(env_path)

# Setup directories
base_dir = Path(config['directories']['base_dir'])
audio_dir = base_dir / 'output' / 'audio'
transcripts_dir = base_dir / 'output' / 'transcripts'
transcripts_dir.mkdir(exist_ok=True)

ASSEMBLYAI_API_KEY = os.getenv('ASSEMBLYAI_API_KEY')
ASSEMBLYAI_URL = config['api_config']['assemblyai']['base_url']

def upload_audio_to_assemblyai(file_path):
    """Upload audio file to AssemblyAI"""
    print(f"📤 Uploading {Path(file_path).name} to AssemblyAI...")
    
    headers = {'authorization': ASSEMBLYAI_API_KEY}
    
    with open(file_path, 'rb') as f:
        response = requests.post(
            f'{ASSEMBLYAI_URL}/upload',
            files={'file': f},
            headers=headers
        )
    
    if response.status_code == 200:
        upload_url = response.json()['upload_url']
        print(f"✅ Uploaded successfully")
        return upload_url
    else:
        print(f"❌ Upload failed: {response.status_code}")
        return None

def create_transcription_job(upload_url):
    """Create transcription job"""
    print("🔄 Creating transcription job...")
    
    headers = {
        'authorization': ASSEMBLYAI_API_KEY,
        'content-type': 'application/json'
    }
    
    data = {
        'audio_url': upload_url,
        'speaker_labels': config['api_config']['assemblyai']['speaker_labels'],
        'speech_model': config['api_config']['assemblyai']['speech_model']
    }
    
    response = requests.post(
        f'{ASSEMBLYAI_URL}/transcript',
        json=data,
        headers=headers
    )
    
    if response.status_code == 200:
        transcript_id = response.json()['id']
        print(f"✅ Transcription job created: {transcript_id}")
        return transcript_id
    else:
        print(f"❌ Job creation failed: {response.status_code}")
        return None

def wait_for_transcription(transcript_id, max_wait=300):
    """Wait for transcription to complete"""
    print(f"⏳ Waiting for transcription {transcript_id}...")
    
    headers = {'authorization': ASSEMBLYAI_API_KEY}
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        response = requests.get(
            f'{ASSEMBLYAI_URL}/transcript/{transcript_id}',
            headers=headers
        )
        
        if response.status_code == 200:
            result = response.json()
            status = result['status']
            
            if status == 'completed':
                print("✅ Transcription completed!")
                return result
            elif status == 'error':
                print(f"❌ Transcription failed: {result.get('error')}")
                return None
            else:
                print(f"🔄 Status: {status}")
                time.sleep(10)
        else:
            print(f"❌ Status check failed: {response.status_code}")
            time.sleep(10)
    
    print("⏰ Transcription timed out")
    return None

def format_transcript_with_speakers(result):
    """Format transcript with speaker labels and timestamps"""
    if not result.get('utterances'):
        return result.get('text', '')
    
    formatted_lines = []
    
    for utterance in result['utterances']:
        # Convert milliseconds to MM:SS format
        start_ms = utterance['start']
        minutes = start_ms // 60000
        seconds = (start_ms % 60000) // 1000
        timestamp = f"[{minutes:02d}:{seconds:02d}]"
        
        speaker = utterance['speaker']
        text = utterance['text']
        
        formatted_lines.append(f"{timestamp} Speaker {speaker}: {text}")
    
    return '\n'.join(formatted_lines)

def transcribe_audio_file(file_path, call_id, broker_id):
    """Complete transcription process for one file"""
    try:
        # Upload audio
        upload_url = upload_audio_to_assemblyai(file_path)
        if not upload_url:
            return False
        
        # Create transcription job
        transcript_id = create_transcription_job(upload_url)
        if not transcript_id:
            return False
        
        # Wait for completion
        result = wait_for_transcription(transcript_id)
        if not result:
            return False
        
        # Format and save transcript
        formatted_transcript = format_transcript_with_speakers(result)
        
        transcript_filename = f"{broker_id}_{call_id}.txt"
        transcript_path = transcripts_dir / transcript_filename
        
        with open(transcript_path, 'w', encoding='utf-8') as f:
            f.write(formatted_transcript)
        
        print(f"💾 Saved transcript: {transcript_filename}")
        return True
        
    except Exception as e:
        print(f"❌ Transcription failed for {call_id}: {str(e)}")
        return False

def main():
    print("🎤 Starting transcription (limited to 5 for testing)...")
    
    if not ASSEMBLYAI_API_KEY:
        print("❌ ASSEMBLYAI_API_KEY not found in environment variables")
        return
    
    # Find audio files to transcribe
    audio_files = []
    for audio_file in audio_dir.glob('*.wav'):
        if '_' in audio_file.stem:
            try:
                broker_id, call_id = audio_file.stem.split('_', 1)
                audio_files.append({
                    'file_path': audio_file,
                    'call_id': call_id,
                    'broker_id': broker_id,
                    'filename': audio_file.name
                })
            except ValueError:
                print(f"⚠️ Skipping file with unexpected format: {audio_file.name}")
    
    print(f"📊 Found {len(audio_files)} audio files")
    
    # Limit for testing
    test_limit = config['execution'].get('test_limit', 5)
    files_to_process = audio_files[:test_limit]
    
    print(f"🧪 Processing {len(files_to_process)} files for testing")
    
    successful = 0
    failed = 0
    
    for i, audio_file in enumerate(files_to_process, 1):
        print(f"\n📊 Progress: {i}/{len(files_to_process)}")
        print(f"🎤 Transcribing: {audio_file['filename']}")
        
        success = transcribe_audio_file(
            audio_file['file_path'],
            audio_file['call_id'],
            audio_file['broker_id']
        )
        
        if success:
            successful += 1
        else:
            failed += 1
        
        # Rate limiting between requests
        if i < len(files_to_process):
            time.sleep(2)
    
    print(f"\n✅ Transcription completed!")
    print(f"📊 Summary:")
    print(f"   - Successful: {successful}")
    print(f"   - Failed: {failed}")
    print(f"   - Total: {len(files_to_process)}")

if __name__ == "__main__":
    main()