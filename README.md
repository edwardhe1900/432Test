# EE547_Final_Project - Music Processing Application

A web application that allows users to upload MP3 files, process them with a pitch-shifting algorithm, and manage their music library and playlists.

## Project Overview

This application provides a complete music management system with the following capabilities:
- User authentication via AWS Cognito
- MP3 file upload and processing
- Pitch-shifting audio processing algorithm
- Music library management
- Playlist creation and management
- Audio playback

## Architecture

- **Frontend**: HTML/CSS/JavaScript
- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **Storage**: AWS S3 for audio file storage
- **Authentication**: AWS Cognito
- **Audio Processing**: Custom pitch-shifting algorithm

## Features

- **User Authentication**: Secure signup, login, and token management
- **Audio Processing**: Pitch-shifting algorithm that lowers pitch by approximately a quarter step
- **File Management**: Upload, download, and stream audio files
- **Music Library**: Organize and browse your music collection
- **Playlists**: Create and manage playlists
- **Metadata Extraction**: Extract and store audio metadata including title, artist, album, and cover art

## Setup

### Prerequisites
- Node.js (v14+)
- npm
- PostgreSQL database
- AWS account (for S3 and Cognito in production mode)

### Development/Testing Setup

1. Clone the repository
```
git clone https://github.com/liuty132/EE547_Final_Project
cd EE547_Final_Project
```

2. Install dependencies
```
npm install
```

3. Run the test server (no AWS or database required)
```
node test-server.js
```

4. Access the test interface at `http://localhost:3001`

### Production Setup

1. Clone the repository
```
git clone https://github.com/liuty132/EE547_Final_Project
cd EE547_Final_Project
```

2. Create a `.env` file in the root directory with the following variables:
```
# Database Configuration
DB_HOST=your_db_host
DB_PORT=your_db_port
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# AWS Configuration
AWS_REGION=your_aws_region
S3_AUDIO_BUCKET=your_s3_bucket
S3_ACCESS_POINT_ARN=your_s3_access_point_arn
AUDIO_PROCESSOR_LAMBDA=your_lambda_function_name

# Cognito Configuration
COGNITO_CLIENT_ID=your_cognito_client_id
COGNITO_CLIENT_SECRET=your_cognito_client_secret

# Server Configuration
PORT=3000
```

3. Set up the database using the schema in `table_creation.sql`

4. Install dependencies
```
npm install
```

5. Run the application
```
node server.js
```

6. Access the application at `http://localhost:3000`

## Testing

### Test Server
For quick testing of the audio processing functionality without AWS services:
```
node test-server.js
```

### Automated Testing
To run the automated test for audio upload and processing:
```
node test-upload.js
```

### Debug Audio Conversion
To debug the audio conversion process with detailed logs:
```
node debug-audio-conversion.js
```

## Project Structure

- `server.js` - Main application server
- `lambda-deployment/mp3_conversion.js` - Core audio processing functionality
- `test-server.js` - Simplified test server for local testing
- `test-upload.js` - Script to test audio upload functionality
- `debug-audio-conversion.js` - Debug script for audio conversion
- `table_creation.sql` - Database schema
- `public/` - Static frontend files
- `test-files/` - Sample audio files for testing
- `processed/` - Directory for processed audio files
- `uploads/` - Directory for uploaded audio files

## License

This project was created for EE547 Final Project.
