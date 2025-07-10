#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk');
const PipelineState = require('./lib/pipeline-state');

// Load configuration
const CONFIG_PATH = path.join(__dirname, 'config', 'pipeline_config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Pipeline stages - complete pipeline for real calls
const STAGES = [
  {
    name: '1_get_ids',
    script: 'get_call_ids.js',
    description: 'Fetching call IDs from Net2Phone',
    language: 'node'
  },
  {
    name: '2_download_recordings',
    script: 'download_recordings.js',
    description: 'Downloading audio recordings (limited to 5)',
    language: 'node'
  },
  {
    name: '3_transcribe',
    script: 'transcribe_recordings_sdk.js',
    description: 'Transcribing recordings with AssemblyAI',
    language: 'node'
  },
  {
    name: '4_upload_audio',
    script: 'upload_audio_files.js',
    description: 'Uploading audio files to Bubble',
    language: 'node'
  },
  {
    name: '5_analyze',
    script: 'analyze_and_upload.js',
    description: 'Analyzing calls and uploading to Bubble',
    language: 'node'
  }
];

// Logging utilities
class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    this.mainLog = path.join(logDir, `pipeline_${new Date().toISOString().split('T')[0]}.log`);
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data
    };
    
    // Console output with color
    const colorMap = {
      'INFO': chalk.blue,
      'SUCCESS': chalk.green,
      'WARNING': chalk.yellow,
      'ERROR': chalk.red
    };
    
    const color = colorMap[level] || chalk.white;
    console.log(color(`[${timestamp}] ${level}: ${message}`));
    
    // File output
    fs.appendFileSync(this.mainLog, JSON.stringify(logEntry) + '\n');
  }

  info(message, data) { this.log('INFO', message, data); }
  success(message, data) { this.log('SUCCESS', message, data); }
  warning(message, data) { this.log('WARNING', message, data); }
  error(message, data) { this.log('ERROR', message, data); }
}

