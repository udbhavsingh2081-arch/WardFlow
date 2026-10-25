const Counter = require('../models/Counter');

/**
 * Generates a concurrency-safe ticket number like WF-2026-00125
 */
const generateTicketNumber = async (hospitalId) => {
  const year = new Date().getFullYear();
  const key = `ticket_${hospitalId}_${year}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const padded = String(counter.seq).padStart(5, '0');
  return `WF-${year}-${padded}`;
};

module.exports = { generateTicketNumber };
