const express = require('express');
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cookieParser = require('cookie-parser');
const path = require('path');
const got = require('got');
const fs = require('fs');
require('dotenv').config(); 


const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });
AWS.config.update({
    region: process.env.AWS_REGION
});
app.use(express.json());
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static("public"));
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});


// ---------------------- Home Page ----------------------
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: './public' });
});


// ---------------------- Cognito ----------------------
const cognito = new AWS.CognitoIdentityServiceProvider();
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET;


// helper function to calculate SECRET_HASH
const calculateSecretHash = (username) => {
    const message = username + CLIENT_ID;
    const hmac = crypto.createHmac('SHA256', CLIENT_SECRET);
    const secretHash = hmac.update(message).digest('base64');
    return secretHash;
};


app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;
    const params = {
        ClientId: CLIENT_ID, 
        Username: username,
        Password: password,
        SecretHash: calculateSecretHash(username),
        UserAttributes: [
            {
                Name: 'email',
                Value: email
            }
        ]
    };
    try {
        const data = await cognito.signUp(params).promise();
        const cognitoSub = data.UserSub;
        const pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: {
                rejectUnauthorized: false
            },
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000
        });
        await pool.query(
            'INSERT INTO users (cognito_sub, username) VALUES ($1, $2)',
            [cognitoSub, username]
        );
        await pool.end();
        res.json(data);
    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ 
            error: error.message,
            details: error.details || null
        });
    }
});


app.post('/confirm', async (req, res) => {
    const { username, code } = req.body;
    const params = {
        ClientId: CLIENT_ID, 
        Username: username,
        ConfirmationCode: code,
        SecretHash: calculateSecretHash(username)
    };
    try {
        const data = await cognito.confirmSignUp(params).promise();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}); 


app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const params = {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
            USERNAME: username,
            PASSWORD: password,
            SECRET_HASH: calculateSecretHash(username)
        }
    };
    try {
        const data = await cognito.initiateAuth(params).promise();
        // Set refresh token in HTTP-only cookie
        res.cookie('refreshToken', data.AuthenticationResult.RefreshToken, {
            httpOnly: true,
            secure: false, // for HTTPS
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days
            path: '/'
        });
        // Also store the username in a cookie for refresh token operations
        res.cookie('username', username, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days
            path: '/'
        });
        // Send access token in response body
        res.json({
            accessToken: data.AuthenticationResult.AccessToken,
            expiresIn: data.AuthenticationResult.ExpiresIn
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


app.get('/user-info', async (req, res) => {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7, authHeader.length);
    }
    if (!token) {
        return res.status(401).json({ error: 'Access token is required' });
    }    
    const params = {
        AccessToken: token
    };
    try {
        const userData = await cognito.getUser(params).promise();
        const username = userData.Username;
        const subAttribute = userData.UserAttributes.find(attr => attr.Name === 'sub');
        const sub = subAttribute ? subAttribute.Value : null;
        res.json({ 
            username,
            sub
        });
    } catch (error) {
        console.error('Get user info error:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});


app.post('/logout', async (req, res) => {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7, authHeader.length);
    }
    if (!token) {
        res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'strict' });
        res.clearCookie('username', { httpOnly: true, secure: true, sameSite: 'strict' });
        return res.status(401).json({ error: 'Access token is required' });
    }
    const params = {
        AccessToken: token
    };
    try {
        await cognito.globalSignOut(params).promise();
        // Clear the cookies on successful logout
        res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'strict' });
        res.clearCookie('username', { httpOnly: true, secure: true, sameSite: 'strict' });
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'strict' });
        res.clearCookie('username', { httpOnly: true, secure: true, sameSite: 'strict' });
        console.error('Logout error:', error); // Log detailed error server-side
        res.status(400).json({ error: 'Logout failed. Please try again.' }); 
    }
});


