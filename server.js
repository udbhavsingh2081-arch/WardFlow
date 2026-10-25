require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/database');
const env = require('./config/environment');
const escalationWorker = require('./jobs/escalationWorker');

let server = null;

const startServer = async () => {
  await connectDB();

  // Start in-process escalation worker if enabled
  if (env.runEscalationWorker) {
    escalationWorker.start();
  } else {
    console.log('[Escalation Worker] In-process worker disabled (RUN_ESCALATION_WORKER=false)');
  }

  server = app.listen(env.port, env.host, () => {
    console.log(`WardFlow running on ${env.host}:${env.port}`);
  });

  return server;
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n[Server] ${signal} signal received: closing HTTP server...`);
  if (escalationWorker) {
    escalationWorker.stop();
  }

  if (server) {
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      try {
        await mongoose.connection.close(false);
        console.log('[Server] MongoDB connection closed.');
        process.exit(0);
      } catch (err) {
        console.error('[Server] Error while closing MongoDB connection:', err.message);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { startServer, app };
