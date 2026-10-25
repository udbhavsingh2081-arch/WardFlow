const cron = require('node-cron');
const escalationService = require('../services/escalationService');

let task = null;

exports.start = () => {
  if (task) {
    console.log('[Escalation Worker] Already running, skipping duplicate start');
    return;
  }

  task = cron.schedule('*/15 * * * *', async () => {
    try {
      await escalationService.runEscalationCheck();
    } catch (err) {
      console.error('[Escalation Worker] Job execution error:', err.message);
    }
  }, { scheduled: true, timezone: process.env.TIMEZONE || 'Asia/Kolkata' });

  console.log('[Escalation Worker] Started — running every 15 minutes');
};

exports.stop = () => {
  if (task) {
    task.stop();
    task = null;
    console.log('[Escalation Worker] Stopped');
  }
};

if (require.main === module) {
  require('dotenv').config();
  const connectDB = require('../config/database');

  console.log('[Escalation Worker] Initializing standalone worker process...');
  connectDB().then(() => {
    exports.start();
    escalationService.runEscalationCheck().catch(err => {
      console.error('[Escalation Worker] Initial check error:', err.message);
    });
  }).catch(err => {
    console.error('[Escalation Worker] Database connection failed:', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    console.log('[Escalation Worker] SIGTERM received, stopping worker...');
    exports.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[Escalation Worker] SIGINT received, stopping worker...');
    exports.stop();
    process.exit(0);
  });
}