app.post('/refresh-token', async (req, res) => {
    const refreshToken = req.cookies.refreshToken; // Read from HttpOnly cookie
    const username = req.cookies.username; // Get username from cookie
    if (!refreshToken || !username) {
        return res.status(401).json({ error: 'No refresh token or username provided' });
    }
    const params = {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: calculateSecretHash(username)
        }
    };
    try {
        const data = await cognito.initiateAuth(params).promise();
        res.json({
            accessToken: data.AuthenticationResult.AccessToken,
            expiresIn: data.AuthenticationResult.ExpiresIn
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        res.clearCookie('refreshToken', { httpOnly: true, secure: false, sameSite: 'lax' });
        res.clearCookie('username', { httpOnly: true, secure: false, sameSite: 'lax' });
        res.status(401).json({ error: 'Session expired or invalid. Please log in again.' }); 
    }
});


// ---------------------- Radio ----------------------
// Official KUSC Stream URLs directly from kusc.org
const KUSC_STREAM_URLS = [
    'https://playerservices.streamtheworld.com/pls/KUSCAAC96.pls', // High Quality (Recommended)
    'https://playerservices.streamtheworld.com/pls/KUSCAAC32.pls', // High Efficiency (HE-AAC with low data usage)
    'https://playerservices.streamtheworld.com/pls/KUSCMP256.pls'  // Premium Quality (AAC 256kbps)
];


// Route to proxy the radio stream (no server-side pitch shifting)
app.get('/stream', async (req, res) => {
    try {
        // Set appropriate headers
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        console.log(`Attempting to stream from ${KUSC_STREAM_URLS[0]}`);
        // Try to get the primary stream
        let streamResponse;
        try {
            streamResponse = await got.stream(KUSC_STREAM_URLS[0], {
                timeout: { request: 10000 }, retry: { limit: 2 }
            });
        } catch (err) {
            console.log(`Primary stream failed, trying fallback: ${KUSC_STREAM_URLS[1]}`);
            // Try first fallback
            try {
                streamResponse = await got.stream(KUSC_STREAM_URLS[1], {
                    timeout: { request: 10000 }
                });
            } catch (err2) {
                console.log(`Secondary stream failed, trying last resort: ${KUSC_STREAM_URLS[2]}`);
                // Try second fallback (demo station)
                streamResponse = await got.stream(KUSC_STREAM_URLS[2]);
            }
        }
        // Just pipe the stream - we'll do pitch shifting on the client side
        streamResponse.pipe(res);
        // Handle errors
        streamResponse.on('error', (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).send('Stream error');
            }
        });
    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) {
            res.status(500).send('Error connecting to radio stream');
        }
    }
});


// Route to serve the radio page
app.get('/radio', (req, res) => {
    // Read the radio.html file
    let radioHtml = fs.readFileSync(path.join(__dirname, 'public', 'radio.html'), 'utf8');
    // Inject the script tag before the closing body tag
    res.send(radioHtml);
});


// ---------------------- Upload/Download Audio Files ----------------------
// Middleware to verify Cognito token and extract user info
const verifyCognitoToken = async (req, res, next) => {
    console.log('Verifying Cognito token...');
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7, authHeader.length);
    }
    if (!token) {
        // return res.status(401).json({ error: 'No valid token provided' });
        // if no token, continue without userSub and username
        req.userSub = 'non_user';
        req.username = 'na';
        next();
        return;
    }
    try {
        const params = {
            AccessToken: token
        };
        const userData = await cognito.getUser(params).promise();
        const subAttribute = userData.UserAttributes.find(attr => attr.Name === 'sub');
        if (!subAttribute) {
            return res.status(401).json({ error: 'Could not identify user from token' });
        }
        req.userSub = subAttribute.Value;
        req.username = userData.Username;
        next();
    } catch (error) {
        // console.error('Token verification error:', error);
        // res.status(401).json({ error: 'Invalid or expired token' });
        // if token verification fails, continue without userSub and username
        req.userSub = 'non_user';
        req.username = 'na';
        next();
    }
};


// Import the audio processing functions from mp3_conversion.js
const { mp3ToAudioBuffer, applyPitchShifting, audioBufferToMp3 } = require('./lambda-deployment/mp3_conversion');

