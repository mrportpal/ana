const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx');
const { OpenAI } = require('openai');
const PipelineState = require('../../lib/pipeline-state');
require('dotenv').config({ path: process.env.CONFIG_PATH ? path.dirname(process.env.CONFIG_PATH) + '/.env' : '../../.env' });

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/pipeline_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Setup directories and state
const baseDir = path.join(__dirname, '../..');
const transcriptsDir = path.join(baseDir, 'output/transcripts');
const callIdsDir = path.join(baseDir, 'output/call_ids');
const logsDir = path.join(baseDir, 'logs');
const pipelineState = new PipelineState(baseDir);

// Create directories
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Setup APIs
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bubbleUrl = process.env.BUBBLE_SUMMARY_URL;
const bubbleToken = process.env.BUBBLE_API_TOKEN;

// Log files
const processedLog = path.join(logsDir, 'processed_analyses.csv');
const errorLog = path.join(logsDir, 'analysis_errors.json');

// Initialize log files
if (!fs.existsSync(processedLog)) {
  fs.writeFileSync(processedLog, 'call_id,timestamp,status\n');
}

function loadProcessedCallIds() {
  if (!fs.existsSync(processedLog)) {
    return new Set();
  }
  
  const content = fs.readFileSync(processedLog, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return new Set(lines.slice(1).map(line => line.split(',')[0]));
}

function loadCallMetadata() {
  const callData = {};
  
  // Load from call ID Excel files
  if (fs.existsSync(callIdsDir)) {
    const files = fs.readdirSync(callIdsDir).filter(f => f.endsWith('.xlsx'));
    
    for (const file of files) {
      try {
        const filePath = path.join(callIdsDir, file);
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        
        data.forEach(call => {
          if (call.call_id) {
            callData[call.call_id] = {
              broker_id: call.from_username || call.broker_id || '',
              from_name: call.from_name || '',
              from_number: call.from_number || '',
              to_number: call.to_number || '',
              start_time: call.start_time || '',
              duration: call.duration || 0,
              date: call.date || (call.start_time ? call.start_time.split('T')[0] : '')
            };
          }
        });
      } catch (error) {
        console.error(`❌ Error loading call metadata from ${file}:`, error.message);
      }
    }
  }
  
  console.log(`📊 Loaded metadata for ${Object.keys(callData).length} calls`);
  return callData;
}

function loadAudioUrlMapping() {
  // Load from latest audio upload results
  const audioLogPattern = path.join(logsDir, 'audio_upload_mapping_*.csv');
  const audioLogFiles = require('glob').sync(audioLogPattern).sort().reverse();
  
  const audioMap = {};
  
  if (audioLogFiles.length > 0) {
    const latestLog = audioLogFiles[0];
    console.log(`📂 Loading audio URLs from: ${path.basename(latestLog)}`);
    
    const content = fs.readFileSync(latestLog, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    lines.slice(1).forEach(line => {
      const [brokerId, callId, fileUrl] = line.split(',');
      if (callId && fileUrl) {
        audioMap[callId] = fileUrl.replace(/^"|"$/g, ''); // Remove quotes
      }
    });
  }
  
  console.log(`🔊 Loaded ${Object.keys(audioMap).length} audio URL mappings`);
  return audioMap;
}

function getTranscriptFiles() {
  if (!fs.existsSync(transcriptsDir)) {
    console.log(`⚠️ Transcripts directory not found: ${transcriptsDir}`);
    return [];
  }
  
  const files = fs.readdirSync(transcriptsDir)
    .filter(file => file.endsWith('.txt'))
    .map(file => {
      const parts = file.replace('.txt', '').split('_');
      if (parts.length >= 2) {
        return {
          filepath: path.join(transcriptsDir, file),
          filename: file,
          brokerId: parts[0],
          callId: parts.slice(1).join('_') // Join all parts after broker_id
        };
      }
      return null;
    })
    .filter(file => file !== null);
  
  return files;
}

async function analyzeTranscript(transcriptText) {
  const prompt = `You are an AI assistant helping analyze mortgage/loan broker calls with potential clients. Based on the full diarized transcript of a recorded call, return a JSON object structured according to the following schema.

Extract the data as precisely as possible based on what was actually said. If something is not mentioned, leave the field blank or null. Avoid guessing.

Return the following fields:

{
  "broker_id": number,
  "call_id": string,
  "call_date": ISO 8601 datetime,
  "audio_url": string,
  "transcript_excerpt": string, // first 1-2 lines of actual transcript
  "start_time": ISO 8601 datetime,
  "to_number": string,
  "from_number": string,
  "from_name": string,
  "duration": number, // in seconds
  "summary": string,
  "sentiment": "positive" | "neutral" | "negative",
  "success_rating": number (1–5),
  "call_disposition": string,
  "call_type": string, // e.g., "cold_call", "inbound", etc.
  "talk_listen_ratio": float, // broker words divided by client words
  "call_datetime": ISO 8601 datetime,
  "call_duration": number (duplicate of duration),
  "product_type": string, // e.g., "mortgage_refinance", "purchase", etc.
  "client_segment": string, // e.g., "refinancer", "first_time_buyer"
  "region": string,
  "topic_tags": [string],
  "mortgage_started": boolean,
  "mortgage_completed": boolean,
  "follow_up": boolean,
  "coaching_flag": boolean,
  "coaching_summary": string,
  "objection_summary": string,
  "improvement_summary": string,
  "highlight": string,
  "deal_value": string, // e.g., "$350,000"
  "deal_probability": string, // e.g., "Likely", "Unlikely", "50/50"
  "sentiment_start": "positive" | "neutral" | "negative",
  "sentiment_end": "positive" | "neutral" | "negative",
  "coaching_reason": string,
  "objections": [
    {
      "objection": "I'm not sure if this is the right time",
      "broker_response": "I understand your concern, let me explain why acting now could benefit you",
      "objection_timestamp": "[03:45]",
      "response_timestamp": "[03:55]"
    }
  ],
  "improvement_tags": [string],
  "diarized_transcript": string,
  "next_steps": string,
  "mortgage_fields": {
    "PersonalInfo": {
      "ClientName": string,
      "DOB": string
    },
    "Employment": {
      "EmployerName": string
    }
  },
  "strengths": [
    {
      "strength": "Built good rapport with the client",
      "timestamp": "[02:15]"
    },
    {
      "strength": "Clearly explained the benefits",
      "timestamp": "[05:30]"
    }
  ]
}

IMPORTANT: 
- Always include the "strengths" array with at least 1-3 strength objects, each with "strength" and "timestamp" fields
- Always include the "objections" array with objection objects (if any occurred), each with "objection", "broker_response", "objection_timestamp", and "response_timestamp" fields
- If no objections occurred, use an empty array: []
- Always populate "improvement_tags" array with 1-3 specific improvement areas (e.g., ["rapport_building", "closing_technique", "objection_handling"])
- Always populate "call_type" field (e.g., "inbound", "outbound", "follow_up", "cold_call")
- Always calculate "talk_listen_ratio" as a float (broker speaking time / client speaking time, e.g., 1.5 means broker spoke 50% more)
- Always populate "success_rating" as a number 1-5 based on call outcome
- Return only the JSON object with no markdown formatting or commentary

TRANSCRIPT:
${transcriptText}`;

  try {
    const response = await openai.chat.completions.create({
      model: config.api_config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000, // Increased for complex schema with arrays
      temperature: config.api_config.openai.temperature,
    });

    let analysisText = response.choices[0].message.content;
    console.log('🤖 OpenAI Raw Response:', analysisText.substring(0, 500) + '...');
    
    // Clean up markdown code blocks if present
    if (analysisText.includes('```json')) {
      analysisText = analysisText.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    }
    if (analysisText.includes('```')) {
      analysisText = analysisText.replace(/```\s*/g, '');
    }
    
    // Try to parse JSON response
    try {
      const parsedAnalysis = JSON.parse(analysisText);
      console.log('✅ Parsed analysis - strengths:', JSON.stringify(parsedAnalysis.strengths, null, 2));
      console.log('✅ Parsed analysis - objections:', JSON.stringify(parsedAnalysis.objections, null, 2));
      
      // Ensure diarized_transcript is included
      if (!parsedAnalysis.diarized_transcript) {
        parsedAnalysis.diarized_transcript = transcriptText;
      }
      
      return parsedAnalysis;
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      
      // Return minimal structure if JSON parsing fails
      return {
        broker_id: null,
        call_id: null,
        call_date: null,
        audio_url: "",
        transcript_excerpt: transcriptText.substring(0, 200) + "...",
        start_time: null,
        to_number: "",
        from_number: "",
        from_name: "",
        duration: 0,
        summary: "Analysis parsing failed - raw response: " + analysisText.substring(0, 500),
        sentiment: "neutral",
        success_rating: 0,
        call_disposition: "analysis_failed",
        call_type: "unknown",
        talk_listen_ratio: 0,
        call_datetime: null,
        call_duration: 0,
        product_type: "",
        client_segment: "",
        region: "",
        topic_tags: [],
        mortgage_started: false,
        mortgage_completed: false,
        follow_up: false,
        coaching_flag: true,
        coaching_summary: "Analysis parsing failed",
        objection_summary: "",
        improvement_summary: "Review analysis parsing",
        highlight: "",
        deal_value: "",
        deal_probability: "Unknown",
        sentiment_start: "neutral",
        sentiment_end: "neutral",
        coaching_reason: "Analysis parsing failed",
        objections: [],
        improvement_tags: ["analysis_failed"],
        diarized_transcript: transcriptText,
        next_steps: "",
        mortgage_fields: {
          PersonalInfo: {
            ClientName: "",
            DOB: ""
          },
          Employment: {
            EmployerName: ""
          }
        },
        strengths: []
      };
    }
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

async function uploadAnalysis(analysisData, callId, brokerId, audioUrl, callMetadata) {
  try {
    // Convert broker_id to number if it's a string
    const numericBrokerId = (() => {
      const id = brokerId || callMetadata.broker_id || analysisData.broker_id;
      if (typeof id === 'string' && !isNaN(id)) {
        return parseInt(id, 10);
      }
      if (typeof id === 'number') {
        return id;
      }
      // If it's a non-numeric string, try to extract numbers
      const match = String(id).match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    })();

    // Debug log broker_id conversion
    if (numericBrokerId === null) {
      console.warn(`⚠️ Could not convert broker_id to number: ${brokerId || callMetadata.broker_id || analysisData.broker_id}`);
    }

    // Merge with call metadata
    const enrichedData = {
      ...analysisData,
      call_id: callId,
      broker_id: numericBrokerId,
      audio_url: audioUrl || '',
      call_date: callMetadata.start_time || analysisData.call_date,
      start_time: callMetadata.start_time || analysisData.start_time,
      call_datetime: callMetadata.start_time || analysisData.call_datetime,
      to_number: callMetadata.to_number || analysisData.to_number,
      from_number: callMetadata.from_number || analysisData.from_number,
      from_name: callMetadata.from_name || analysisData.from_name,
      duration: callMetadata.duration || analysisData.duration,
      call_duration: callMetadata.duration || analysisData.call_duration,
      analysis_timestamp: Math.floor(Date.now() / 1000),
      source: 'pipeline_automated'
    };

    console.log('📤 Bubble Upload Payload Debug:');
    console.log('  - call_id:', enrichedData.call_id);
    console.log('  - broker_id:', enrichedData.broker_id);
    console.log('  - audio_url:', enrichedData.audio_url);
    console.log('  - call_datetime:', enrichedData.call_datetime);
    console.log('  - to_number:', enrichedData.to_number);
    console.log('  - from_number:', enrichedData.from_number);
    console.log('  - call_type:', enrichedData.call_type);
    console.log('  - talk_listen_ratio:', enrichedData.talk_listen_ratio);
    console.log('  - improvement_tags:', JSON.stringify(enrichedData.improvement_tags, null, 2));
    console.log('  - strengths:', JSON.stringify(enrichedData.strengths, null, 2));
    console.log('  - objections:', JSON.stringify(enrichedData.objections, null, 2));

    const response = await axios.post(bubbleUrl, enrichedData, {
      headers: {
        'Authorization': `Bearer ${bubbleToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // Increased timeout for large payloads
    });

    if (response.status >= 200 && response.status < 300) {
      return { success: true, data: response.data };
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(`Upload error: ${error.message}`);
  }
}

async function processTranscriptFile(fileInfo, audioMap, callMetadata, processedIds) {
  const { filepath, filename, callId, brokerId } = fileInfo;
  
  // Skip if already processed
  if (processedIds.has(callId)) {
    console.log(`⏭️ Skipping already processed: ${filename}`);
    return { success: true, skipped: true };
  }
  
  try {
    console.log(`🔍 Processing file: ${filename}`);
    console.log(`  - Extracted broker_id: ${brokerId}`);
    console.log(`  - Extracted call_id: ${callId}`);
    console.log(`  - Call metadata found:`, !!callMetadata[callId]);
    console.log(`  - Audio URL found:`, !!audioMap[callId]);
    console.log(`🔍 Analyzing: ${filename}`);
    
    // Read transcript
    const transcriptText = fs.readFileSync(filepath, 'utf-8');
    if (!transcriptText.trim()) {
      throw new Error('Empty transcript file');
    }
    
    // Analyze transcript
    const analysis = await analyzeTranscript(transcriptText);
    
    // Get audio URL
    const audioUrl = audioMap[callId] || '';
    
    // Get call metadata
    const metadata = callMetadata[callId] || {};
    
    // Upload analysis
    const uploadResult = await uploadAnalysis(analysis, callId, brokerId, audioUrl, metadata);
    
    // Update state management
    pipelineState.markAnalyzed(callId, analysis);
    
    // Archive transcript file after successful analysis
    const transcriptArchivePath = pipelineState.archiveFile(filepath, 'transcripts', callId);
    
    // Also archive JSON file if it exists
    const jsonFilePath = filepath.replace('.txt', '.json');
    if (fs.existsSync(jsonFilePath)) {
      pipelineState.archiveFile(jsonFilePath, 'transcripts', callId);
    }
    
    console.log(`✅ Analyzed and uploaded: ${filename}`);
    
    return {
      success: true,
      callId,
      filename,
      analysis,
      uploadResult: uploadResult.data
    };
    
  } catch (error) {
    console.error(`❌ Error processing ${filename}: ${error.message}`);
    
    // Update state management with failure
    pipelineState.markAnalysisFailed(callId, error.message);
    
    return {
      success: false,
      callId,
      filename,
      error: error.message
    };
  }
}

async function main() {
  console.log('🔍 Starting mortgage broker call analysis and upload...');
  
  // Load processed call IDs
  const processedIds = loadProcessedCallIds();
  console.log(`📋 Previously processed: ${processedIds.size} calls`);
  
  // Load call metadata
  const callMetadata = loadCallMetadata();
  
  // Load audio URL mapping
  const audioMap = loadAudioUrlMapping();
  
  // Get transcript files
  const transcriptFiles = getTranscriptFiles();
  console.log(`📊 Found ${transcriptFiles.length} transcript files`);
  
  // Filter unprocessed files using state management
  const unprocessedFiles = transcriptFiles.filter(file => !pipelineState.isAnalyzed(file.callId));
  console.log(`🔄 Files to process: ${unprocessedFiles.length}`);
  
  if (unprocessedFiles.length === 0) {
    console.log('✅ All transcripts already processed');
    return true;
  }
  
  const results = [];
  
  // Process files sequentially to respect API rate limits
  for (let i = 0; i < unprocessedFiles.length; i++) {
    const file = unprocessedFiles[i];
    console.log(`📊 Progress: ${i + 1}/${unprocessedFiles.length}`);
    
    const result = await processTranscriptFile(file, audioMap, callMetadata, processedIds);
    results.push(result);
    
    // Add to processed set if successful
    if (result.success && !result.skipped) {
      processedIds.add(result.callId);
    }
    
    // Rate limiting delay
    if (i < unprocessedFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay for complex analysis
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success && !r.skipped).length;
  const failed = results.filter(r => !r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  
  console.log(`\n✅ Mortgage broker call analysis completed!`);
  console.log(`📊 Summary:`);
  console.log(`   - Processed: ${successful}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`   - Skipped: ${skipped}`);
  console.log(`   - Total: ${results.length}`);
  
  // Save results
  const resultsFile = path.join(logsDir, `mortgage_analysis_results_${Math.floor(Date.now() / 1000)}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: Math.floor(Date.now() / 1000),
    summary: { successful, failed, skipped, total: results.length },
    results
  }, null, 2));
  
  console.log(`📝 Results saved to: ${path.basename(resultsFile)}`);
  
  return successful > 0;
}

// Run if called directly
if (require.main === module) {
  main()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error.message);
      process.exit(1);
    });
}