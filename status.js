#!/usr/bin/env node

const path = require('path');
const chalk = require('chalk');
const PipelineState = require('./lib/pipeline-state');

// Load configuration
const CONFIG_PATH = path.join(__dirname, 'config', 'pipeline_config.json');
const config = JSON.parse(require('fs').readFileSync(CONFIG_PATH, 'utf8'));

function formatNumber(num) {
  return num.toLocaleString();
}

function printSection(title, data) {
  console.log(chalk.bold.blue(`\n${title}`));
  console.log('='.repeat(title.length));
  
  if (Array.isArray(data)) {
    data.forEach(item => console.log(`  ${item}`));
  } else {
    Object.entries(data).forEach(([key, value]) => {
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      console.log(`  ${formattedKey}: ${chalk.green(value)}`);
    });
  }
}

function main() {
  console.log(chalk.bold.cyan('\n🔍 Pipeline Status Report\n'));
  
  const pipelineState = new PipelineState(config.directories.base_dir);
  const stats = pipelineState.getProcessingStats();
  const failed = pipelineState.getFailedItems();
  
  // Overall Statistics
  printSection('📊 Overall Statistics', {
    'Total Calls Extracted': formatNumber(stats.total_calls_extracted),
    'Audio Downloaded': formatNumber(stats.audio_downloaded),
    'Transcribed': formatNumber(stats.transcribed),
    'Uploaded to Bubble': formatNumber(stats.uploaded_to_bubble),
    'Analyzed': formatNumber(stats.analyzed),
    'Archived Files': formatNumber(stats.archived_files),
    'Completion Rate': stats.completion_rate
  });
  
  // Stage Progress
  const progress = {
    'Call ID Extraction': stats.total_calls_extracted > 0 ? '✅ Complete' : '⚠️ Pending',
    'Audio Download': `${stats.audio_downloaded}/${stats.total_calls_extracted} (${((stats.audio_downloaded/stats.total_calls_extracted)*100).toFixed(1)}%)`,
    'Transcription': `${stats.transcribed}/${stats.audio_downloaded} (${stats.audio_downloaded > 0 ? ((stats.transcribed/stats.audio_downloaded)*100).toFixed(1) : 0}%)`,
    'Audio Upload': `${stats.uploaded_to_bubble}/${stats.audio_downloaded} (${stats.audio_downloaded > 0 ? ((stats.uploaded_to_bubble/stats.audio_downloaded)*100).toFixed(1) : 0}%)`,
    'Analysis': `${stats.analyzed}/${Math.min(stats.transcribed, stats.uploaded_to_bubble)} (${Math.min(stats.transcribed, stats.uploaded_to_bubble) > 0 ? ((stats.analyzed/Math.min(stats.transcribed, stats.uploaded_to_bubble))*100).toFixed(1) : 0}%)`
  };
  
  printSection('🔄 Stage Progress', progress);
  
  // Failed Items Summary
  const totalFailed = Object.values(failed).reduce((sum, arr) => sum + arr.length, 0);
  
  if (totalFailed > 0) {
    console.log(chalk.bold.red('\n❌ Failed Items Summary'));
    console.log('='.repeat(20));
    
    Object.entries(failed).forEach(([stage, items]) => {
      if (items.length > 0) {
        const stageName = stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        console.log(`  ${stageName}: ${chalk.red(items.length)} failed`);
        
        // Show first few failed items
        if (items.length <= 5) {
          items.forEach(item => console.log(`    - ${item}`));
        } else {
          items.slice(0, 3).forEach(item => console.log(`    - ${item}`));
          console.log(`    ... and ${items.length - 3} more`);
        }
      }
    });
    
    console.log(chalk.yellow('\n💡 Use --retry-failed to retry failed items'));
  } else {
    console.log(chalk.bold.green('\n✅ No Failed Items'));
  }
  
  // Next Actions
  console.log(chalk.bold.yellow('\n🎯 Next Actions'));
  console.log('='.repeat(12));
  
  if (stats.total_calls_extracted === 0) {
    console.log('  • Run pipeline to extract call IDs for your date range');
  } else if (stats.audio_downloaded < stats.total_calls_extracted) {
    console.log('  • Continue audio download process');
  } else if (stats.transcribed < stats.audio_downloaded) {
    console.log('  • Continue transcription process');
  } else if (stats.uploaded_to_bubble < stats.audio_downloaded) {
    console.log('  • Continue audio upload to Bubble');
  } else if (stats.analyzed < Math.min(stats.transcribed, stats.uploaded_to_bubble)) {
    console.log('  • Continue AI analysis and upload');
  } else {
    console.log('  • ✅ All processing complete for current data set');
    console.log('  • Update date range in config to process more calls');
  }
  
  // Show recent activity
  const stageData = pipelineState.state.stages;
  const lastRun = stageData.get_call_ids.last_run;
  
  if (lastRun) {
    const lastRunDate = new Date(lastRun).toLocaleString();
    console.log(`\n📅 Last pipeline run: ${chalk.cyan(lastRunDate)}`);
  }
  
  console.log('\n');
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${chalk.bold.cyan('Pipeline Status Tool')}

Usage: node status.js [options]

Options:
  --help, -h     Show this help message
  --retry-failed Retry all failed items
  --reset-failed Clear failed item records
  --stats-only   Show only statistics

Examples:
  node status.js              # Show full status report
  node status.js --stats-only # Show only statistics
`);
  process.exit(0);
}

if (args.includes('--retry-failed')) {
  console.log(chalk.yellow('🔄 Retrying failed items...'));
  const pipelineState = new PipelineState(config.directories.base_dir);
  
  ['download_audio', 'transcribe', 'upload_audio', 'analyze'].forEach(stage => {
    pipelineState.retryFailed(stage);
  });
  
  console.log(chalk.green('✅ Failed items cleared. Run pipeline to retry.'));
  process.exit(0);
}

if (args.includes('--reset-failed')) {
  console.log(chalk.yellow('🗑️ Clearing failed item records...'));
  const pipelineState = new PipelineState(config.directories.base_dir);
  
  ['download_audio', 'transcribe', 'upload_audio', 'analyze'].forEach(stage => {
    pipelineState.retryFailed(stage);
  });
  
  console.log(chalk.green('✅ Failed item records cleared.'));
  process.exit(0);
}

if (args.includes('--stats-only')) {
  const pipelineState = new PipelineState(config.directories.base_dir);
  const stats = pipelineState.getProcessingStats();
  
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

main();