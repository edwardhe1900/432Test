const AWS = require('aws-sdk');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseFile } = require('music-metadata');


// Processing pipeline
// 1. Download from S3 under cognito-sub-id/original/XXX.mp3
// 2. MP3 → WAV → Audio Buffer → Process → Audio Buffer → WAV → MP3
// 3. Upload to S3 under cognito-sub-id/processed/XXX.mp3
// 4. Save metadata to PostgreSQL

// Initialize S3 and RDS
const s3 = new AWS.S3();
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false
    },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
});
const accessPointArn = process.env.S3_ACCESS_POINT_ARN;

// Pitch shifting algorithm
async function applyPitchShifting(audioBuffer) {
    // Pitch factor of 0.9818 lowers the pitch slightly (about a quarter step)
    const pitchFactor = 0.9818;
    const numChannels = audioBuffer.numberOfChannels;
    const bufferLength = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    
    // Create a proper output buffer with actual Float32Arrays for each channel
    const channelData = [];
    for (let channel = 0; channel < numChannels; channel++) {
        channelData.push(new Float32Array(bufferLength));
    }
    
    const outputBuffer = {
        sampleRate: sampleRate,
        numberOfChannels: numChannels,
        length: bufferLength,
        duration: bufferLength / sampleRate,
        getChannelData: (channel) => channelData[channel]
    };
    
    // Process each channel
    for (let channel = 0; channel < numChannels; channel++) {
        const inputData = audioBuffer.getChannelData(channel);
        const outputData = outputBuffer.getChannelData(channel);
        
        // Process the entire buffer at once for better results
        for (let i = 0; i < bufferLength; i++) {
            // Calculate the exact sample position based on pitch factor
            const position = i * pitchFactor;
            const index = Math.floor(position);
            const fraction = position - index;
            
            // Bounds checking to avoid accessing outside the buffer
            if (index >= 0 && index < bufferLength - 1) {
                // Linear interpolation for simplicity and performance
                outputData[i] = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
            } else if (index >= 0 && index < bufferLength) {
                // Edge case at the end of the buffer
                outputData[i] = inputData[index];
            }
            // Else leave as 0 (silence) for out-of-bounds indices
        }
    }
    
    return outputBuffer;
}


// Convert MP3 to audio buffer using pure JavaScript
async function mp3ToAudioBuffer(mp3Buffer) {
    // This is a more robust implementation for Lambda environment
    try {
        // Use a more reliable approach with lame and wav packages
        const lame = require('node-lame').Lame;
        const wavDecoder = require('wav-decoder');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // Create temporary files for conversion
        const tempDir = os.tmpdir();
        const tempMp3Path = path.join(tempDir, `temp-${Date.now()}.mp3`);
        const tempWavPath = path.join(tempDir, `temp-${Date.now()}.wav`);
        
        // Write MP3 buffer to temp file
        fs.writeFileSync(tempMp3Path, mp3Buffer);
        
        // Convert MP3 to WAV using node-lame
        const decoder = new lame({
            output: tempWavPath,
            bitrate: 192
        });
        
        await decoder.setFile(tempMp3Path).decode();
        
        // Read WAV file
        const wavBuffer = fs.readFileSync(tempWavPath);
        
        // Decode WAV to audio buffer
        const wavData = await wavDecoder.decode(wavBuffer);
        
        // Create an AudioBuffer-like object
        const audioBuffer = {
            sampleRate: wavData.sampleRate,
            length: wavData.channelData[0].length,
            numberOfChannels: wavData.channelData.length,
            duration: wavData.channelData[0].length / wavData.sampleRate,
            getChannelData: (channel) => {
                if (channel < wavData.channelData.length) {
                    return wavData.channelData[channel];
                }
                return new Float32Array(wavData.channelData[0].length);
            }
        };
        
        // Clean up temp files
        try {
            fs.unlinkSync(tempMp3Path);
            fs.unlinkSync(tempWavPath);
        } catch (cleanupError) {
            console.warn('Error cleaning up temp files:', cleanupError);
        }
        
        return audioBuffer;
    } catch (error) {
        console.error('MP3 to AudioBuffer conversion error:', error);
        throw error;
    }
}

// Convert audio buffer to MP3 using pure JavaScript
async function audioBufferToMp3(audioBuffer) {
    // More robust implementation for Lambda environment
    try {
        const Lame = require('node-lame').Lame;
        const wavEncoder = require('wav-encoder');
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        
        // Extract audio data
        const numChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const sampleRate = audioBuffer.sampleRate;
        
        // Prepare WAV data format
        const channelData = [];
        for (let channel = 0; channel < numChannels; channel++) {
            channelData.push(audioBuffer.getChannelData(channel));
        }
        
        // Create WAV data
        const wavData = {
            sampleRate: sampleRate,
            channelData: channelData
        };
        
        // Encode to WAV buffer
        const wavBuffer = await wavEncoder.encode(wavData);
        
        // Create temporary files for conversion
        const tempDir = os.tmpdir();
        const tempWavPath = path.join(tempDir, `temp-${Date.now()}.wav`);
        const tempMp3Path = path.join(tempDir, `temp-${Date.now()}.mp3`);
        
        // Write WAV buffer to temp file
        fs.writeFileSync(tempWavPath, Buffer.from(wavBuffer));
        
        // Convert WAV to MP3 using node-lame
        const encoder = new Lame({
            output: tempMp3Path,
            bitrate: 192,
            mode: numChannels === 1 ? 'm' : 'j' // mono or joint stereo
        });
        
        await encoder.setFile(tempWavPath).encode();
        
        // Read MP3 file
        const mp3Buffer = fs.readFileSync(tempMp3Path);
        
        // Clean up temp files
        try {
            fs.unlinkSync(tempWavPath);
            fs.unlinkSync(tempMp3Path);
        } catch (cleanupError) {
            console.warn('Error cleaning up temp files:', cleanupError);
        }
        
        return mp3Buffer;
    } catch (error) {
        console.error('AudioBuffer to MP3 conversion error:', error);
        throw error;
    }
}


