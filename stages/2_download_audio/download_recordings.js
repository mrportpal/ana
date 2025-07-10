const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx');
require('dotenv').config({ path: process.env.CONFIG_PATH ? path.dirname(process.env.CONFIG_PATH) + '/.env' : '../../.env' });

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/pipeline_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Directories
const inputDir = path.join(__dirname, '../../output/call_ids');
const outputDir = path.join(__dirname, '../../output/audio');
const failedDir = path.join(__dirname, '../../output/audio/failed');

// Create directories
[outputDir, failedDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Utility functions
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadFile(url, filepath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`📥 Downloading (attempt ${attempt}/${retries}): ${path.basename(filepath)}`);
      
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        timeout: 30000, // 30 second timeout
      });

      const writer = fs.createWriteStream(filepath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      console.log(`❌ Download attempt ${attempt} failed: ${error.message}`);
      
      if (attempt === retries) {
        throw error;
      }
      
      await delay(config.execution.retry_delay_seconds * 1000);
    }
  }
}

function loadCallData() {
  const allCalls = [];
  
  // Load from individual date files
  if (fs.existsSync(inputDir)) {
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.xlsx'));
    
    for (const file of files) {
      try {
        const filePath = path.join(inputDir, file);
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        allCalls.push(...data);
      } catch (error) {
        console.error(`❌ Error loading ${file}:`, error.message);
      }
    }
  }
  
  return allCalls;
}

async function downloadRecordings() {
  console.log('🎵 Starting audio download...');
  
  const calls = loadCallData();
  console.log(`📊 Found ${calls.length} calls to process`);
  
  const callsWithRecordings = calls.filter(call => call.recording_url && call.recording_url.trim());
  console.log(`🎙️ Calls with recordings: ${callsWithRecordings.length}`);
  
  if (callsWithRecordings.length === 0) {
    console.log('⚠️ No recordings found to download');
    return false;
  }
  
  let successCount = 0;
  let failedCount = 0;
  const failedDownloads = [];
  
  // Create batches for processing
  const batchSize = config.execution.batch_size || 10;
  const batches = [];
  
  for (let i = 0; i < callsWithRecordings.length; i += batchSize) {
    batches.push(callsWithRecordings.slice(i, i + batchSize));
  }
  
  console.log(`📦 Processing ${batches.length} batches of ${batchSize} recordings each`);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`🔄 Processing batch ${batchIndex + 1}/${batches.length}`);
    
    const promises = batch.map(async (call) => {
      const filename = `${call.broker_id}_${call.call_id}.wav`;
      const filepath = path.join(outputDir, filename);
      
      // Skip if already downloaded
      if (fs.existsSync(filepath)) {
        console.log(`⏭️ Skipping existing file: ${filename}`);
        return { success: true, skipped: true };
      }
      
      try {
        await downloadFile(call.recording_url, filepath);
        console.log(`✅ Downloaded: ${filename}`);
        return { success: true, call, filename };
      } catch (error) {
        console.error(`❌ Failed to download ${filename}:`, error.message);
        failedDownloads.push({
          call_id: call.call_id,
          broker_id: call.broker_id,
          recording_url: call.recording_url,
          error: error.message,
          filename
        });
        return { success: false, call, error: error.message };
      }
    });
    
    const results = await Promise.allSettled(promises);
    
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        if (result.value.success && !result.value.skipped) {
          successCount++;
        } else if (!result.value.success) {
          failedCount++;
        }
      } else {
        failedCount++;
      }
    });
    
    // Rate limiting between batches
    if (batchIndex < batches.length - 1) {
      await delay(2000);
    }
  }
  
  // Save failed downloads log
  if (failedDownloads.length > 0) {
    const failedLogPath = path.join(failedDir, 'failed_downloads.json');
    fs.writeFileSync(failedLogPath, JSON.stringify(failedDownloads, null, 2));
    console.log(`📝 Failed downloads logged to: ${failedLogPath}`);
  }
  
  console.log(`✅ Audio download completed`);
  console.log(`📊 Summary:`);
  console.log(`   - Successful: ${successCount}`);
  console.log(`   - Failed: ${failedCount}`);
  console.log(`   - Total processed: ${successCount + failedCount}`);
  
  return successCount > 0;
}

// Main execution
async function main() {
  try {
    const success = await downloadRecordings();
    
    if (success) {
      console.log('✅ Audio download stage completed successfully');
      process.exit(0);
    } else {
      console.log('⚠️ Audio download stage completed with no files downloaded');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Fatal error in audio download:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}