const fs = require('fs');
const path = require('path');

// Import the functions from mp3_conversion.js
const conversion = require('./lambda-deployment/mp3_conversion');

// Set up mock environment variables for testing
process.env.DB_USER = 'test_user';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'test_db';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_PORT = '5432';
process.env.S3_ACCESS_POINT_ARN = 'test-bucket';
process.env.BUCKET = 'test-bucket';
process.env.AWS_REGION = 'us-west-2';

// Test function to process an MP3 file - step by step for debugging
async function testMp3ToAudioBuffer(inputFilePath) {
  try {
    console.log(`Reading file: ${inputFilePath}`);
    const mp3Buffer = fs.readFileSync(inputFilePath);
    console.log(`File size: ${mp3Buffer.length} bytes`);
    
    console.log('Testing mp3ToAudioBuffer function...');
    const audioBuffer = await conversion.mp3ToAudioBuffer(mp3Buffer);
    console.log('AudioBuffer created successfully:');
    console.log(`- Sample rate: ${audioBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${audioBuffer.numberOfChannels}`);
    console.log(`- Duration: ${audioBuffer.duration} seconds`);
    return audioBuffer;
  } catch (error) {
    console.error('Error in mp3ToAudioBuffer:');
    console.error(error);
    throw error;
  }
}

async function testApplyPitchShifting(audioBuffer) {
  try {
    console.log('Testing applyPitchShifting function...');
    const processedBuffer = await conversion.applyPitchShifting(audioBuffer);
    console.log('Pitch shifting applied successfully');
    return processedBuffer;
  } catch (error) {
    console.error('Error in applyPitchShifting:');
    console.error(error);
    throw error;
  }
}

async function testAudioBufferToMp3(audioBuffer, outputFilePath) {
  try {
    console.log('Testing audioBufferToMp3 function...');
    const processedMp3 = await conversion.audioBufferToMp3(audioBuffer);
    console.log(`Processed MP3 size: ${processedMp3.length} bytes`);
    
    // Save the processed file
    fs.writeFileSync(outputFilePath, processedMp3);
    console.log(`Processed file saved to: ${outputFilePath}`);
    return true;
  } catch (error) {
    console.error('Error in audioBufferToMp3:');
    console.error(error);
    throw error;
  }
}

// Main test function that runs all the steps
async function runTests() {
  // Check if a file path was provided
  if (process.argv.length < 3) {
    console.log('Usage: node test-mp3-conversion.js <path-to-mp3-file>');
    process.exit(1);
  }

  // Get the file path from command line arguments
  const inputFilePath = process.argv[2];
  const outputFilePath = path.join(path.dirname(inputFilePath), 'processed-' + path.basename(inputFilePath));
  
  try {
    // Step 1: MP3 to AudioBuffer
    console.log('=== STEP 1: MP3 TO AUDIO BUFFER ===');
    const audioBuffer = await testMp3ToAudioBuffer(inputFilePath);
    
    // Step 2: Apply pitch shifting
    console.log('=== STEP 2: APPLY PITCH SHIFTING ===');
    const processedBuffer = await testApplyPitchShifting(audioBuffer);
    
    // Step 3: AudioBuffer to MP3
    console.log('=== STEP 3: AUDIO BUFFER TO MP3 ===');
    await testAudioBufferToMp3(processedBuffer, outputFilePath);
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the tests
runTests();

