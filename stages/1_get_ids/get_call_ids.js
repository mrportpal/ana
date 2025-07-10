const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xlsx = require('xlsx');
require('dotenv').config({ path: process.env.CONFIG_PATH ? path.dirname(process.env.CONFIG_PATH) + '/.env' : '../../.env' });

// Load configuration
const configPath = process.env.CONFIG_PATH || path.join(__dirname, '../../config/pipeline_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Output directory
const outputDir = path.join(__dirname, '../../output/call_ids');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Utility functions
function getDateRange(startDate, endDate) {
  const dates = [];
  let current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current < end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Net2Phone API functions
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

async function getCallLogs(token, date) {
  try {
    const endDate = new Date(date);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    
    const params = {
      start_date: date.toISOString(),
      end_date: endDate.toISOString(),
      page_size: config.api_config.net2phone.page_size,
      min_duration: config.api_config.net2phone.min_duration,
    };

    console.log('🔍 API Request Details:');
    console.log('  URL:', config.api_config.net2phone.base_url + config.api_config.net2phone.calls_endpoint);
    console.log('  Params:', JSON.stringify(params, null, 2));

    const response = await axios.get(
      config.api_config.net2phone.base_url + config.api_config.net2phone.calls_endpoint,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.integrate.v1.10.0+json',
          'Content-Type': 'application/json; charset=utf-8',
        },
        params,
      }
    );

    console.log('📊 API Response:');
    console.log('  Status:', response.status);
    console.log('  Results count:', response.data.result?.length || 0);
    console.log('  Total count:', response.data.count || 0);
    if (response.data.result?.length > 0) {
      console.log('  First call sample:', JSON.stringify(response.data.result[0], null, 2));
    }

    return response.data;
  } catch (error) {
    console.log('❌ API Error Details:', error.response?.data || error.message);
    throw new Error(`Failed to fetch call logs: ${error.response?.data?.error || error.message}`);
  }
}

function extractRelevantData(calls) {
  return calls.map(entry => {
    const from = entry.from || {};
    const to = entry.to || {};
    const recording = from.recordings?.[0]?.url || '';

    return {
      call_id: from.call_id || '',
      from_number: from.value || '',
      to_number: to.value || '',
      from_username: from.username || '',
      from_name: from.name || '',
      start_time: entry.start_time || '',
      duration: entry.duration || 0,
      recording_url: recording,
      broker_id: from.username || '',
      date: entry.start_time ? entry.start_time.split('T')[0] : ''
    };
  });
}

function saveToExcel(data, filename) {
  const ws = xlsx.utils.json_to_sheet(data);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Call Logs');
  xlsx.writeFile(wb, filename);
}

// Main execution
async function main() {
  console.log('🔍 Starting call ID extraction...');
  
  try {
    // Get access token
    console.log('📡 Getting access token...');
    const token = await getAccessToken();
    console.log('✅ Access token obtained');

    // Get date range
    const dates = getDateRange(config.execution.start_date, config.execution.end_date);
    console.log(`📅 Processing ${dates.length} date(s) from ${config.execution.start_date} to ${config.execution.end_date}`);

    let totalCalls = 0;
    const allCalls = [];

    // Process each date
    for (const date of dates) {
      const dateStr = date.toISOString().split('T')[0];
      console.log(`🔄 Processing date: ${dateStr}`);

      try {
        const callData = await getCallLogs(token, date);
        const calls = extractRelevantData(callData.result || []);
        
        if (calls.length > 0) {
          // Save individual date file
          const filename = path.join(outputDir, `${dateStr}.xlsx`);
          saveToExcel(calls, filename);
          console.log(`💾 Saved ${calls.length} calls to ${filename}`);
          
          totalCalls += calls.length;
          allCalls.push(...calls);
        } else {
          console.log(`⚠️ No calls found for ${dateStr}`);
        }

        // Rate limiting
        await delay(1000);
      } catch (error) {
        console.error(`❌ Error processing date ${dateStr}:`, error.message);
      }
    }

    // Save combined file
    if (allCalls.length > 0) {
      const combinedFilename = path.join(outputDir, 'all_calls.xlsx');
      saveToExcel(allCalls, combinedFilename);
      console.log(`📊 Saved combined file with ${totalCalls} total calls: ${combinedFilename}`);
    }

    console.log(`✅ Call ID extraction completed. Total calls: ${totalCalls}`);
    return totalCalls > 0;

  } catch (error) {
    console.error('❌ Fatal error in call ID extraction:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}