#!/usr/bin/env python3

import os
import json
import pandas as pd
import requests
from pathlib import Path
import time

# Load configuration
config_path = os.environ.get('CONFIG_PATH', '../../config/pipeline_config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

# Setup directories
base_dir = Path(config['directories']['base_dir'])
call_ids_dir = base_dir / 'output' / 'call_ids'
audio_dir = base_dir / 'output' / 'audio'
audio_dir.mkdir(exist_ok=True)

def download_audio(recording_url, call_id, broker_id):
    """Download audio file from recording URL"""
    try:
        print(f"🔽 Downloading audio for call {call_id}...")
        
        response = requests.get(recording_url, timeout=30)
        response.raise_for_status()
        
        filename = f"{broker_id}_{call_id}.wav"
        file_path = audio_dir / filename
        
        with open(file_path, 'wb') as f:
            f.write(response.content)
        
        print(f"✅ Downloaded: {filename}")
        return str(file_path), filename
        
    except Exception as e:
        print(f"❌ Failed to download {call_id}: {str(e)}")
        return None, None

def main():
    print("🔽 Starting audio download (limited to 5 for testing)...")
    
    # Load call IDs from Excel files
    calls_with_recordings = []
    
    for xlsx_file in call_ids_dir.glob('*.xlsx'):
        if xlsx_file.name == 'all_calls.xlsx':
            continue
            
        df = pd.read_excel(xlsx_file)
        
        # Filter calls that have recording URLs
        for _, row in df.iterrows():
            if pd.notna(row.get('recording_url')) and row['recording_url'].strip():
                calls_with_recordings.append({
                    'call_id': row['call_id'],
                    'broker_id': row.get('broker_id', row.get('from_username', 'unknown')),
                    'recording_url': row['recording_url'],
                    'from_name': row.get('from_name', ''),
                    'to_number': row.get('to_number', ''),
                    'from_number': row.get('from_number', ''),
                    'duration': row.get('duration', 0)
                })
    
    print(f"📊 Found {len(calls_with_recordings)} calls with recordings")
    
    # Limit to test_limit for testing
    test_limit = config['execution'].get('test_limit', 5)
    calls_to_process = calls_with_recordings[:test_limit]
    
    print(f"🧪 Processing {len(calls_to_process)} calls for testing")
    
    downloaded_files = []
    
    for i, call in enumerate(calls_to_process, 1):
        print(f"\n📊 Progress: {i}/{len(calls_to_process)}")
        
        file_path, filename = download_audio(
            call['recording_url'],
            call['call_id'],
            call['broker_id']
        )
        
        if file_path:
            downloaded_files.append({
                'call_id': call['call_id'],
                'broker_id': call['broker_id'],
                'filename': filename,
                'file_path': file_path,
                'from_name': call['from_name'],
                'to_number': call['to_number'],
                'from_number': call['from_number'],
                'duration': call['duration']
            })
        
        # Rate limiting
        time.sleep(1)
    
    print(f"\n✅ Audio download completed!")
    print(f"📊 Summary:")
    print(f"   - Downloaded: {len(downloaded_files)}")
    print(f"   - Failed: {len(calls_to_process) - len(downloaded_files)}")
    print(f"   - Total: {len(calls_to_process)}")

if __name__ == "__main__":
    main()