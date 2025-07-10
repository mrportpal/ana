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
const logsDir = path.join(baseDir, 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN;
const BUBBLE_AUDIO_URL = process.env.BUBBLE_AUDIO_URL;

async function uploadAudioToBubble(filePath, callId, brokerId) {
  try {
    console.log(`📤 Uploading ${path.basename(filePath)} to Bubble...`);
    
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream, `audio_${brokerId}_${callId}.wav`);
    
    const response = await axios.post(
      BUBBLE_AUDIO_URL,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${BUBBLE_API_TOKEN}`
        },
        timeout: 60000
      }
    );
    
    if (response.status >= 200 && response.status < 300) {
      const result = response.data;
      // Bubble returns the URL as a plain string, not JSON object
      let fileUrl = '';
      if (typeof result === 'string') {
        fileUrl = result.startsWith('//') ? `https:${result}` : result;
      } else {
        fileUrl = result.url || result.file_url || result.location || result.audio_url || '';
      }
      console.log(`✅ Uploaded successfully: ${fileUrl}`);
      return fileUrl;
    } else {
      console.log(`❌ Upload failed: ${response.status} - ${response.statusText}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Upload failed for ${callId}: ${error.message}`);
    if (error.response) {
      console.error(`Response: ${error.response.status} - ${error.response.data}`);
    }
    return null;
  }
}

async function main() {
  console.log('📤 Starting audio upload to Bubble (limited to 5 for testing)...');
  
  if (!BUBBLE_API_TOKEN || !BUBBLE_AUDIO_URL) {
    console.error('❌ Missing BUBBLE_API_TOKEN or BUBBLE_AUDIO_URL in environment variables');
    return false;
  }
  
  // Find audio files to upload
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
  
  // Create CSV log for audio URL mappings
  const timestamp = Math.floor(Date.now() / 1000);
  const logFile = path.join(logsDir, `audio_upload_mapping_${timestamp}.csv`);
  
  let successful = 0;
  let failed = 0;
  const uploadMappings = [];
  
  for (let i = 0; i < filesToProcess.length; i++) {
    const audioFile = filesToProcess[i];
    console.log(`\n📊 Progress: ${i + 1}/${filesToProcess.length}`);
    
    const fileUrl = await uploadAudioToBubble(
      audioFile.filePath,
      audioFile.callId,
      audioFile.brokerId
    );
    
    if (fileUrl) {
      successful++;
      uploadMappings.push({
        broker_id: audioFile.brokerId,
        call_id: audioFile.callId,
        file_url: fileUrl
      });
    } else {
      failed++;
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Save upload mappings to CSV
  if (uploadMappings.length > 0) {
    const csvLines = ['broker_id,call_id,file_url'];
    uploadMappings.forEach(mapping => {
      csvLines.push(`${mapping.broker_id},${mapping.call_id},"${mapping.file_url}"`);
    });
    
    fs.writeFileSync(logFile, csvLines.join('\n'), 'utf-8');
    console.log(`📝 Saved upload mappings to: ${path.basename(logFile)}`);
  }
  
  console.log(`\n✅ Audio upload completed!`);
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