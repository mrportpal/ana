# Call Center Analytics Pipeline

An automated pipeline for processing call center data from Net2Phone to Bubble, including audio transcription and AI-powered analysis.

## Overview

This pipeline automates the complete workflow of:
1. **Extracting** call records from Net2Phone API
2. **Downloading** call recordings
3. **Transcribing** audio using AssemblyAI
4. **Uploading** audio files to Bubble storage
5. **Analyzing** calls with AI and uploading comprehensive mortgage broker analysis

## Features

- ✅ **Fully Automated**: Run the entire pipeline with a single command
- 🔄 **Resumable**: Can restart from any stage if interrupted
- 📊 **Progress Tracking**: Real-time progress updates and logging
- 🛡️ **Error Handling**: Comprehensive error handling with retry logic
- ⚡ **Concurrent Processing**: Optimized for performance with controlled concurrency
- 📈 **Monitoring**: Detailed logs and results tracking

## Prerequisites

- **Node.js** 16+ 
- **Python** 3.8+
- **pip** (Python package manager)
- API accounts for:
  - Net2Phone (for call data)
  - AssemblyAI (for transcription)
  - OpenAI (for analysis)
  - Bubble (for data storage)

## Quick Start

### 1. Setup

```bash
# Run the setup script
./setup.sh

# Or manually:
npm install
pip install -r requirements.txt
```

### 2. Configuration

Edit the `.env` file with your API credentials:

```bash
cp .env.template .env
nano .env  # Add your API keys
```

### 3. Configure Date Range

Edit `config/pipeline_config.json` to set your desired date range:

```json
{
  "execution": {
    "start_date": "2025-01-01",
    "end_date": "2025-01-07"
  }
}
```

### 4. Run Pipeline

```bash
# Start the complete pipeline
npm start

# Or directly:
node run_pipeline.js
```

## Configuration

### Pipeline Configuration (`config/pipeline_config.json`)

```json
{
  "execution": {
    "start_date": "2025-01-01",        // Start date for call extraction
    "end_date": "2025-01-07",          // End date for call extraction
    "batch_size": 10,                  // Batch size for processing
    "retry_attempts": 3,               // Number of retry attempts
    "concurrent_workers": 5            // Concurrent workers for processing
  },
  "api_config": {
    "net2phone": {
      "page_size": 1000,               // API page size
      "min_duration": 15               // Minimum call duration in seconds
    },
    "openai": {
      "model": "gpt-4-turbo-preview",  // AI model for analysis
      "max_tokens": 500,               // Max tokens per analysis
      "temperature": 0.3               // AI creativity level
    }
  }
}
```

### Environment Variables (`.env`)

Required environment variables:

```bash
# Net2Phone API
NET2PHONE_CLIENT_ID=your_client_id
NET2PHONE_CLIENT_SECRET=your_client_secret

# AssemblyAI API
ASSEMBLYAI_API_KEY=your_assemblyai_key

# OpenAI API
OPENAI_API_KEY=your_openai_key

# Bubble API
BUBBLE_API_TOKEN=your_bubble_token
BUBBLE_AUDIO_URL=https://your-app.bubbleapps.io/fileupload
BUBBLE_SUMMARY_URL=https://your-app.bubbleapps.io/api/1.1/wf/callsy
```

## Pipeline Stages

### Stage 1: Get Call IDs
- Fetches call logs from Net2Phone API
- Filters by date range and duration
- Saves call metadata to Excel files

### Stage 2: Download Audio
- Downloads call recordings in WAV format
- Implements retry logic for failed downloads
- Organizes files by date and broker

### Stage 3: Transcribe Audio
- Uses AssemblyAI for speech-to-text conversion
- Generates speaker-labeled transcripts
- Saves both JSON and formatted text outputs

### Stage 4: Upload Audio
- Uploads audio files to Bubble storage
- Creates URL mappings for next stage
- Maintains upload logs for tracking

