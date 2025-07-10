const fs = require('fs');
const path = require('path');

// Setup directories
const baseDir = path.join(__dirname, '../..');
const audioDir = path.join(baseDir, 'output/audio');
const logsDir = path.join(baseDir, 'logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function main() {
  console.log('📤 Creating mock audio upload mapping...');
  
  // Find audio files
  const audioFiles = fs.readdirSync(audioDir)
    .filter(f => f.endsWith('.wav'))
    .map(f => {
      const parts = f.replace('.wav', '').split('_');
      return {
        filename: f,
        broker_id: parts[0],
        call_id: parts.slice(1).join('_')
      };
    });
  
  console.log(`📊 Found ${audioFiles.length} audio files`);
  
  // Create mock upload mappings
  const timestamp = Math.floor(Date.now() / 1000);
  const csvLines = ['broker_id,call_id,file_url'];
  
  audioFiles.forEach(file => {
    const mockUrl = `https://veeteshrup-20440.bubbleapps.io/uploads/audio_${file.broker_id}_${file.call_id}.wav`;
    csvLines.push(`${file.broker_id},${file.call_id},"${mockUrl}"`);
  });
  
  const csvContent = csvLines.join('\n');
  const csvFile = path.join(logsDir, `audio_upload_mapping_${timestamp}.csv`);
  
  fs.writeFileSync(csvFile, csvContent);
  console.log(`✅ Created mock audio upload mapping: ${path.basename(csvFile)}`);
  
  return true;
}

// Run if called directly
if (require.main === module) {
  main().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { main };