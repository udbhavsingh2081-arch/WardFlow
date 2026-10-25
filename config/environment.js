require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  trustProxy: process.env.TRUST_PROXY !== undefined
    ? (process.env.TRUST_PROXY === 'true' ? true : (!isNaN(Number(process.env.TRUST_PROXY)) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY))
    : (process.env.NODE_ENV === 'production' ? 1 : false),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wardflow',
  sessionSecret: process.env.SESSION_SECRET || 'wardflow_dev_secret',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
  runEscalationWorker: process.env.RUN_ESCALATION_WORKER !== 'false',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseURL: process.env.OPENAI_BASE_URL || '',
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
