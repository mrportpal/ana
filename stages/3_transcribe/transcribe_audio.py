#!/usr/bin/env python3

import os
import json
import time
import glob
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
import assemblyai as aai

# Load configuration
config_path = os.environ.get('CONFIG_PATH', '../../config/pipeline_config.json')
with open(config_path, 'r') as f:
    config = json.load(f)

# Load environment variables
env_path = os.path.join(os.path.dirname(config_path), '.env')
load_dotenv(env_path)

# Setup directories
base_dir = Path(__file__).parent.parent.parent
audio_dir = base_dir / 'output' / 'audio'
transcripts_dir = base_dir / 'output' / 'transcripts'
logs_dir = base_dir / 'logs'

# Create directories
transcripts_dir.mkdir(parents=True, exist_ok=True)
logs_dir.mkdir(parents=True, exist_ok=True)

# Setup AssemblyAI
api_key = os.getenv('ASSEMBLYAI_API_KEY')
if not api_key:
    print("❌ Missing ASSEMBLYAI_API_KEY in environment")
    exit(1)

aai.settings.api_key = api_key

# Configure transcriber
transcriber = aai.Transcriber(
    config=aai.TranscriptionConfig(
        speech_model=aai.SpeechModel.slam_1,  # Use slam_1 like original pipeline
        speaker_labels=config['api_config']['assemblyai']['speaker_labels'],
        language_code=config['api_config']['assemblyai']['language_code'],
        summarization=False,
        sentiment_analysis=False,
        entity_detection=False
    )
)

def get_audio_files():
    """Get list of audio files to transcribe"""
    audio_files = []
    
    # Get all .wav files in audio directory
    wav_files = glob.glob(str(audio_dir / '*.wav'))
    
    for wav_file in wav_files:
        filename = os.path.basename(wav_file)
        # Extract broker_id and call_id from filename
        parts = filename.replace('.wav', '').split('_')
        if len(parts) >= 2:
            broker_id = parts[0]
            call_id = '_'.join(parts[1:])  # Handle multi-part call IDs
            
            # Check if already transcribed
            transcript_file = transcripts_dir / f"{broker_id}_{call_id}.txt"
            if not transcript_file.exists():
                audio_files.append({
                    'filepath': wav_file,
                    'filename': filename,
                    'broker_id': broker_id,
                    'call_id': call_id,
                    'transcript_file': transcript_file
                })
    
    return audio_files

def transcribe_file(file_info):
    """Transcribe a single audio file"""
    try:
        print(f"🎙️ Transcribing: {file_info['filename']}")
        
        # Start transcription
        transcript = transcriber.transcribe(file_info['filepath'])
        
        if transcript.status == aai.TranscriptStatus.error:
            print(f"❌ Transcription failed for {file_info['filename']}: {transcript.error}")
            return {'success': False, 'error': transcript.error, 'file': file_info['filename']}
        
        # Format transcript text
        formatted_text = format_transcript(transcript)
        
        # Save transcript
        with open(file_info['transcript_file'], 'w', encoding='utf-8') as f:
            f.write(formatted_text)
        
        # Save raw JSON
        json_file = file_info['transcript_file'].with_suffix('.json')
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump({
                'id': transcript.id,
                'text': transcript.text,
                'confidence': transcript.confidence,
                'words': [{'text': w.text, 'start': w.start, 'end': w.end, 'confidence': w.confidence, 'speaker': getattr(w, 'speaker', None)} for w in transcript.words] if transcript.words else [],
                'utterances': [{'text': u.text, 'start': u.start, 'end': u.end, 'confidence': u.confidence, 'speaker': u.speaker} for u in transcript.utterances] if transcript.utterances else []
            }, f, indent=2)
        
        print(f"✅ Transcribed: {file_info['filename']}")
        return {'success': True, 'file': file_info['filename'], 'transcript_file': str(file_info['transcript_file'])}
        
    except Exception as e:
        print(f"❌ Error transcribing {file_info['filename']}: {str(e)}")
        return {'success': False, 'error': str(e), 'file': file_info['filename']}

def format_transcript(transcript):
    """Format transcript with speaker labels and timestamps"""
    if not transcript.utterances:
        return transcript.text or "No transcript available"
    
    formatted_lines = []
    for utterance in transcript.utterances:
        timestamp = format_timestamp(utterance.start)
        speaker = f"Speaker {utterance.speaker}" if utterance.speaker else "Unknown"
        formatted_lines.append(f"[{timestamp}] {speaker}: {utterance.text}")
    
    return "\n".join(formatted_lines)

def format_timestamp(milliseconds):
    """Format timestamp from milliseconds to MM:SS"""
    seconds = milliseconds // 1000
    minutes = seconds // 60
    seconds = seconds % 60
    return f"{minutes:02d}:{seconds:02d}"

def save_results_log(results):
    """Save transcription results to log file"""
    log_file = logs_dir / f"transcription_results_{int(time.time())}.json"
    
    summary = {
        'total_files': len(results),
        'successful': len([r for r in results if r['success']]),
        'failed': len([r for r in results if not r['success']]),
        'timestamp': time.time(),
        'results': results
    }
    
    with open(log_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    
    print(f"📝 Results logged to: {log_file}")
    return summary

def main():
    """Main transcription process"""
    print("🎙️ Starting audio transcription...")
    
    # Get audio files
    audio_files = get_audio_files()
    print(f"📊 Found {len(audio_files)} audio files to transcribe")
    
    if not audio_files:
        print("⚠️ No audio files found for transcription")
        return False
    
    # Process files with threading
    max_workers = min(config['execution']['concurrent_workers'], len(audio_files))
    results = []
    
    print(f"🔄 Processing with {max_workers} concurrent workers")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all transcription tasks
        future_to_file = {executor.submit(transcribe_file, file_info): file_info for file_info in audio_files}
        
        # Process completed tasks
        for future in as_completed(future_to_file):
            result = future.result()
            results.append(result)
            
            # Progress update
            completed = len(results)
            total = len(audio_files)
            progress = (completed / total) * 100
            print(f"📊 Progress: {completed}/{total} ({progress:.1f}%)")
    
    # Save results and summary
    summary = save_results_log(results)
    
    print(f"\n✅ Transcription completed!")
    print(f"📊 Summary:")
    print(f"   - Total files: {summary['total_files']}")
    print(f"   - Successful: {summary['successful']}")
    print(f"   - Failed: {summary['failed']}")
    
    return summary['successful'] > 0

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n⚠️ Transcription interrupted by user")
        exit(1)
    except Exception as e:
        print(f"❌ Fatal error in transcription: {str(e)}")
        exit(1)