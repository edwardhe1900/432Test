const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function testAudioUpload() {
  try {
    // Path to the test MP3 file
    const testFilePath = path.join(__dirname, 'test-files', 'test-sample.mp3');
    console.log(`Testing upload with file: ${testFilePath}`);
    
    // Check if file exists
    if (!fs.existsSync(testFilePath)) {
      console.error('Test file not found!');
      return;
    }
    
    // Create form data
    const formData = new FormData();
    formData.append('audio', fs.createReadStream(testFilePath));
    
    console.log('Uploading file to server...');
    
    // Send the request
    const response = await axios.post('http://localhost:3001/upload-audio', formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });
    
    console.log('\nServer Response:');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));
    
    if (response.status === 200) {
      console.log('\n✅ Audio upload and conversion successful!');
    } else {
      console.log('\n❌ Audio upload or conversion failed!');
    }
  } catch (error) {
    console.error('\n❌ Error during test:');
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
    }
  }
}

// Run the test
testAudioUpload();