// Pipeline execution
class Pipeline {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.startTime = null;
    this.stageResults = [];
    this.pipelineState = new PipelineState(config.directories.base_dir);
  }

  async run() {
    this.startTime = Date.now();
    this.logger.info('Starting Call Center Analytics Pipeline', {
      startDate: this.config.execution.start_date,
      endDate: this.config.execution.end_date
    });

    // Show current pipeline state
    const stats = this.pipelineState.getProcessingStats();
    this.logger.info('Current Pipeline State', stats);

    // Validate environment
    if (!await this.validateEnvironment()) {
      this.logger.error('Environment validation failed');
      return false;
    }

    // Execute stages sequentially
    for (const stage of STAGES) {
      const stageStart = Date.now();
      this.logger.info(`Starting stage: ${stage.description}`, { stage: stage.name });

      try {
        const success = await this.executeStage(stage);
        const duration = Date.now() - stageStart;

        if (success) {
          this.logger.success(`Stage completed: ${stage.name}`, { duration });
          this.stageResults.push({ stage: stage.name, status: 'success', duration });
        } else {
          this.logger.error(`Stage failed: ${stage.name}`, { duration });
          this.stageResults.push({ stage: stage.name, status: 'failed', duration });
          
          // Ask user if they want to continue
          if (!await this.promptContinue(stage.name)) {
            break;
          }
        }
      } catch (error) {
        this.logger.error(`Stage error: ${stage.name}`, { error: error.message });
        this.stageResults.push({ stage: stage.name, status: 'error', error: error.message });
        
        if (!await this.promptContinue(stage.name)) {
          break;
        }
      }
    }

    // Final summary
    this.printSummary();
    return true;
  }

  async validateEnvironment() {
    this.logger.info('Validating environment');

    // Check .env file
    const envPath = this.config.directories.env_file;
    if (!fs.existsSync(envPath)) {
      this.logger.error('.env file not found', { path: envPath });
      this.logger.info('Creating .env template');
      this.createEnvTemplate(envPath);
      return false;
    }

    // Check required environment variables
    require('dotenv').config({ path: envPath });
    const requiredVars = [
      'NET2PHONE_CLIENT_ID',
      'NET2PHONE_CLIENT_SECRET',
      'ASSEMBLYAI_API_KEY',
      'OPENAI_API_KEY',
      'BUBBLE_API_TOKEN',
      'BUBBLE_AUDIO_URL',
      'BUBBLE_SUMMARY_URL'
    ];

    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      this.logger.error('Missing environment variables', { missing });
      return false;
    }

    // Check Node.js and Python
    try {
      await this.executeCommand('node', ['--version']);
      // Try python3 first, fallback to python
      try {
        await this.executeCommand('python3', ['--version']);
      } catch {
        await this.executeCommand('python', ['--version']);
      }
    } catch (error) {
      this.logger.error('Required runtime not found', { error: error.message });
      return false;
    }

    return true;
  }

  createEnvTemplate(envPath) {
    const template = `# Net2Phone API Credentials
NET2PHONE_CLIENT_ID=your_client_id_here
NET2PHONE_CLIENT_SECRET=your_client_secret_here

# AssemblyAI API Key
ASSEMBLYAI_API_KEY=your_assemblyai_key_here

# OpenAI API Key
OPENAI_API_KEY=your_openai_key_here

# Bubble API Configuration
BUBBLE_API_TOKEN=your_bubble_token_here
BUBBLE_TRANSCRIPTS_URL=https://your-app.bubbleapps.io/api/1.1/obj/transcripts
BUBBLE_AUDIO_URL=https://your-app.bubbleapps.io/api/1.1/obj/audio
BUBBLE_SUMMARY_URL=https://your-app.bubbleapps.io/api/1.1/obj/summaries
`;
    fs.writeFileSync(envPath, template);
    this.logger.info('.env template created. Please fill in your API credentials.');
  }

  executeStage(stage) {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, 'stages', stage.name, stage.script);
      const command = stage.language === 'python' ? 'python3' : 'node';
      
      const child = spawn(command, [scriptPath], {
        cwd: path.join(__dirname, 'stages', stage.name),
        env: { 
          ...process.env, 
          CONFIG_PATH: CONFIG_PATH,
          PIPELINE_STATE_PATH: this.pipelineState.stateFile
        }
      });

      let output = '';
      
      child.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(chalk.gray(`  [${stage.name}] `) + text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stderr.write(chalk.red(`  [${stage.name}] `) + text);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          this.logger.error(`Stage exited with code ${code}`, { stage: stage.name, output });
          resolve(false);
        }
      });

      child.on('error', (error) => {
        this.logger.error('Failed to start stage', { stage: stage.name, error: error.message });
        resolve(false);
      });
    });
  }

  executeCommand(command, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed: ${command}`));
      });
      child.on('error', reject);
    });
  }

  promptContinue(failedStage) {
    return new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.question(chalk.yellow(`\nStage '${failedStage}' failed. Continue with next stage? (y/n): `), (answer) => {
        readline.close();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  }

  printSummary() {
    const totalDuration = Date.now() - this.startTime;
    const successCount = this.stageResults.filter(r => r.status === 'success').length;
    
    console.log('\n' + chalk.bold('Pipeline Execution Summary'));
    console.log('='.repeat(50));
    
    this.stageResults.forEach(result => {
      const statusColor = result.status === 'success' ? chalk.green : chalk.red;
      const duration = result.duration ? `(${(result.duration / 1000).toFixed(2)}s)` : '';
      console.log(`  ${result.stage}: ${statusColor(result.status)} ${duration}`);
    });
    
    console.log('='.repeat(50));
    console.log(`Total stages: ${STAGES.length}`);
    console.log(`Successful: ${chalk.green(successCount)}`);
    console.log(`Failed: ${chalk.red(STAGES.length - successCount)}`);
    console.log(`Total duration: ${(totalDuration / 1000).toFixed(2)} seconds`);
    
    this.logger.info('Pipeline completed', {
      totalStages: STAGES.length,
      successful: successCount,
      failed: STAGES.length - successCount,
      duration: totalDuration
    });
  }
}

// Main execution
async function main() {
  console.log(chalk.bold.blue('\n🚀 Call Center Analytics Pipeline\n'));
  
  const logger = new Logger(config.directories.logs_dir);
  const pipeline = new Pipeline(config, logger);
  
  try {
    await pipeline.run();
  } catch (error) {
    logger.error('Pipeline fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { Pipeline, Logger };