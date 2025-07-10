const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Centralized Pipeline State Management
 * Handles deduplication, archiving, and cross-stage tracking
 */
class PipelineState {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.stateFile = path.join(baseDir, 'logs', 'pipeline_state.json');
    this.archiveDir = path.join(baseDir, 'archive');
    this.state = this.loadState();
    
    // Ensure directories exist
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [
      path.join(this.baseDir, 'logs'),
      this.archiveDir,
      path.join(this.archiveDir, 'call_ids'),
      path.join(this.archiveDir, 'audio'),
      path.join(this.archiveDir, 'transcripts'),
      path.join(this.archiveDir, 'failed')
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadState() {
    if (fs.existsSync(this.stateFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      } catch (error) {
        console.warn(`⚠️ Could not load pipeline state: ${error.message}`);
      }
    }
    
    // Default state structure
    return {
      version: "1.0.0",
      created: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      stages: {
        get_call_ids: {
          processed_date_ranges: [],
          total_calls_extracted: 0,
          last_run: null
        },
        download_audio: {
          downloaded_files: {},
          failed_downloads: {},
          total_downloaded: 0
        },
        transcribe: {
          transcribed_files: {},
          failed_transcriptions: {},
          total_transcribed: 0
        },
        upload_audio: {
          uploaded_files: {},
          failed_uploads: {},
          total_uploaded: 0
        },
        analyze: {
          analyzed_calls: {},
          failed_analyses: {},
          total_analyzed: 0
        }
      },
      archived_files: {
        call_ids: [],
        audio: [],
        transcripts: []
      }
    };
  }

  saveState() {
    this.state.last_updated = new Date().toISOString();
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  // === DEDUPLICATION CHECKS ===

  isDateRangeProcessed(startDate, endDate) {
    const ranges = this.state.stages.get_call_ids.processed_date_ranges;
    return ranges.some(range => 
      range.start_date === startDate && range.end_date === endDate
    );
  }

  isCallIdExtracted(callId) {
    // Check if this specific call ID has been extracted
    return this.state.stages.download_audio.downloaded_files.hasOwnProperty(callId);
  }

  isAudioDownloaded(callId) {
    return this.state.stages.download_audio.downloaded_files[callId]?.status === 'completed';
  }

  isTranscribed(callId) {
    return this.state.stages.transcribe.transcribed_files[callId]?.status === 'completed';
  }

  isAudioUploaded(callId) {
    return this.state.stages.upload_audio.uploaded_files[callId]?.status === 'completed';
  }

  isAnalyzed(callId) {
    return this.state.stages.analyze.analyzed_calls[callId]?.status === 'completed';
  }

  // === STATE UPDATES ===

  markDateRangeProcessed(startDate, endDate, callCount) {
    this.state.stages.get_call_ids.processed_date_ranges.push({
      start_date: startDate,
      end_date: endDate,
      call_count: callCount,
      processed_at: new Date().toISOString()
    });
    this.state.stages.get_call_ids.total_calls_extracted += callCount;
    this.state.stages.get_call_ids.last_run = new Date().toISOString();
    this.saveState();
  }

  markAudioDownloaded(callId, brokerId, filename, filepath) {
    this.state.stages.download_audio.downloaded_files[callId] = {
      status: 'completed',
      broker_id: brokerId,
      filename,
      filepath,
      completed_at: new Date().toISOString()
    };
    this.state.stages.download_audio.total_downloaded++;
    this.saveState();
  }

  markAudioDownloadFailed(callId, error) {
    this.state.stages.download_audio.failed_downloads[callId] = {
      error,
      failed_at: new Date().toISOString()
    };
    this.saveState();
  }

  markTranscribed(callId, filename, transcriptPath) {
    this.state.stages.transcribe.transcribed_files[callId] = {
      status: 'completed',
      filename,
      transcript_path: transcriptPath,
      completed_at: new Date().toISOString()
    };
    this.state.stages.transcribe.total_transcribed++;
    this.saveState();
  }

  markTranscriptionFailed(callId, error) {
    this.state.stages.transcribe.failed_transcriptions[callId] = {
      error,
      failed_at: new Date().toISOString()
    };
    this.saveState();
  }

  markAudioUploaded(callId, bubbleUrl) {
    this.state.stages.upload_audio.uploaded_files[callId] = {
      status: 'completed',
      bubble_url: bubbleUrl,
      completed_at: new Date().toISOString()
    };
    this.state.stages.upload_audio.total_uploaded++;
    this.saveState();
  }

  markAudioUploadFailed(callId, error) {
    this.state.stages.upload_audio.failed_uploads[callId] = {
      error,
      failed_at: new Date().toISOString()
    };
    this.saveState();
  }

  markAnalyzed(callId, analysisData) {
    this.state.stages.analyze.analyzed_calls[callId] = {
      status: 'completed',
      analysis_summary: {
        sentiment: analysisData.sentiment,
        success_rating: analysisData.success_rating,
        call_disposition: analysisData.call_disposition
      },
      completed_at: new Date().toISOString()
    };
    this.state.stages.analyze.total_analyzed++;
    this.saveState();
  }

  markAnalysisFailed(callId, error) {
    this.state.stages.analyze.failed_analyses[callId] = {
      error,
      failed_at: new Date().toISOString()
    };
    this.saveState();
  }

  // === ARCHIVING FUNCTIONS ===

  archiveFile(sourceFile, category, callId = null) {
    try {
      const filename = path.basename(sourceFile);
      const timestamp = new Date().toISOString().split('T')[0];
      const archivePath = path.join(this.archiveDir, category, timestamp);
      
      // Create timestamped archive directory
      if (!fs.existsSync(archivePath)) {
        fs.mkdirSync(archivePath, { recursive: true });
      }
      
      const destinationFile = path.join(archivePath, filename);
      
      // Move file to archive
      fs.renameSync(sourceFile, destinationFile);
      
      // Update state
      this.state.archived_files[category].push({
        call_id: callId,
        original_filename: filename,
        archive_path: destinationFile,
        archived_at: new Date().toISOString()
      });
      
      this.saveState();
      
      console.log(`📁 Archived: ${filename} → ${category}/${timestamp}/`);
      return destinationFile;
      
    } catch (error) {
      console.error(`❌ Failed to archive ${sourceFile}:`, error.message);
      return null;
    }
  }

  // === UTILITIES ===

  getProcessingStats() {
    const stats = {
      total_calls_extracted: this.state.stages.get_call_ids.total_calls_extracted,
      audio_downloaded: this.state.stages.download_audio.total_downloaded,
      transcribed: this.state.stages.transcribe.total_transcribed,
      uploaded_to_bubble: this.state.stages.upload_audio.total_uploaded,
      analyzed: this.state.stages.analyze.total_analyzed,
      archived_files: Object.values(this.state.archived_files).flat().length
    };
    
    stats.completion_rate = stats.total_calls_extracted > 0 
      ? ((stats.analyzed / stats.total_calls_extracted) * 100).toFixed(1) + '%'
      : '0%';
    
    return stats;
  }

  getFailedItems() {
    return {
      failed_downloads: Object.keys(this.state.stages.download_audio.failed_downloads),
      failed_transcriptions: Object.keys(this.state.stages.transcribe.failed_transcriptions),
      failed_uploads: Object.keys(this.state.stages.upload_audio.failed_uploads),
      failed_analyses: Object.keys(this.state.stages.analyze.failed_analyses)
    };
  }

  // Get all call IDs that need to be processed at a specific stage
  getCallsForProcessing(stage) {
    const allCalls = new Set();
    
    // Get all downloaded calls (these are our baseline)
    Object.keys(this.state.stages.download_audio.downloaded_files).forEach(callId => {
      if (this.state.stages.download_audio.downloaded_files[callId].status === 'completed') {
        allCalls.add(callId);
      }
    });
    
    // Filter based on stage requirements
    switch (stage) {
      case 'transcribe':
        return Array.from(allCalls).filter(callId => !this.isTranscribed(callId));
      case 'upload_audio':
        return Array.from(allCalls).filter(callId => !this.isAudioUploaded(callId));
      case 'analyze':
        return Array.from(allCalls).filter(callId => 
          this.isTranscribed(callId) && this.isAudioUploaded(callId) && !this.isAnalyzed(callId)
        );
      default:
        return Array.from(allCalls);
    }
  }

  // Reset failed items for retry
  retryFailed(stage) {
    const stageData = this.state.stages[stage];
    if (stageData && stageData.failed_downloads) {
      Object.keys(stageData.failed_downloads).forEach(callId => {
        delete stageData.failed_downloads[callId];
      });
    }
    if (stageData && stageData.failed_transcriptions) {
      Object.keys(stageData.failed_transcriptions).forEach(callId => {
        delete stageData.failed_transcriptions[callId];
      });
    }
    if (stageData && stageData.failed_uploads) {
      Object.keys(stageData.failed_uploads).forEach(callId => {
        delete stageData.failed_uploads[callId];
      });
    }
    if (stageData && stageData.failed_analyses) {
      Object.keys(stageData.failed_analyses).forEach(callId => {
        delete stageData.failed_analyses[callId];
      });
    }
    this.saveState();
  }
}

module.exports = PipelineState;