// Local function to process audio without AWS services
async function processAudioLocally(audioBuffer) {
    try {
        console.log('Processing audio locally...');
        console.log(`Input AudioBuffer: ${audioBuffer.numberOfChannels} channels, ${audioBuffer.sampleRate}Hz, ${audioBuffer.duration} seconds`);
        
        // Apply pitch shifting
        console.log('Applying pitch shifting...');
        const processedBuffer = await applyPitchShifting(audioBuffer);
        console.log('Pitch shifting applied successfully');
        
        // Convert back to MP3
        console.log('Converting processed buffer to MP3...');
        const processedMp3 = await audioBufferToMp3(processedBuffer);
        console.log(`Processed MP3 size: ${processedMp3.length} bytes`);
        
        return {
            success: true,
            data: processedMp3
        };
    } catch (error) {
        console.error('Error in local audio processing:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Route to handle file upload and trigger Lambda processing
app.post('/upload-audio', verifyCognitoToken, upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }    
    try {
        // Basic validation on file type and size
        if (!req.file.mimetype.startsWith('audio/')) {
            return res.status(400).json({ error: 'Only audio files are allowed' });
        }
        if (req.file.size > 10*1024*1024) { // 10MB limit
            return res.status(400).json({ error: 'File size exceeds the 10MB limit' });
        }
        
        const fileName = `${Date.now()}-${req.file.originalname}`;
        
        // Check if AWS services are configured
        const s3Bucket = process.env.S3_AUDIO_BUCKET;
        const lambdaFunction = process.env.AUDIO_PROCESSOR_LAMBDA;
        
        // If AWS services are configured, use them
        if (s3Bucket && lambdaFunction) {
            console.log('Using AWS services for audio processing...');
            
            // Upload unprocessed file to S3
            const s3 = new AWS.S3();
            const filePath = `${req.userSub}/original/${fileName}`;
            console.log(`Uploading file to s3://${s3Bucket}/${filePath}`);
            
            await s3.upload({
                Bucket: s3Bucket,
                Key: filePath,
                Body: req.file.buffer,
                ContentType: req.file.mimetype
            }).promise();
            
            // Call Lambda function
            const lambda = new AWS.Lambda();
            const params = {
                FunctionName: lambdaFunction,
                InvocationType: 'RequestResponse',
                Payload: JSON.stringify({
                    userSub: req.userSub,
                    fileName: fileName,
                    fileType: req.file.mimetype,
                    username: req.username,
                    s3Bucket: s3Bucket
                })
            };
            
            console.log('Invoking Lambda function:', lambdaFunction);
            const lambdaResponse = await lambda.invoke(params).promise();
            console.log('Lambda response status:', lambdaResponse.StatusCode);
            
            // Parse the response payload
            let responsePayload;
            try {
                responsePayload = JSON.parse(lambdaResponse.Payload);
                console.log('Lambda response payload:', JSON.stringify(responsePayload, null, 2));
            } catch (parseError) {
                console.error('Error parsing Lambda response:', parseError);
                throw new Error('Invalid response from audio processor');
            }
            
            if (responsePayload.statusCode === 200) {
                console.log('Audio conversion successful');
                res.json({
                    message: 'Conversion successful',
                    metadata: responsePayload.body
                });
            } else {
                console.error('Lambda returned non-200 status code:', responsePayload.statusCode);
                throw new Error(responsePayload.body || 'Audio conversion failed');
            }
        } 
        // Otherwise, process the audio locally
        else {
            console.log('AWS services not configured. Processing audio locally...');
            
            // Convert MP3 to AudioBuffer
            console.log('Converting MP3 to AudioBuffer...');
            const audioBuffer = await mp3ToAudioBuffer(req.file.buffer);
            
            // Process the audio locally
            const result = await processAudioLocally(audioBuffer);
            
            if (result.success) {
                // For testing, we'll save the processed file to a local directory
                const fs = require('fs');
                const path = require('path');
                
                // Create a directory for processed files if it doesn't exist
                const processedDir = path.join(__dirname, 'processed-files');
                if (!fs.existsSync(processedDir)) {
                    fs.mkdirSync(processedDir, { recursive: true });
                }
                
                // Save the processed file
                const processedFilePath = path.join(processedDir, `processed-${fileName}`);
                fs.writeFileSync(processedFilePath, result.data);
                
                // Create a URL for the processed file
                const processedFileUrl = `/processed-files/processed-${fileName}`;
                
                // Serve the processed-files directory
                app.use('/processed-files', express.static(processedDir));
                
                res.json({
                    message: 'Conversion successful (local processing)',
                    metadata: {
                        originalName: req.file.originalname,
                        processedName: `processed-${fileName}`,
                        processedUrl: processedFileUrl,
                        fileSize: result.data.length
                    }
                });
            } else {
                throw new Error(result.error || 'Local audio processing failed');
            }
        }
    } catch (error) {
        console.error('Audio conversion error:', error);
        console.error('Error stack:', error.stack);
        
        // Provide more detailed error message to the client
        const errorMessage = error.message || 'Failed to convert audio file';
        res.status(500).json({ 
            error: 'Failed to convert audio file',
            details: errorMessage
        });
    }
});


app.get('/get-audio/:trackId', verifyCognitoToken, async (req, res) => {
    // console.log('Getting audio...');
    const { trackId } = req.params;
    const userSub = req.userSub;
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    const s3 = new AWS.S3();
    try {
        const client = await pool.connect();
        const result = await client.query(
            'SELECT s3_path, track_name FROM tracks WHERE track_id = $1 AND user_id = (SELECT user_id FROM users WHERE cognito_sub = $2)', 
            [trackId, userSub]
        );
        client.release();
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Track not found' });
        }
        const s3Key = result.rows[0].s3_path;
        const originalFilename = result.rows[0].track_name + '.mp3';
        const bucketName = process.env.S3_AUDIO_BUCKET
        const params = {
            Bucket: bucketName,
            Key: s3Key
        };
        // Get the file from S3
        const s3Object = await s3.getObject(params).promise();
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalFilename)}"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', s3Object.ContentLength);        
        // Send the file
        res.send(s3Object.Body);        
    } catch (error) {
        console.error('Error fetching track:', error);
        res.status(500).json({ error: 'Failed to download track' });
    } finally {
        await pool.end();
    }
});


