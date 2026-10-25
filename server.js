require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/database');
const env = require('./config/environment');

// Start escalation worker
const escalationWorker = require('./jobs/escalationWorker');

const startServer = async () => {
  await connectDB();
  escalationWorker.start();
  app.listen(env.port, () => {
    console.log(`WardFlow running at http://localhost:${env.port} [${env.nodeEnv}]`);
  });
};

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
