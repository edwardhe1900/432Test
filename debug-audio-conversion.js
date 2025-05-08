/**
 * Debug Audio Conversion Process
 * 
 * This script tests each step of the audio conversion process with detailed logging
 * to help identify any issues in the pipeline.
 */

const fs = require('fs');
const path = require('path');

// Import the audio processing functions
const {
  mp3ToAudioBuffer,
  applyPitchShifting,
  audioBufferToMp3
} = require('./lambda-deployment/mp3_conversion');

// Set up mock environment variables for testing
process.env.DB_USER = 'test_user';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'test_db';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_PORT = '5432';
process.env.S3_ACCESS_POINT_ARN = 'test-bucket';
process.env.BUCKET = 'test-bucket';
process.env.AWS_REGION = 'us-west-2';

// Create debug directory if it doesn't exist
const debugDir = path.join(__dirname, 'debug-output');
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

/**
 * Debug Step 1: MP3 to AudioBuffer Conversion
 */
async function debugMp3ToAudioBuffer(inputFilePath) {
  console.log('\n======== STEP 1: MP3 TO AUDIOBUFFER ========');
  console.log(`Reading input file: ${inputFilePath}`);
  
  try {
    // Read the MP3 file
    const mp3Buffer = fs.readFileSync(inputFilePath);
    console.log(`Input file size: ${mp3Buffer.length} bytes`);
    
    // Save a copy of the input file for reference
    const inputCopyPath = path.join(debugDir, 'input-copy.mp3');
    fs.writeFileSync(inputCopyPath, mp3Buffer);
    console.log(`Saved copy of input file to: ${inputCopyPath}`);
    
    // Convert MP3 to AudioBuffer
    console.log('\nConverting MP3 to AudioBuffer...');
    console.time('MP3 to AudioBuffer conversion time');
    const audioBuffer = await mp3ToAudioBuffer(mp3Buffer);
    console.timeEnd('MP3 to AudioBuffer conversion time');
    
    // Log AudioBuffer details
    console.log('\nAudioBuffer created successfully:');
    console.log(`- Sample rate: ${audioBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${audioBuffer.numberOfChannels}`);
    console.log(`- Length: ${audioBuffer.length} samples`);
    console.log(`- Duration: ${audioBuffer.duration} seconds`);
    
    // Log channel data statistics
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      
      for (let i = 0; i < channelData.length; i++) {
        min = Math.min(min, channelData[i]);
        max = Math.max(max, channelData[i]);
        sum += channelData[i];
      }
      
      const avg = sum / channelData.length;
      console.log(`- Channel ${channel} stats: min=${min.toFixed(4)}, max=${max.toFixed(4)}, avg=${avg.toFixed(4)}`);
    }
    
    console.log('\nStep 1 completed successfully');
    return audioBuffer;
  } catch (error) {
    console.error('\nError in Step 1 (MP3 to AudioBuffer):', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

/**
 * Debug Step 2: Apply Pitch Shifting
 */
async function debugApplyPitchShifting(audioBuffer) {
  console.log('\n======== STEP 2: APPLY PITCH SHIFTING ========');
  
  try {
    // Log input AudioBuffer details
    console.log('Input AudioBuffer:');
    console.log(`- Sample rate: ${audioBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${audioBuffer.numberOfChannels}`);
    console.log(`- Length: ${audioBuffer.length} samples`);
    console.log(`- Duration: ${audioBuffer.duration} seconds`);
    
    // Apply pitch shifting
    console.log('\nApplying pitch shifting algorithm...');
    console.time('Pitch shifting processing time');
    const processedBuffer = await applyPitchShifting(audioBuffer);
    console.timeEnd('Pitch shifting processing time');
    
    // Log processed AudioBuffer details
    console.log('\nProcessed AudioBuffer:');
    console.log(`- Sample rate: ${processedBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${processedBuffer.numberOfChannels}`);
    console.log(`- Length: ${processedBuffer.length} samples`);
    console.log(`- Duration: ${processedBuffer.duration} seconds`);
    
    // Compare input and output channel data
    for (let channel = 0; channel < processedBuffer.numberOfChannels; channel++) {
      const inputData = audioBuffer.getChannelData(channel);
      const outputData = processedBuffer.getChannelData(channel);
      
      let inputMin = Infinity, inputMax = -Infinity;
      let outputMin = Infinity, outputMax = -Infinity;
      let diffSum = 0;
      
      const sampleCount = Math.min(inputData.length, outputData.length);
      for (let i = 0; i < sampleCount; i++) {
        inputMin = Math.min(inputMin, inputData[i]);
        inputMax = Math.max(inputMax, inputData[i]);
        outputMin = Math.min(outputMin, outputData[i]);
        outputMax = Math.max(outputMax, outputData[i]);
        diffSum += Math.abs(outputData[i] - inputData[i]);
      }
      
      const avgDiff = diffSum / sampleCount;
      console.log(`- Channel ${channel} comparison:`);
      console.log(`  - Input range: ${inputMin.toFixed(4)} to ${inputMax.toFixed(4)}`);
      console.log(`  - Output range: ${outputMin.toFixed(4)} to ${outputMax.toFixed(4)}`);
      console.log(`  - Average difference: ${avgDiff.toFixed(4)}`);
    }
    
    console.log('\nStep 2 completed successfully');
    return processedBuffer;
  } catch (error) {
    console.error('\nError in Step 2 (Apply Pitch Shifting):', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

/**
 * Debug Step 3: AudioBuffer to MP3 Conversion
 */
async function debugAudioBufferToMp3(processedBuffer, outputFilePath) {
  console.log('\n======== STEP 3: AUDIOBUFFER TO MP3 ========');
  
  try {
    // Log input AudioBuffer details
    console.log('Input AudioBuffer:');
    console.log(`- Sample rate: ${processedBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${processedBuffer.numberOfChannels}`);
    console.log(`- Length: ${processedBuffer.length} samples`);
    console.log(`- Duration: ${processedBuffer.duration} seconds`);
    
    // Convert AudioBuffer to MP3
    console.log('\nConverting AudioBuffer to MP3...');
    console.time('AudioBuffer to MP3 conversion time');
    const processedMp3 = await audioBufferToMp3(processedBuffer);
    console.timeEnd('AudioBuffer to MP3 conversion time');
    
    // Log processed MP3 details
    console.log(`\nProcessed MP3 size: ${processedMp3.length} bytes`);
    
    // Save the processed MP3 file
    fs.writeFileSync(outputFilePath, processedMp3);
    console.log(`Processed file saved to: ${outputFilePath}`);
    
    // Save debug info
    const debugInfoPath = path.join(debugDir, 'conversion-debug-info.json');
    const debugInfo = {
      timestamp: new Date().toISOString(),
      inputAudioBuffer: {
        sampleRate: processedBuffer.sampleRate,
        channels: processedBuffer.numberOfChannels,
        length: processedBuffer.length,
        duration: processedBuffer.duration
      },
      outputMp3: {
        size: processedMp3.length,
        path: outputFilePath
      }
    };
    fs.writeFileSync(debugInfoPath, JSON.stringify(debugInfo, null, 2));
    console.log(`Debug info saved to: ${debugInfoPath}`);
    
    console.log('\nStep 3 completed successfully');
    return processedMp3;
  } catch (error) {
    console.error('\nError in Step 3 (AudioBuffer to MP3):', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

/**
 * Run all debug steps
 */
async function runDebugProcess() {
  const inputFilePath = process.argv[2] || path.join(__dirname, 'test-files', 'test-sample.mp3');
  const outputFilePath = path.join(debugDir, 'debug-processed-output.mp3');
  
  console.log('====================================================');
  console.log('AUDIO CONVERSION DEBUG PROCESS');
  console.log('====================================================');
  console.log(`Input file: ${inputFilePath}`);
  console.log(`Output directory: ${debugDir}`);
  console.log(`Output file: ${outputFilePath}`);
  console.log('====================================================');
  
  try {
    // Check if input file exists
    if (!fs.existsSync(inputFilePath)) {
      console.error(`Error: Input file not found: ${inputFilePath}`);
      console.log('Usage: node debug-audio-conversion.js [path-to-mp3-file]');
      process.exit(1);
    }
    
    // Run each step with detailed debugging
    const startTime = Date.now();
    
    // Step 1: MP3 to AudioBuffer
    const audioBuffer = await debugMp3ToAudioBuffer(inputFilePath);
    
    // Step 2: Apply Pitch Shifting
    const processedBuffer = await debugApplyPitchShifting(audioBuffer);
    
    // Step 3: AudioBuffer to MP3
    await debugAudioBufferToMp3(processedBuffer, outputFilePath);
    
    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n====================================================');
    console.log(`AUDIO CONVERSION COMPLETED SUCCESSFULLY in ${totalTime.toFixed(2)} seconds`);
    console.log('====================================================');
    
    // Play the processed file (if possible)
    console.log('\nTo play the processed file, run:');
    console.log(`open "${outputFilePath}"`);
  } catch (error) {  
    console.error('\n====================================================');
    console.error('AUDIO CONVERSION FAILED');
    console.error('====================================================');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the debug process
runDebugProcess();