### Stage 5: Analyze & Upload
- Uses OpenAI to analyze call transcripts with comprehensive mortgage broker schema
- Generates structured analysis including:
  - Call summary and sentiment analysis
  - Mortgage-specific data extraction
  - Client information and deal probability
  - Coaching insights and improvement suggestions
  - Objection handling analysis
  - Complete diarized transcript
- Uploads full analysis including transcripts to Bubble

## Directory Structure

```
ana/
├── config/
│   └── pipeline_config.json     # Main configuration
├── stages/                      # Pipeline stage scripts
│   ├── 1_get_ids/
│   ├── 2_download_audio/
│   ├── 3_transcribe/
│   ├── 4_upload_audio/
│   └── 5_analyze/              # Mortgage broker analysis
├── output/                      # Processed data
│   ├── call_ids/               # Call metadata
│   ├── audio/                  # Audio recordings
│   └── transcripts/            # Transcribed text
├── logs/                       # Processing logs
├── run_pipeline.js             # Main pipeline orchestrator
├── package.json               # Node.js dependencies
├── requirements.txt           # Python dependencies
└── .env                      # Environment variables
```

## Monitoring & Logs

### Real-time Monitoring
- Progress updates for each stage
- Color-coded console output
- Stage timing and success rates

### Log Files
- `logs/pipeline_YYYY-MM-DD.log` - Main pipeline log
- `logs/transcription_results_*.json` - Transcription results
- `logs/audio_upload_results_*.json` - Audio upload results
- `logs/analysis_results_*.json` - AI analysis results

### Error Handling
- Automatic retry with exponential backoff
- Detailed error logging
- Option to continue pipeline after stage failures

## Troubleshooting

### Common Issues

1. **Missing API Keys**
   ```
   Error: Missing NET2PHONE_CLIENT_ID
   Solution: Check your .env file has all required credentials
   ```

2. **Audio Download Failures**
   ```
   Error: Failed to download recording
   Solution: Check network connection and API rate limits
   ```

3. **Transcription Errors**
   ```
   Error: AssemblyAI transcription failed
   Solution: Verify API key and check audio file format
   ```

4. **Upload Failures**
   ```
   Error: Bubble API upload failed
   Solution: Check Bubble API endpoints and authentication
   ```

### Debug Mode

Run with verbose logging:
```bash
DEBUG=true node run_pipeline.js
```

### Manual Stage Execution

Run individual stages:
```bash
# Stage 1: Get call IDs
node stages/1_get_ids/get_call_ids.js

# Stage 2: Download audio
node stages/2_download_audio/download_recordings.js

# etc...
```

## Performance Optimization

### Concurrent Processing
- Adjust `concurrent_workers` in config
- Default: 5 workers for most stages
- Audio uploads limited to 2 concurrent

### Batch Processing
- Configure `batch_size` for optimal throughput
- Default: 10 items per batch
- Larger batches = faster processing, more memory usage

### Rate Limiting
- Built-in delays between API calls
- Respects API rate limits automatically
- Configurable retry attempts

## API Integration

### Net2Phone
- OAuth2 authentication
- CDR (Call Detail Records) API
- Recording download endpoints

### AssemblyAI
- Speech-to-text transcription
- Speaker identification
- Multiple audio format support

### OpenAI
- GPT-4 for call analysis
- Structured JSON responses
- Configurable creativity levels

### Bubble
- REST API for data storage
- File upload endpoints
- Real-time data access

## Development

### Adding New Stages
1. Create new directory in `stages/`
2. Add script with standardized error handling
3. Update `run_pipeline.js` with new stage
4. Test individually before integration

### Custom Analysis
Modify `stages/6_analyze/analyze_and_upload.js` to customize:
- AI prompts for analysis
- Output data structure
- Additional analysis features

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review log files for error details
3. Verify API credentials and endpoints
4. Test individual stages in isolation

## License

ISC License - See LICENSE file for details.