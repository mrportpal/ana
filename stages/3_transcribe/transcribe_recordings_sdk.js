const fs = require('fs');
const path = require('path');
const { AssemblyAI } = require('assemblyai');
require('dotenv').config({ path: process.env.CONFIG_PATH ? path.dirname(process.env.CONFIG_PATH) + '/.env' : '../../.env' });

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/pipeline_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Setup directories
const baseDir = path.join(__dirname, '../..');
const audioDir = path.join(baseDir, 'output/audio');
const transcriptsDir = path.join(baseDir, 'output/transcripts');

// Create transcripts directory if it doesn't exist
if (!fs.existsSync(transcriptsDir)) {
  fs.mkdirSync(transcriptsDir, { recursive: true });
}

// Initialize AssemblyAI client (like the Python version)
const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY
});

function getAudioFiles() {
  const audioFiles = [];
  
  // Get all .wav files in audio directory
  const wavFiles = fs.readdirSync(audioDir)
    .filter(f => f.endsWith('.wav'))
    .map(f => path.join(audioDir, f));
  
  for (const wavFile of wavFiles) {
    const filename = path.basename(wavFile);
    // Extract broker_id and call_id from filename
    const parts = filename.replace('.wav', '').split('_');
    if (parts.length >= 2) {
      const brokerId = parts[0];
      const callId = parts.slice(1).join('_'); // Handle multi-part call IDs
      
      // Check if already transcribed
      const transcriptFile = path.join(transcriptsDir, `${brokerId}_${callId}.txt`);
      if (!fs.existsSync(transcriptFile)) {
        audioFiles.push({
          filepath: wavFile,
          filename: filename,
          brokerId: brokerId,
          callId: callId,
          transcriptFile: transcriptFile
        });
      }
    }
  }
  
  return audioFiles;
}

async function transcribeFile(fileInfo) {
  try {
    console.log(`🎤 Transcribing: ${fileInfo.filename}`);
    
    // Configure transcription like the Python version
    const config = {
      speech_model: 'slam-1', // Use slam-1 like original
      speaker_labels: true,
      language_code: 'en_us'
    };
    
    // Transcribe file directly (like Python version: transcriber.transcribe(str(file_path)))
    const transcript = await client.transcripts.transcribe({
      audio: fileInfo.filepath,
      ...config
    });
    
    if (transcript.status === 'error') {
      console.log(`❌ Transcription failed for ${fileInfo.filename}: ${transcript.error}`);
      return { success: false, error: transcript.error, file: fileInfo.filename };
    }
    
    // Format transcript text (similar to Python version)
    const formattedText = formatTranscript(transcript);
    
    // Save transcript
    fs.writeFileSync(fileInfo.transcriptFile, formattedText, 'utf-8');
    
    console.log(`✅ Transcribed: ${fileInfo.filename}`);
    return { success: true, file: fileInfo.filename, transcriptFile: fileInfo.transcriptFile };
    
  } catch (error) {
    console.error(`❌ Error transcribing ${fileInfo.filename}: ${error.message}`);
    return { success: false, error: error.message, file: fileInfo.filename };
  }
}

function formatTranscript(transcript) {
  // Format like the Python version with speaker labels and timestamps
  if (!transcript.utterances || transcript.utterances.length === 0) {
    return transcript.text || "No transcript available";
  }
  
  const formattedLines = [];
  for (const utterance of transcript.utterances) {
    // Convert milliseconds to time format like Python version
    const startMs = utterance.start;
    const totalSeconds = Math.floor(startMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    let timestamp;
    if (hours > 0) {
      timestamp = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      timestamp = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    const speaker = `Speaker ${utterance.speaker}`;
    formattedLines.push(`[${timestamp}] ${speaker}: ${utterance.text}`);
  }
  
  return formattedLines.join('\n');
}

async function main() {
  console.log('🎤 Starting transcription (limited to 5 for testing)...');
  
  // Get audio files
  const audioFiles = getAudioFiles();
  console.log(`📊 Found ${audioFiles.length} audio files`);
  
  if (audioFiles.length === 0) {
    console.log('⚠️ No audio files found for transcription');
    return false;
  }
  
  // Apply test limit from config
  const testLimit = config.execution.test_limit || 5;
  const filesToProcess = audioFiles.slice(0, testLimit);
  
  console.log(`🧪 Processing ${filesToProcess.length} files for testing`);
  
  const results = [];
  
  // Process files sequentially (like Python version with ThreadPoolExecutor but simpler)
  for (let i = 0; i < filesToProcess.length; i++) {
    const fileInfo = filesToProcess[i];
    console.log(`\n📊 Progress: ${i + 1}/${filesToProcess.length}`);
    
    const result = await transcribeFile(fileInfo);
    results.push(result);
  }
  
  console.log(`\n✅ Transcription completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Successful: ${results.filter(r => r.success).length}`);
  console.log(`   - Failed: ${results.filter(r => !r.success).length}`);
  console.log(`   - Total: ${results.length}`);
  
  return results.filter(r => r.success).length > 0;
}

if (require.main === module) {
  main().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { main };