const fs = require('fs');
const path = require('path');

// Import the audio processing functions
const {
  mp3ToAudioBuffer,
  applyPitchShifting,
  audioBufferToMp3
} = require('./lambda-deployment/mp3_conversion');

// Process an MP3 file locally
async function processAudioFile(inputFilePath, outputFilePath) {
  try {
    console.log(`Reading input file: ${inputFilePath}`);
    const mp3Buffer = fs.readFileSync(inputFilePath);
    console.log(`Input file size: ${mp3Buffer.length} bytes`);
    
    // Step 1: Convert MP3 to AudioBuffer
    console.log('\nStep 1: Converting MP3 to AudioBuffer...');
    const audioBuffer = await mp3ToAudioBuffer(mp3Buffer);
    console.log('AudioBuffer created successfully:');
    console.log(`- Sample rate: ${audioBuffer.sampleRate}Hz`);
    console.log(`- Channels: ${audioBuffer.numberOfChannels}`);
    console.log(`- Duration: ${audioBuffer.duration} seconds`);
    
    // Step 2: Apply pitch shifting
    console.log('\nStep 2: Applying pitch shifting...');
    const processedBuffer = await applyPitchShifting(audioBuffer);
    console.log('Pitch shifting applied successfully');
    
    // Step 3: Convert back to MP3
    console.log('\nStep 3: Converting back to MP3...');
    const processedMp3 = await audioBufferToMp3(processedBuffer);
    console.log(`Processed MP3 size: ${processedMp3.length} bytes`);
    
    // Save the processed file
    fs.writeFileSync(outputFilePath, processedMp3);
    console.log(`\nProcessed file saved to: ${outputFilePath}`);
    
    return true;
  } catch (error) {
    console.error('Error processing audio file:');
    console.error(error);
    return false;
  }
}

// Test file paths
const inputFilePath = path.join(__dirname, 'test-files', 'test-sample.mp3');
const outputFilePath = path.join(__dirname, 'test-files', 'processed-output.mp3');

// Run the test
processAudioFile(inputFilePath, outputFilePath)
  .then(success => {
    if (success) {
      console.log('\n✅ Audio conversion test completed successfully!');
    } else {
      console.log('\n❌ Audio conversion test failed.');
    }
  })
  .catch(err => {
    console.error('\nUnhandled error in test:', err);
  });
