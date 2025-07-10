const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
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

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const ASSEMBLYAI_URL = config.api_config.assemblyai.base_url;

async function uploadAudioToAssemblyAI(filePath) {
  try {
    console.log(`📤 Uploading ${path.basename(filePath)} to AssemblyAI...`);
    
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream, {
      filename: path.basename(filePath),
      contentType: 'audio/wav'
    });
    
    const response = await axios.post(
      `${ASSEMBLYAI_URL}/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'authorization': ASSEMBLYAI_API_KEY
        }
      }
    );
    
    if (response.status === 200) {
      console.log(`✅ Uploaded successfully`);
      return response.data.upload_url;
    } else {
      console.log(`❌ Upload failed: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Upload error: ${error.message}`);
    return null;
  }
}

async function createTranscriptionJob(uploadUrl) {
  try {
    console.log("🔄 Creating transcription job...");
    
    const data = {
      audio_url: uploadUrl,
      speaker_labels: config.api_config.assemblyai.speaker_labels,
      speech_model: config.api_config.assemblyai.speech_model,
      language_code: config.api_config.assemblyai.language_code
    };
    
    const response = await axios.post(
      `${ASSEMBLYAI_URL}/transcript`,
      data,
      {
        headers: {
          'authorization': ASSEMBLYAI_API_KEY,
          'content-type': 'application/json'
        }
      }
    );
    
    if (response.status === 200) {
      console.log(`✅ Transcription job created: ${response.data.id}`);
      return response.data.id;
    } else {
      console.log(`❌ Job creation failed: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Job creation error: ${error.message}`);
    if (error.response && error.response.data) {
      console.error(`❌ Error details:`, error.response.data);
    }
    return null;
  }
}

async function waitForTranscription(transcriptId, maxWait = 300) {
  console.log(`⏳ Waiting for transcription ${transcriptId}...`);
  
  const startTime = Date.now();
  
  while ((Date.now() - startTime) / 1000 < maxWait) {
    try {
      const response = await axios.get(
        `${ASSEMBLYAI_URL}/transcript/${transcriptId}`,
        {
          headers: {
            'authorization': ASSEMBLYAI_API_KEY
          }
        }
      );
      
      if (response.status === 200) {
        const result = response.data;
        const status = result.status;
        
        if (status === 'completed') {
          console.log("✅ Transcription completed!");
          return result;
        } else if (status === 'error') {
          console.log(`❌ Transcription failed: ${result.error}`);
          return null;
        } else {
          console.log(`🔄 Status: ${status}`);
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        }
      }
    } catch (error) {
      console.error(`❌ Status check error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log("⏰ Transcription timed out");
  return null;
}

function formatTranscriptWithSpeakers(result) {
  if (!result.utterances || result.utterances.length === 0) {
    return result.text || '';
  }
  
  const formattedLines = [];
  
  for (const utterance of result.utterances) {
    // Convert milliseconds to MM:SS format
    const startMs = utterance.start;
    const minutes = Math.floor(startMs / 60000);
    const seconds = Math.floor((startMs % 60000) / 1000);
    const timestamp = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}]`;
    
    const speaker = utterance.speaker;
    const text = utterance.text;
    
    formattedLines.push(`${timestamp} Speaker ${speaker}: ${text}`);
  }
  
  return formattedLines.join('\n');
}

async function transcribeAudioFile(filePath, callId, brokerId) {
  try {
    // Upload audio
    const uploadUrl = await uploadAudioToAssemblyAI(filePath);
    if (!uploadUrl) {
      return false;
    }
    
    // Create transcription job
    const transcriptId = await createTranscriptionJob(uploadUrl);
    if (!transcriptId) {
      return false;
    }
    
    // Wait for completion
    const result = await waitForTranscription(transcriptId);
    if (!result) {
      return false;
    }
    
    // Format and save transcript
    const formattedTranscript = formatTranscriptWithSpeakers(result);
    
    const transcriptFilename = `${brokerId}_${callId}.txt`;
    const transcriptPath = path.join(transcriptsDir, transcriptFilename);
    
    fs.writeFileSync(transcriptPath, formattedTranscript, 'utf-8');
    
    console.log(`💾 Saved transcript: ${transcriptFilename}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Transcription failed for ${callId}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🎤 Starting transcription (limited to 5 for testing)...');
  
  if (!ASSEMBLYAI_API_KEY) {
    console.error('❌ ASSEMBLYAI_API_KEY not found in environment variables');
    return false;
  }
  
  // Find audio files to transcribe
  const audioFiles = [];
  const files = fs.readdirSync(audioDir);
  
  for (const file of files) {
    if (file.endsWith('.wav')) {
      const parts = file.replace('.wav', '').split('_');
      if (parts.length >= 2) {
        audioFiles.push({
          filePath: path.join(audioDir, file),
          brokerId: parts[0],
          callId: parts.slice(1).join('_'),
          filename: file
        });
      }
    }
  }
  
  console.log(`📊 Found ${audioFiles.length} audio files`);
  
  // Limit for testing
  const testLimit = config.execution.test_limit || 5;
  const filesToProcess = audioFiles.slice(0, testLimit);
  
  console.log(`🧪 Processing ${filesToProcess.length} files for testing`);
  
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < filesToProcess.length; i++) {
    const audioFile = filesToProcess[i];
    console.log(`\n📊 Progress: ${i + 1}/${filesToProcess.length}`);
    console.log(`🎤 Transcribing: ${audioFile.filename}`);
    
    const success = await transcribeAudioFile(
      audioFile.filePath,
      audioFile.callId,
      audioFile.brokerId
    );
    
    if (success) {
      successful++;
    } else {
      failed++;
    }
    
    // Rate limiting between requests
    if (i < filesToProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n✅ Transcription completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Successful: ${successful}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`   - Total: ${filesToProcess.length}`);
  
  return successful > 0;
}

// Run if called directly
if (require.main === module) {
  main().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { main };