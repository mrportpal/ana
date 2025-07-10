#!/usr/bin/env python3

import os
import json
import requests
import csv
from pathlib import Path
import time

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
logs_dir = base_dir / 'logs'
logs_dir.mkdir(exist_ok=True)

BUBBLE_API_TOKEN = os.getenv('BUBBLE_API_TOKEN')
BUBBLE_AUDIO_URL = os.getenv('BUBBLE_AUDIO_URL')

def upload_audio_to_bubble(file_path, call_id, broker_id):
    """Upload audio file to Bubble"""
    try:
        print(f"📤 Uploading {Path(file_path).name} to Bubble...")
        
        headers = {
            'Authorization': f'Bearer {BUBBLE_API_TOKEN}'
        }
        
        with open(file_path, 'rb') as f:
            files = {
                'file': (f'audio_{broker_id}_{call_id}.wav', f, 'audio/wav')
            }
            
            response = requests.post(
                BUBBLE_AUDIO_URL,
                headers=headers,
                files=files,
                timeout=60
            )
        
        if response.status_code in [200, 201]:
            result = response.json()
            file_url = result.get('url', result.get('file_url', ''))
            print(f"✅ Uploaded successfully: {file_url}")
            return file_url
        else:
            print(f"❌ Upload failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Upload failed for {call_id}: {str(e)}")
        return None

def main():
    print("📤 Starting audio upload to Bubble (limited to 5 for testing)...")
    
    if not BUBBLE_API_TOKEN or not BUBBLE_AUDIO_URL:
        print("❌ Missing BUBBLE_API_TOKEN or BUBBLE_AUDIO_URL in environment variables")
        return
    
    # Find audio files to upload
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
    
    # Create CSV log for audio URL mappings
    timestamp = int(time.time())
    log_file = logs_dir / f'audio_upload_mapping_{timestamp}.csv'
    
    successful = 0
    failed = 0
    upload_mappings = []
    
    for i, audio_file in enumerate(files_to_process, 1):
        print(f"\n📊 Progress: {i}/{len(files_to_process)}")
        
        file_url = upload_audio_to_bubble(
            audio_file['file_path'],
            audio_file['call_id'],
            audio_file['broker_id']
        )
        
        if file_url:
            successful += 1
            upload_mappings.append({
                'broker_id': audio_file['broker_id'],
                'call_id': audio_file['call_id'],
                'file_url': file_url
            })
        else:
            failed += 1
        
        # Rate limiting
        time.sleep(1)
    
    # Save upload mappings to CSV
    if upload_mappings:
        with open(log_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['broker_id', 'call_id', 'file_url'])
            writer.writeheader()
            writer.writerows(upload_mappings)
        
        print(f"📝 Saved upload mappings to: {log_file.name}")
    
    print(f"\n✅ Audio upload completed!")
    print(f"📊 Summary:")
    print(f"   - Successful: {successful}")
    print(f"   - Failed: {failed}")
    print(f"   - Total: {len(files_to_process)}")

if __name__ == "__main__":
    main()