// Route to serve the upload page
app.get('/upload', (req, res) => {
    // Read the upload.html file
    let uploadHtml = fs.readFileSync(path.join(__dirname, 'public', 'upload.html'), 'utf8');
    res.send(uploadHtml);
});


// ---------------------- Music Library Management ----------------------
app.get('/user-tracks/:offset', verifyCognitoToken, async (req, res) => {
    const { offset } = req.params;
    const userSub = req.userSub;
    if (userSub === 'non_user') {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    try {
        const result = await pool.query(
            `SELECT t.* FROM tracks t
            JOIN users u ON t.user_id = u.user_id
            WHERE u.cognito_sub = $1
            ORDER BY t.track_name ASC
            LIMIT 25 OFFSET $2`,
            [userSub, offset]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching user tracks:', error);
        res.status(500).json({ error: 'Failed to fetch user tracks' });
    } finally {
        await pool.end();
    }
});


app.get('/user-playlists', verifyCognitoToken, async (req, res) => {
    const userSub = req.userSub;
    if (userSub === 'non_user') {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    try {
        const result = await pool.query(
            'SELECT * FROM user_playlists WHERE user_sub = $1',
            [userSub]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching user playlists:', error);
        res.status(500).json({ error: 'Failed to fetch user playlists' });
    } finally {
        await pool.end();
    }
});


app.post('/new-playlist', verifyCognitoToken, async (req, res) => {
    const userSub = req.userSub;
    if (userSub === 'non_user') {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const { playlistName } = req.body;
    if (!playlistName) {
        return res.status(400).json({ error: 'Playlist name is required' });
    }
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000, 
        idleTimeoutMillis: 30000
    });
    try {
        const tmp = await pool.query(
            `SELECT 1 
            FROM playlists p
            JOIN users u 
            ON p.user_id = u.user_id
            WHERE u.cognito_sub = $1 
            AND p.playlist_name = $2`,
            [userSub, playlistName]
        );
        if (tmp.rows.length > 0) {
            return res.status(400).json({ error: 'Playlist already exists, try a different name' });
        }
        const result = await pool.query(
            `INSERT INTO playlists (user_id, playlist_name) 
            SELECT u.user_id, $2 
            FROM users u
            WHERE u.cognito_sub = $1
            RETURNING playlist_id, playlist_name`, 
            [userSub, playlistName]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating new playlist:', error);
        res.status(500).json({ error: 'Failed to create new playlist' });
    } finally {
        await pool.end();
    }
});


app.post('/add-to-playlist', verifyCognitoToken, async (req, res) => {
    const userSub = req.userSub;
    if (userSub === 'non_user') {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const { trackIds, playlistId } = req.body;
    if (!trackIds || !playlistId || !Array.isArray(trackIds) || trackIds.length === 0) {
        return res.status(400).json({ error: 'Track IDs array and playlist ID are required' });
    }
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    try {
        // Check if playlist belongs to user
        const playlistCheck = await pool.query(
            `SELECT 1 FROM playlists p
            JOIN users u ON p.user_id = u.user_id
            WHERE p.playlist_id = $1 AND u.cognito_sub = $2`,
            [playlistId, userSub]
        );
        if (playlistCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Playlist not found or access denied' });
        }
        // Verify all tracks belong to the user
        const tracksCheck = await pool.query(
            `SELECT COUNT(1) AS cnt
            FROM tracks t
            JOIN users u
            ON t.user_id = u.user_id
            WHERE track_id = ANY($1::int[]) 
            AND u.cognito_sub = $2`,
            [trackIds, userSub]
        );
        // console.log(tracksCheck.rows);
        // console.log(tracksCheck.rows[0].cnt);
        // console.log(trackIds.length);
        if (tracksCheck.rows[0].cnt != trackIds.length) {
            return res.status(403).json({ error: 'Some tracks do not belong to user' });
        }
        // Get current max position in playlist
        const maxPositionResult = await pool.query(
            `SELECT COALESCE(MAX(position), 0) as max_position 
            FROM playlist_tracks 
            WHERE playlist_id = $1`,
            [playlistId]
        );
        // Prepare batch insert with position increment
        const currentMaxPosition = maxPositionResult.rows[0].max_position;
        const placeholders = trackIds.map((_, i) => `($1, $${i*2 + 2}, $${i*2 + 3})`).join(',');
        try {
            const result = await pool.query(
                `INSERT INTO playlist_tracks (playlist_id, track_id, position)
                VALUES ${placeholders}
                ON CONFLICT DO NOTHING
                RETURNING playlist_id, track_id, position`,
                [playlistId, ...trackIds.flatMap((trackId, i) => [trackId, currentMaxPosition + i + 1])]
            );
            res.json({
                success: true,
                addedCount: result.rows.length,
                tracks: result.rows
            });
        } catch (error) {
            if (error.code === '23503') {
                return res.status(400).json({ error: 'One or more tracks do not exist' });
            }
            throw error;
        }
    } catch (error) {
        console.error('Error adding tracks to playlist:', error);
        res.status(500).json({ error: 'Failed to add tracks to playlist' });
    } finally {
        await pool.end();
    }
});


app.get('/playlist/:playlistId/:offset', verifyCognitoToken, async (req, res) => {
    const userSub = req.userSub;
    if (userSub === 'non_user') {
        return res.status(401).json({ error: 'Not logged in' });
    }
    const { playlistId } = req.params;
    if (!playlistId) {
        return res.status(400).json({ error: 'Playlist ID is required' });
    }
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    });
    try {
        // Check if playlist belongs to user
        const playlistCheck = await pool.query(
            `SELECT 1 FROM playlists p
            JOIN users u ON p.user_id = u.user_id
            WHERE p.playlist_id = $1 AND u.cognito_sub = $2`,
            [playlistId, userSub]
        );
        if (playlistCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Playlist not found or access denied' });
        }
        // get playlist tracks
        const result = await pool.query(
            `SELECT t.* 
            FROM playlist_tracks pt
            JOIN tracks t ON pt.track_id = t.track_id
            JOIN users u ON t.user_id = u.user_id
            WHERE pt.playlist_id = $1 AND u.cognito_sub = $2
            ORDER BY pt.position ASC`,
            [playlistId, userSub]
        );
        res.json({
            playlist: result.rows[0].playlist_id,
            tracks: result.rows
        });

    } catch (error) {
        console.error('Error fetching playlist:', error);
        res.status(500).json({ error: 'Failed to fetch playlist' });
    } finally {
        await pool.end();
    }
});

// route to dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
 });