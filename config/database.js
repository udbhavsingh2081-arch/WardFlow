const mongoose = require('mongoose');
const env = require('./environment');

const connectDB = async () => {
  const uri = env.mongoUri;

  if (!uri) {
    console.error('[DATABASE CRITICAL] MONGODB_URI environment variable is missing.');
    console.error('Set MONGODB_URI in your hosting dashboard (e.g. mongodb+srv://<user>:<password>@cluster.mongodb.net/wardflow).');
    process.exit(1);
  }

  if (env.nodeEnv === 'production' && (uri.includes('localhost') || uri.includes('127.0.0.1'))) {
    console.warn('[DATABASE WARNING] MONGODB_URI is pointing to localhost in production mode. If your database is hosted remotely (e.g. MongoDB Atlas), make sure to configure the correct remote URI.');
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error('[DATABASE ERROR] Failed to connect to MongoDB:', err.message);
    if (err.message.includes('bad auth') || err.message.includes('Authentication failed')) {
      console.error('[DATABASE DIAGNOSTIC] Authentication failed. Please verify your MongoDB database username and password in MONGODB_URI.');
    } else if (err.message.includes('ETIMEDOUT') || err.message.includes('querySrv ETIMEOUT') || err.message.includes('whitelist')) {
      console.error('[DATABASE DIAGNOSTIC] Network timeout. Check your MongoDB Atlas Network Access IP Whitelist (allow 0.0.0.0/0 for cloud hosts).');
    }
    process.exit(1);
  }
};

module.exports = connectDB;
