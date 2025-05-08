const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Import the audio conversion functions
const { mp3ToAudioBuffer, applyPitchShifting, audioBufferToMp3 } = require('./lambda-deployment/mp3_conversion');

// Load test environment variables
require('./test-env');

const app = express();
const port = process.env.PORT || 3000;

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

// Middleware
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static("public"));

// Mock authentication middleware for testing
const mockAuthMiddleware = (req, res, next) => {
  // For testing purposes, we'll just add a mock user to the request
  req.user = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User'
  };
  next();
};

// Home route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mock login endpoint
app.post('/login', (req, res) => {
  res.json({
    success: true,
    message: 'Logged in successfully',
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User'
    }
  });
});

// Mock user profile endpoint
app.get('/user-profile', mockAuthMiddleware, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Audio upload and processing endpoint
app.post('/upload-audio', mockAuthMiddleware, upload.single('audio'), async (req, res) => {
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
    
    // Mock database entry
    const mockTrackId = `track-${Date.now()}`;
    
    // Return success response
    res.json({
      success: true,
      message: 'Audio processed successfully',
      track: {
        id: mockTrackId,
        title: req.file.originalname,
        processedFile: outputFilename,
        originalSize: inputBuffer.length,
        processedSize: outputBuffer.length,
        downloadUrl: `/processed/${outputFilename}`
      }
    });
    
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({
      error: 'Failed to process audio file',
      details: error.message
    });
  }
});

// Endpoint to list processed files
app.get('/processed-files', mockAuthMiddleware, (req, res) => {
  const processedDir = path.join(__dirname, 'processed');
  
  if (!fs.existsSync(processedDir)) {
    return res.json({ files: [] });
  }
  
  try {
    const files = fs.readdirSync(processedDir)
      .filter(file => file.endsWith('.mp3'))
      .map(file => ({
        name: file,
        url: `/processed/${file}`,
        date: fs.statSync(path.join(processedDir, file)).mtime
      }));
    
    res.json({ files });
  } catch (error) {
    console.error('Error listing processed files:', error);
    res.status(500).json({ error: 'Failed to list processed files' });
  }
});

// Serve processed files
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Start the server
app.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log(`Open your browser to http://localhost:${port} to test the full application`);
});
