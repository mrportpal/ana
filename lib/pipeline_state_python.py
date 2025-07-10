import json
import os
import shutil
from datetime import datetime
from pathlib import Path

class PipelineState:
    """
    Python version of Pipeline State Management
    Handles deduplication, archiving, and cross-stage tracking
    """
    
    def __init__(self, base_dir):
        self.base_dir = Path(base_dir)
        self.state_file = self.base_dir / 'logs' / 'pipeline_state.json'
        self.archive_dir = self.base_dir / 'archive'
        self.state = self.load_state()
        
        # Ensure directories exist
        self.ensure_directories()
    
    def ensure_directories(self):
        """Create necessary directories"""
        dirs = [
            self.base_dir / 'logs',
            self.archive_dir,
            self.archive_dir / 'call_ids',
            self.archive_dir / 'audio',
            self.archive_dir / 'transcripts',
            self.archive_dir / 'failed'
        ]
        
        for dir_path in dirs:
            dir_path.mkdir(parents=True, exist_ok=True)
    
    def load_state(self):
        """Load pipeline state from file"""
        if self.state_file.exists():
            try:
                with open(self.state_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"⚠️ Could not load pipeline state: {e}")
        
        # Default state structure
        return {
            "version": "1.0.0",
            "created": datetime.now().isoformat(),
            "last_updated": datetime.now().isoformat(),
            "stages": {
                "get_call_ids": {
                    "processed_date_ranges": [],
                    "total_calls_extracted": 0,
                    "last_run": None
                },
                "download_audio": {
                    "downloaded_files": {},
                    "failed_downloads": {},
                    "total_downloaded": 0
                },
                "transcribe": {
                    "transcribed_files": {},
                    "failed_transcriptions": {},
                    "total_transcribed": 0
                },
                "upload_audio": {
                    "uploaded_files": {},
                    "failed_uploads": {},
                    "total_uploaded": 0
                },
                "analyze": {
                    "analyzed_calls": {},
                    "failed_analyses": {},
                    "total_analyzed": 0
                }
            },
            "archived_files": {
                "call_ids": [],
                "audio": [],
                "transcripts": []
            }
        }
    
    def save_state(self):
        """Save pipeline state to file"""
        self.state['last_updated'] = datetime.now().isoformat()
        with open(self.state_file, 'w') as f:
            json.dump(self.state, f, indent=2)
    
    # === DEDUPLICATION CHECKS ===
    
    def is_audio_downloaded(self, call_id):
        """Check if audio is already downloaded"""
        files = self.state['stages']['download_audio']['downloaded_files']
        return call_id in files and files[call_id].get('status') == 'completed'
    
    def is_transcribed(self, call_id):
        """Check if call is already transcribed"""
        files = self.state['stages']['transcribe']['transcribed_files']
        return call_id in files and files[call_id].get('status') == 'completed'
    
    def is_audio_uploaded(self, call_id):
        """Check if audio is already uploaded to Bubble"""
        files = self.state['stages']['upload_audio']['uploaded_files']
        return call_id in files and files[call_id].get('status') == 'completed'
    
    def is_analyzed(self, call_id):
        """Check if call is already analyzed"""
        calls = self.state['stages']['analyze']['analyzed_calls']
        return call_id in calls and calls[call_id].get('status') == 'completed'
    
    # === STATE UPDATES ===
    
    def mark_audio_downloaded(self, call_id, broker_id, filename, filepath):
        """Mark audio as successfully downloaded"""
        self.state['stages']['download_audio']['downloaded_files'][call_id] = {
            'status': 'completed',
            'broker_id': broker_id,
            'filename': filename,
            'filepath': str(filepath),
            'completed_at': datetime.now().isoformat()
        }
        self.state['stages']['download_audio']['total_downloaded'] += 1
        self.save_state()
    
    def mark_audio_download_failed(self, call_id, error):
        """Mark audio download as failed"""
        self.state['stages']['download_audio']['failed_downloads'][call_id] = {
            'error': str(error),
            'failed_at': datetime.now().isoformat()
        }
        self.save_state()
    
    def mark_transcribed(self, call_id, filename, transcript_path):
        """Mark transcript as completed"""
        self.state['stages']['transcribe']['transcribed_files'][call_id] = {
            'status': 'completed',
            'filename': filename,
            'transcript_path': str(transcript_path),
            'completed_at': datetime.now().isoformat()
        }
        self.state['stages']['transcribe']['total_transcribed'] += 1
        self.save_state()
    
    def mark_transcription_failed(self, call_id, error):
        """Mark transcription as failed"""
        self.state['stages']['transcribe']['failed_transcriptions'][call_id] = {
            'error': str(error),
            'failed_at': datetime.now().isoformat()
        }
        self.save_state()
    
    def mark_audio_uploaded(self, call_id, bubble_url):
        """Mark audio as uploaded to Bubble"""
        self.state['stages']['upload_audio']['uploaded_files'][call_id] = {
            'status': 'completed',
            'bubble_url': bubble_url,
            'completed_at': datetime.now().isoformat()
        }
        self.state['stages']['upload_audio']['total_uploaded'] += 1
        self.save_state()
    
    def mark_audio_upload_failed(self, call_id, error):
        """Mark audio upload as failed"""
        self.state['stages']['upload_audio']['failed_uploads'][call_id] = {
            'error': str(error),
            'failed_at': datetime.now().isoformat()
        }
        self.save_state()
    
    # === ARCHIVING FUNCTIONS ===
    
    def archive_file(self, source_file, category, call_id=None):
        """Archive a file to the appropriate category"""
        try:
            source_path = Path(source_file)
            if not source_path.exists():
                print(f"❌ Source file not found: {source_file}")
                return None
            
            filename = source_path.name
            timestamp = datetime.now().strftime('%Y-%m-%d')
            archive_path = self.archive_dir / category / timestamp
            
            # Create timestamped archive directory
            archive_path.mkdir(parents=True, exist_ok=True)
            
            destination_file = archive_path / filename
            
            # Move file to archive
            shutil.move(str(source_path), str(destination_file))
            
            # Update state
            self.state['archived_files'][category].append({
                'call_id': call_id,
                'original_filename': filename,
                'archive_path': str(destination_file),
                'archived_at': datetime.now().isoformat()
            })
            
            self.save_state()
            
            print(f"📁 Archived: {filename} → {category}/{timestamp}/")
            return str(destination_file)
            
        except Exception as e:
            print(f"❌ Failed to archive {source_file}: {e}")
            return None
    
    # === UTILITIES ===
    
    def get_processing_stats(self):
        """Get current processing statistics"""
        stages = self.state['stages']
        stats = {
            'total_calls_extracted': stages['get_call_ids']['total_calls_extracted'],
            'audio_downloaded': stages['download_audio']['total_downloaded'],
            'transcribed': stages['transcribe']['total_transcribed'],
            'uploaded_to_bubble': stages['upload_audio']['total_uploaded'],
            'analyzed': stages['analyze']['total_analyzed'],
            'archived_files': sum(len(files) for files in self.state['archived_files'].values())
        }
        
        if stats['total_calls_extracted'] > 0:
            completion_rate = (stats['analyzed'] / stats['total_calls_extracted']) * 100
            stats['completion_rate'] = f"{completion_rate:.1f}%"
        else:
            stats['completion_rate'] = "0%"
        
        return stats
    
    def get_failed_items(self):
        """Get all failed items across stages"""
        stages = self.state['stages']
        return {
            'failed_downloads': list(stages['download_audio']['failed_downloads'].keys()),
            'failed_transcriptions': list(stages['transcribe']['failed_transcriptions'].keys()),
            'failed_uploads': list(stages['upload_audio']['failed_uploads'].keys()),
            'failed_analyses': list(stages['analyze']['failed_analyses'].keys())
        }
    
    def get_calls_for_processing(self, stage):
        """Get call IDs that need processing at specific stage"""
        # Get all downloaded calls as baseline
        downloaded_calls = set()
        for call_id, data in self.state['stages']['download_audio']['downloaded_files'].items():
            if data.get('status') == 'completed':
                downloaded_calls.add(call_id)
        
        # Filter based on stage requirements
        if stage == 'transcribe':
            return [call_id for call_id in downloaded_calls if not self.is_transcribed(call_id)]
        elif stage == 'upload_audio':
            return [call_id for call_id in downloaded_calls if not self.is_audio_uploaded(call_id)]
        elif stage == 'analyze':
            return [call_id for call_id in downloaded_calls 
                   if self.is_transcribed(call_id) and self.is_audio_uploaded(call_id) and not self.is_analyzed(call_id)]
        else:
            return list(downloaded_calls)