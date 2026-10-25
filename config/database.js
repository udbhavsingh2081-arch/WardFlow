const mongoose = require('mongoose');
const dns = require('dns');
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
    // If local/ISP DNS fails to resolve SRV record, retry with public DNS
    if (err.message && (err.message.includes('querySrv ECONNREFUSED') || err.message.includes('querySrv ENOTFOUND'))) {
      try {
        console.warn('[DATABASE NOTICE] Local DNS failed on SRV query; retrying with public DNS (8.8.8.8, 1.1.1.1)...');
        dns.setServers(['8.8.8.8', '1.1.1.1']);
        const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
        console.log(`MongoDB connected: ${conn.connection.host}`);
        return conn;
      } catch (retryErr) {
        err = retryErr;
      }
    }

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
