require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wardflow',
  sessionSecret: process.env.SESSION_SECRET || 'wardflow_dev_secret',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
  },
  app: {
    name: process.env.APP_NAME || 'WardFlow',
    url: process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:3000',
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  },
};
