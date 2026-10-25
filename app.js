require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const mongoose = require('mongoose');
const env = require('./config/environment');

const app = express();

if (env.trustProxy) {
  app.set('trust proxy', env.trustProxy);
}

app.get(['/health', '/api/health'], (req, res) => {
  const dbState = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const isHealthy = dbState === 1;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: states[dbState] || 'unknown',
  });
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
    },
  },
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many login attempts. Please try again later.' });
const apiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60 });
const aiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 10 });

app.use('/auth/login', loginLimiter);
app.use('/api/ai', aiLimiter);
app.use('/api/', apiLimiter);

if (env.nodeEnv !== 'test') app.use(morgan('dev'));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: env.mongoUri, touchAfter: 24 * 3600 }),
  cookie: {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    maxAge: env.sessionMaxAge,
    sameSite: 'lax',
  },
  name: 'wf.sid',
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.appName = env.app.name;
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  next();
});

const authRoutes = require('./routes/authRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const adminRoutes = require('./routes/adminRoutes');
const aiRoutes = require('./routes/aiRoutes');
const reportRoutes = require('./routes/reportRoutes');
const qrRoutes = require('./routes/qrRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

app.use('/auth', authRoutes);
app.use('/tickets', ticketRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/qr', qrRoutes);
app.use('/analytics', analyticsRoutes);

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).render('errors/500', { title: 'Server Error', message: env.nodeEnv === 'development' ? err.message : 'An unexpected error occurred.' });
});

if (require.main === module) {
  const connectDB = require('./config/database');
  const escalationWorker = require('./jobs/escalationWorker');
  connectDB().then(() => {
    if (env.runEscalationWorker) escalationWorker.start();
    app.listen(env.port, env.host, () => {
      console.log(`WardFlow running on ${env.host}:${env.port}`);
    });
  }).catch(err => {
    console.error('Failed to start server from app.js:', err);
    process.exit(1);
  });
}

module.exports = app;
