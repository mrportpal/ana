#!/usr/bin/env python3

import os
import json
import time
import glob
import requests
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

# Add parent directory to path to import pipeline state
sys.path.append(str(Path(__file__).parent.parent.parent))
from lib.pipeline_state_python import PipelineState

# Load configuration
config_path = os.environ.get('CONFIG_PATH', '../../config/pipeline_config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

# Load environment variables
env_path = os.path.join(os.path.dirname(config_path), '.env')
load_dotenv(env_path)

# Setup directories and state
base_dir = Path(__file__).parent.parent.parent
audio_dir = base_dir / 'output' / 'audio'
logs_dir = base_dir / 'logs'
completed_dir = base_dir / 'output' / 'audio' / 'completed'
pipeline_state = PipelineState(base_dir)

# Create directories
completed_dir.mkdir(parents=True, exist_ok=True)
logs_dir.mkdir(parents=True, exist_ok=True)

# Bubble API configuration
bubble_url = os.getenv('BUBBLE_AUDIO_URL')
api_token = os.getenv('BUBBLE_API_TOKEN')

if not bubble_url or not api_token:
    print("❌ Missing BUBBLE_AUDIO_URL or BUBBLE_API_TOKEN in environment")
    exit(1)

def get_audio_files():
    """Get list of audio files to upload (excluding already uploaded)"""
    audio_files = []
    
    # Get all .wav files in audio directory
    wav_files = glob.glob(str(audio_dir / '*.wav'))
    
    for wav_file in wav_files:
        filename = os.path.basename(wav_file)
        # Extract broker_id and call_id from filename
        parts = filename.replace('.wav', '').split('_')
        if len(parts) >= 2:
            broker_id = parts[0]
            call_id = parts[1]
            
            # Skip if already uploaded
            if pipeline_state.is_audio_uploaded(call_id):
                print(f"⏭️ Skipping already uploaded: {filename}")
                continue
            
            audio_files.append({
                'filepath': wav_file,
                'filename': filename,
                'broker_id': broker_id,
                'call_id': call_id,
                'file_size': os.path.getsize(wav_file)
            })
    
    return audio_files

def upload_audio_file(file_info):
    """Upload a single audio file to Bubble"""
    try:
        print(f"📤 Uploading: {file_info['filename']} ({file_info['file_size']} bytes)")
        
        # Prepare file for upload
        with open(file_info['filepath'], 'rb') as audio_file:
            files = {
                'audio_file': (file_info['filename'], audio_file, 'audio/wav')
            }
            
            # Prepare form data
            data = {
                'call_id': file_info['call_id'],
                'broker_id': file_info['broker_id'],
                'filename': file_info['filename'],
                'file_size': file_info['file_size'],
                'upload_timestamp': int(time.time()),
                'source': 'pipeline_automated'
            }
            
            # Make API request
            headers = {
                'Authorization': f'Bearer {api_token}'
            }
            
            response = requests.post(
                bubble_url,
                files=files,
                data=data,
                headers=headers,
                timeout=120  # 2 minutes timeout for large files
            )
        
        if response.status_code in [200, 201]:
            print(f"✅ Uploaded: {file_info['filename']}")
            
            # Parse response to get file URL
            response_data = response.json() if response.content else {}
            file_url = response_data.get('file_url', '')
            
            # Update state management
            pipeline_state.mark_audio_uploaded(file_info['call_id'], file_url)
            
            # Archive the file
            archived_path = pipeline_state.archive_file(
                file_info['filepath'], 
                'audio', 
                file_info['call_id']
            )
            
            return {
                'success': True,
                'file': file_info['filename'],
                'call_id': file_info['call_id'],
                'broker_id': file_info['broker_id'],
                'file_url': file_url,
                'bubble_response': response_data
            }
        else:
            error_msg = f"HTTP {response.status_code}: {response.text}"
            print(f"❌ Upload failed for {file_info['filename']}: {error_msg}")
            return {'success': False, 'error': error_msg, 'file': file_info['filename']}
            
    except requests.exceptions.RequestException as e:
        error_msg = f"Request error: {str(e)}"
        print(f"❌ Upload failed for {file_info['filename']}: {error_msg}")
        pipeline_state.mark_audio_upload_failed(file_info['call_id'], error_msg)
        return {'success': False, 'error': error_msg, 'file': file_info['filename']}
    
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        print(f"❌ Upload failed for {file_info['filename']}: {error_msg}")
        pipeline_state.mark_audio_upload_failed(file_info['call_id'], error_msg)
        return {'success': False, 'error': error_msg, 'file': file_info['filename']}

def save_results_log(results):
    """Save upload results to log file"""
    log_file = logs_dir / f"audio_upload_results_{int(time.time())}.json"
    
    # Create URL mapping for next stages
    url_mapping = {}
    for result in results:
        if result['success'] and 'file_url' in result:
            url_mapping[result['call_id']] = result['file_url']
    
    summary = {
        'total_files': len(results),
        'successful': len([r for r in results if r['success']]),
        'failed': len([r for r in results if not r['success']]),
        'timestamp': time.time(),
        'url_mapping': url_mapping,
        'results': results
    }
    
    with open(log_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    
    # Also save CSV format for easy access by next stages
    csv_file = logs_dir / f"audio_upload_mapping_{int(time.time())}.csv"
    with open(csv_file, 'w', encoding='utf-8') as f:
        f.write("broker_id,call_id,file_url\n")
        for result in results:
            if result['success'] and 'file_url' in result:
                f.write(f"{result['broker_id']},{result['call_id']},{result['file_url']}\n")
    
    print(f"📝 Results logged to: {log_file}")
    print(f"📝 URL mapping saved to: {csv_file}")
    return summary

def main():
    """Main audio upload process"""
    print("📤 Starting audio upload to Bubble...")
    
    # Get audio files
    audio_files = get_audio_files()
    print(f"📊 Found {len(audio_files)} audio files to upload")
    
    if not audio_files:
        print("⚠️ No audio files found for upload")
        return False
    
    # Calculate total size
    total_size = sum(f['file_size'] for f in audio_files)
    total_size_mb = total_size / (1024 * 1024)
    print(f"📊 Total upload size: {total_size_mb:.2f} MB")
    
    # Process files with limited concurrency (file uploads are heavy)
    max_workers = min(2, len(audio_files))  # Limit to 2 concurrent uploads
    results = []
    
    print(f"🔄 Processing with {max_workers} concurrent workers")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all upload tasks
        future_to_file = {executor.submit(upload_audio_file, file_info): file_info for file_info in audio_files}
        
        # Process completed tasks
        for future in as_completed(future_to_file):
            result = future.result()
            results.append(result)
            
            # Progress update
            completed = len(results)
            total = len(audio_files)
            progress = (completed / total) * 100
            print(f"📊 Progress: {completed}/{total} ({progress:.1f}%)")
            
            # Small delay to avoid overwhelming the server
            time.sleep(1)
    
    # Save results and summary
    summary = save_results_log(results)
    
    print(f"\n✅ Audio upload completed!")
    print(f"📊 Summary:")
    print(f"   - Total files: {summary['total_files']}")
    print(f"   - Successful: {summary['successful']}")
    print(f"   - Failed: {summary['failed']}")
    print(f"   - URLs mapped: {len(summary['url_mapping'])}")
    
    # Log failed uploads
    failed_uploads = [r for r in results if not r['success']]
    if failed_uploads:
        print(f"\n❌ Failed uploads:")
        for failed in failed_uploads:
            print(f"   - {failed['file']}: {failed['error']}")
    
    return summary['successful'] > 0

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n⚠️ Upload interrupted by user")
        exit(1)
    except Exception as e:
        print(f"❌ Fatal error in audio upload: {str(e)}")
        exit(1)