// Extract metadata from MP3 file
async function extractMetadata(filePath, userSub, filename) {
    try {
        const metadata = await parseFile(filePath);
        let coverImageUrl = null;
        
        // Handle cover image if exists
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0];
            const coverKey = `${userSub}/covers/${filename.replace(/\.[^/.]+$/, '')}.${picture.format.split('/')[1] || 'jpg'}`;
            await s3.putObject({
                Bucket: accessPointArn,
                Key: coverKey,
                Body: picture.data,
                ContentType: picture.format,
                ACL: 'public-read'
            }).promise();
            coverImageUrl = `https://${process.env.BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${coverKey}`;
        }

        return {
            title: metadata.common.title || 'Unknown Title',
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            year: metadata.common.year || null,
            duration: Math.round((metadata.format.duration || 0) * 1000), // convert to ms
            coverImageUrl: coverImageUrl
        };
    } catch (error) {
        console.error('Error extracting metadata:', error);
        return {
            title: 'Unknown Title',
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            year: null,
            duration: 0,
            coverImageUrl: null
        };
    }
}

// Update the saveMetadataToDB function parameters
async function saveMetadataToDB(metadata, processedKey, userSub) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const query = `
            INSERT INTO tracks (
                track_name, user_id, track_artist, track_album, 
                duration_ms, track_image_url, s3_path
            )
            SELECT $1, u.user_id, $3, $4, $5, $6, $7
            FROM users u
            WHERE u.cognito_sub = $2
            RETURNING track_id
        `;
        const values = [
            metadata.title,
            userSub,
            metadata.artist,
            metadata.album,
            metadata.duration,
            metadata.coverImageUrl,
            processedKey
        ];
        const result = await client.query(query, values);
        await client.query('COMMIT');
        return result.rows[0].track_id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}



exports.handler = async (event) => {
    let bucket, originalPath, userSub, filename;
    if (event.userSub && event.fileName && event.s3Bucket) {
        userSub = event.userSub;
        filename = event.fileName;
        bucket = event.s3Bucket;
        originalPath = `${userSub}/original/${filename}`;
    } else {
        console.error('Invalid event format:', event);
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Invalid event format' })
        };
    }
    const filePath = `${userSub}/processed/${filename}`;
    const tempDir = os.tmpdir();
    const localInputPath = path.join(tempDir, filename);
    try {
        // Download the file from S3
        console.log(`Downloading file from s3://${bucket}/${originalPath}`);
        const s3Object = await s3.getObject({ Bucket: accessPointArn, Key: originalPath }).promise();
        fs.writeFileSync(localInputPath, s3Object.Body);
        // Extract metadata before processing
        console.log('Extracting metadata');
        const metadata = await extractMetadata(localInputPath, userSub, filename);
        
        // Convert MP3 to audio buffer
        console.log('Converting MP3 to audio buffer');
        let processedMp3;
        try {
            // Log the size of the input file for debugging
            console.log(`Input file size: ${s3Object.Body.length} bytes`);
            
            // Convert MP3 to audio buffer
            console.log('Starting MP3 to AudioBuffer conversion');
            const audioBuffer = await mp3ToAudioBuffer(s3Object.Body);
            console.log(`Successfully converted to AudioBuffer: ${audioBuffer.numberOfChannels} channels, ${audioBuffer.length} samples, ${audioBuffer.sampleRate}Hz`);
            
            // Process the audio using our pitch shifting algorithm
            console.log('Processing audio with pitch shifting algorithm');
            const processedBuffer = await applyPitchShifting(audioBuffer);
            console.log('Pitch shifting completed successfully');
            
            // Convert processed audio buffer back to MP3
            console.log('Converting processed audio buffer to MP3');
            processedMp3 = await audioBufferToMp3(processedBuffer);
            console.log(`Successfully converted back to MP3: ${processedMp3.length} bytes`);
        } catch (error) {
            console.error('Audio processing error:', error);
            console.error('Error stack trace:', error.stack);
            console.log('Falling back to original file due to processing error');
            processedMp3 = s3Object.Body; // Fallback to original if processing fails
        }
        
        // Upload the processed file back to S3
        console.log(`Uploading processed file to s3://${bucket}/${filePath}`);
        await s3.putObject({
            Bucket: accessPointArn,
            Key: filePath,
            Body: processedMp3, // Now using the processed MP3 content
            ContentType: 'audio/mpeg'
        }).promise();
        // Insert track metadata to pg
        console.log('Saving metadata to database');
        const fileId = await saveMetadataToDB(metadata, filePath, userSub);
        // Clean up
        fs.unlinkSync(localInputPath);
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Audio converted and saved to S3',
                fileId: fileId,
                originalKey: originalPath,
                processedKey: filePath
            })
        };
    } catch (error) {
        if (fs.existsSync(localInputPath)) fs.unlinkSync(localInputPath);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error processing file', error: error.message })
        };
    }
};

// Export functions for testing
module.exports = {
    mp3ToAudioBuffer,
    audioBufferToMp3,
    applyPitchShifting,
    extractMetadata,
    saveMetadataToDB
};