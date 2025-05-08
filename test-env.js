// Test environment variables setup
process.env.DB_USER = 'test_user';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'test_db';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_PORT = '5432';
process.env.S3_ACCESS_POINT_ARN = 'test-bucket';
process.env.BUCKET = 'test-bucket';
process.env.AWS_REGION = 'us-west-2';
process.env.PORT = 3000;

// Add any other environment variables needed for testing
console.log('Test environment variables set up successfully');
