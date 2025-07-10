const fs = require('fs');
const path = require('path');

// Setup directories
const baseDir = path.join(__dirname, '../..');
const audioDir = path.join(baseDir, 'output/audio');
const transcriptsDir = path.join(baseDir, 'output/transcripts');

// Create transcripts directory if it doesn't exist
if (!fs.existsSync(transcriptsDir)) {
  fs.mkdirSync(transcriptsDir, { recursive: true });
}

// Mock transcripts for different call scenarios
const mockTranscripts = [
  `[00:00] Speaker A: Good morning, this is calling from Blue Pearl Mortgage. How can I help you today?
[00:06] Speaker B: Hi, I received a call earlier about refinancing options. I'd like to learn more.
[00:12] Speaker A: Excellent! I'd be happy to help you explore your refinancing options. Can you tell me about your current mortgage?
[00:20] Speaker B: Sure, I have a 30-year fixed at 7.2% with about $350,000 remaining.
[00:28] Speaker A: I see. With current market rates, we might be able to get you down to around 6.3%, which could save you significant money monthly.
[00:38] Speaker B: That sounds interesting. What would be the closing costs?
[00:42] Speaker A: Great question. Typically closing costs run between 2-3% of the loan amount, but we have programs that can help reduce those.
[00:52] Speaker B: I need to think about it. Can you send me more information?
[00:57] Speaker A: Absolutely! I'll email you a detailed breakdown today. When would be a good time to follow up?
[01:05] Speaker B: Maybe next week? I need to discuss with my spouse.
[01:10] Speaker A: Perfect. I'll follow up next Tuesday. Thank you for your time today!`,

  `[00:00] Speaker A: Hello, this is from Blue Pearl Mortgage returning your call about home purchase financing.
[00:08] Speaker B: Oh yes, thank you for calling back. We're first-time buyers looking for pre-approval.
[00:15] Speaker A: Congratulations on taking this exciting step! What price range are you considering?
[00:22] Speaker B: We're looking at homes around $450,000 to $500,000.
[00:28] Speaker A: Perfect. And how much are you planning to put down?
[00:32] Speaker B: We have about $50,000 saved, so roughly 10%.
[00:37] Speaker A: That's a solid down payment. With 10% down on a $475,000 home, you'd be looking at a loan of about $427,500.
[00:47] Speaker B: What kind of interest rate could we expect?
[00:51] Speaker A: Based on current market conditions, first-time buyers with good credit are seeing rates around 6.5-6.8%.
[01:00] Speaker B: Is that the best you can offer?
[01:03] Speaker A: Let me check if we have any first-time buyer programs that might get you a better rate. Can we schedule a full application review?
[01:12] Speaker B: Yes, let's do that. When are you available?
[01:16] Speaker A: How about tomorrow at 3 PM? I can go over all our programs and get you pre-approved.
[01:23] Speaker B: That works perfectly. Thank you!`,

  `[00:00] Speaker A: Hi, this is calling from Blue Pearl Mortgage. I'm following up on your inquiry about a home equity line of credit.
[00:09] Speaker B: Yes, I'm interested but I have some concerns about the rates.
[00:14] Speaker A: I understand. What specifically are you looking to use the equity for?
[00:20] Speaker B: We want to renovate our kitchen and bathroom, probably need about $80,000.
[00:27] Speaker A: That's a great investment in your home. What's your current home value and mortgage balance?
[00:34] Speaker B: The house is worth about $600,000 and we owe $280,000.
[00:40] Speaker A: Excellent! You have substantial equity. We could offer you a HELOC up to $200,000 at competitive rates.
[00:49] Speaker B: What rates are we talking about?
[00:52] Speaker A: Currently, our HELOC rates start at 7.5% for well-qualified borrowers.
[00:58] Speaker B: That seems high compared to what I've seen advertised.
[01:02] Speaker A: Those advertised rates often come with strict requirements. However, with your equity position, I might be able to get you closer to 7.2%.
[01:12] Speaker B: I'll need to shop around a bit more.
[01:15] Speaker A: I completely understand. Let me send you a formal quote so you can compare accurately. Would that help?
[01:23] Speaker B: Yes, that would be helpful. Thank you.`
];

async function main() {
  console.log('🎤 Creating mock transcripts for testing...');
  
  // Find audio files
  const audioFiles = fs.readdirSync(audioDir)
    .filter(f => f.endsWith('.wav'))
    .map(f => {
      const parts = f.replace('.wav', '').split('_');
      return {
        filename: f,
        brokerId: parts[0],
        callId: parts.slice(1).join('_')
      };
    });
  
  console.log(`📊 Found ${audioFiles.length} audio files to transcribe`);
  
  let successful = 0;
  
  audioFiles.forEach((file, index) => {
    try {
      // Use a different mock transcript for each file
      const transcriptContent = mockTranscripts[index % mockTranscripts.length];
      
      const transcriptFilename = `${file.brokerId}_${file.callId}.txt`;
      const transcriptPath = path.join(transcriptsDir, transcriptFilename);
      
      fs.writeFileSync(transcriptPath, transcriptContent);
      console.log(`✅ Created transcript: ${transcriptFilename}`);
      successful++;
    } catch (error) {
      console.error(`❌ Failed to create transcript for ${file.filename}: ${error.message}`);
    }
  });
  
  console.log(`\n✅ Mock transcription completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Successful: ${successful}`);
  console.log(`   - Failed: ${audioFiles.length - successful}`);
  console.log(`   - Total: ${audioFiles.length}`);
  
  return successful > 0;
}

// Run if called directly
if (require.main === module) {
  main().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { main };