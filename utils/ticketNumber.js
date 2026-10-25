const Counter = require('../models/Counter');

const generateTicketNumber = async (hospitalId) => {
  const year = new Date().getFullYear();
  const key = `ticket_${hospitalId}_${year}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const padded = String(counter.seq).padStart(5, '0');
  return `WF-${year}-${padded}`;
};

module.exports = { generateTicketNumber };
