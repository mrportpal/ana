const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx');
require('dotenv').config({ path: process.env.CONFIG_PATH ? path.dirname(process.env.CONFIG_PATH) + '/.env' : '../../.env' });

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/pipeline_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Setup directories
const baseDir = path.join(__dirname, '../..');
const callIdsDir = path.join(baseDir, 'output/call_ids');
const audioDir = path.join(baseDir, 'output/audio');

// Create audio directory if it doesn't exist
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

async function getRecordingInfo(callId, accessToken) {
  try {
    const url = `https://integrate.versature.com/api/recordings/call_ids/${callId}/`;
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/vnd.integrate.v1.4.0+json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Authentication failed - token may have expired');
    }
    throw error;
  }
}

async function downloadAudio(recordingUrl, callId, brokerId, accessToken) {
  try {
    console.log(`🔽 Getting recording info for call ${callId}...`);
    
    // First get the recording info to get the actual download URL
    const recordingInfo = await getRecordingInfo(callId, accessToken);
    
    if (recordingInfo.status !== 'Available' || !recordingInfo.url) {
      console.log(`⏭️ Recording not available for ${callId}`);
      return null;
    }
    
    console.log(`🔽 Downloading audio from: ${recordingInfo.url}`);
    
    // Download from the actual URL (no auth needed for this URL)
    const response = await axios.get(recordingInfo.url, {
      responseType: 'stream',
      timeout: 30000
    });
    
    // Use only first 3 characters of broker_id like the original script
    const shortBrokerId = brokerId.slice(0, 3);
    const filename = `${shortBrokerId}_${callId}.wav`;
    const filePath = path.join(audioDir, filename);
    
    // Create write stream and pipe the response
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    // Wait for download to complete
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log(`✅ Downloaded: ${filename}`);
    return { filePath, filename };
    
  } catch (error) {
    console.error(`❌ Failed to download ${callId}: ${error.message}`);
    return null;
  }
}

async function getAccessToken() {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.NET2PHONE_CLIENT_ID);
    params.append('client_secret', process.env.NET2PHONE_CLIENT_SECRET);

    const response = await axios.post(
      config.api_config.net2phone.base_url + config.api_config.net2phone.token_endpoint,
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data.access_token;
  } catch (error) {
    throw new Error(`Failed to get access token: ${error.response?.data?.error || error.message}`);
  }
}

async function main() {
  console.log('🔽 Starting audio download (limited to 5 for testing)...');
  
  // Get access token first
  console.log('📡 Getting access token...');
  const accessToken = await getAccessToken();
  console.log('✅ Access token obtained');
  
  // Load call IDs from Excel files
  const callsWithRecordings = [];
  
  const xlsxFiles = fs.readdirSync(callIdsDir).filter(f => f.endsWith('.xlsx'));
  
  for (const xlsxFile of xlsxFiles) {
    if (xlsxFile === 'all_calls.xlsx') continue;
    
    const filePath = path.join(callIdsDir, xlsxFile);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    // Filter calls that have recording URLs
    data.forEach(row => {
      if (row.recording_url && row.recording_url.trim()) {
        callsWithRecordings.push({
          call_id: row.call_id,
          broker_id: row.broker_id || row.from_username || 'unknown',
          recording_url: row.recording_url,
          from_name: row.from_name || '',
          to_number: row.to_number || '',
          from_number: row.from_number || '',
          duration: row.duration || 0,
          start_time: row.start_time || ''
        });
      }
    });
  }
  
  console.log(`📊 Found ${callsWithRecordings.length} calls with recordings`);
  
  // Limit to test_limit for testing
  const testLimit = config.execution.test_limit || 5;
  const callsToProcess = callsWithRecordings.slice(0, testLimit);
  
  console.log(`🧪 Processing ${callsToProcess.length} calls for testing`);
  
  const downloadedFiles = [];
  
  for (let i = 0; i < callsToProcess.length; i++) {
    const call = callsToProcess[i];
    console.log(`\n📊 Progress: ${i + 1}/${callsToProcess.length}`);
    
    const result = await downloadAudio(
      call.recording_url,
      call.call_id,
      call.broker_id,
      accessToken
    );
    
    if (result) {
      downloadedFiles.push({
        ...call,
        filename: result.filename,
        file_path: result.filePath
      });
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n✅ Audio download completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Downloaded: ${downloadedFiles.length}`);
  console.log(`   - Failed: ${callsToProcess.length - downloadedFiles.length}`);
  console.log(`   - Total: ${callsToProcess.length}`);
  
  return downloadedFiles.length > 0;
}

// Run if called directly
if (require.main === module) {
  main().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { main };