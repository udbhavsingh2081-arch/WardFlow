const cron = require('node-cron');
const escalationService = require('../services/escalationService');

let task = null;

exports.start = () => {
  // Run every 15 minutes
  task = cron.schedule('*/15 * * * *', async () => {
    await escalationService.runEscalationCheck();
  }, { scheduled: true, timezone: process.env.TIMEZONE || 'Asia/Kolkata' });

  console.log('[Escalation Worker] Started — running every 15 minutes');
};

exports.stop = () => {
  if (task) task.stop();
};
