const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { mp3ToAudioBuffer, applyPitchShifting, audioBufferToMp3 } = require('./lambda-deployment/mp3_conversion');

const app = express();
const port = 3001;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage: storage });

// Serve static files
app.use(express.static(__dirname));

// Route to handle audio upload and processing
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    console.log(`Processing file: ${req.file.path}`);
    
    // Read the uploaded MP3 file
    const inputBuffer = fs.readFileSync(req.file.path);
    console.log(`Input file size: ${inputBuffer.length} bytes`);
    
    // Convert MP3 to AudioBuffer
    console.log('Converting MP3 to AudioBuffer...');
    const audioBuffer = await mp3ToAudioBuffer(inputBuffer);
    console.log(`AudioBuffer created: ${audioBuffer.numberOfChannels} channels, ${audioBuffer.length} samples`);
    
    // Apply pitch shifting
    console.log('Applying pitch shifting...');
    const processedBuffer = await applyPitchShifting(audioBuffer);
    console.log('Pitch shifting applied successfully');
    
    // Convert back to MP3
    console.log('Converting back to MP3...');
    const outputBuffer = await audioBufferToMp3(processedBuffer);
    console.log(`Output MP3 size: ${outputBuffer.length} bytes`);
    
    // Save the processed file
    const outputDir = path.join(__dirname, 'processed');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFilename = `processed-${path.basename(req.file.originalname)}`;
    const outputPath = path.join(outputDir, outputFilename);
    fs.writeFileSync(outputPath, outputBuffer);
    
    // Return success response
    res.json({
      success: true,
      originalFile: req.file.originalname,
      processedFile: outputFilename,
      originalSize: inputBuffer.length,
      processedSize: outputBuffer.length,
      downloadUrl: `/processed/${outputFilename}`
    });
    
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({
      error: 'Failed to process audio file',
      details: error.message
    });
  }
});

// Default route to serve the test-upload.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-upload.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log(`Open your browser to http://localhost:${port} to test the upload functionality`);
});
