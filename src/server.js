const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const config = require('./config');
const logger = require('./utils/logger');
const redisService = require('./services/redis.service');
const queueService = require('./services/queue.service');
const fileService = require('./services/file.service');
const cleanupService = require('./services/cleanup.service');
const converterService = require('./services/converter.service');
const conversionRoutes = require('./routes/conversion.routes');

const app = express();

/* ---------------------------------------------------
   🔥 FIXED CSP — Helmet defaults DISABLED
---------------------------------------------------- */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,   // TURN OFF Helmet's injected defaults
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
          "https://cdn.jsdelivr.net/npm",
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdnjs.cloudflare.com",
          "https://fonts.googleapis.com"
        ],

        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com"
        ],

        imgSrc: ["'self'", "blob:", "data:"],

        connectSrc: ["'self'"],

        workerSrc: ["'self'", "blob:"],

        objectSrc: ["'none'"],
        frameSrc: ["'self'"],
      },
    }
  })
);

/* ---------------------------------------------------
   CORE APP
---------------------------------------------------- */
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', conversionRoutes);

// Health endpoint
app.get('/health', async (req, res) => {
  const redisHealthy = await redisService.healthCheck();
  const freecadCheck = await converterService.checkFreecad();
  
  const healthy = redisHealthy && freecadCheck.available;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisHealthy ? 'connected' : 'disconnected',
      freecad: freecadCheck.available ? 'available' : 'not found',
      freecadVersion: freecadCheck.version || null
    },
    config: {
      maxFileSize: `${Math.round(config.upload.maxFileSize / 1024 / 1024)}MB`,
      jobTTL: `${config.jobs.ttlHours} hours`,
      defaultTolerance: config.conversion.defaultTolerance
    }
  });
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const cleanupStats = await cleanupService.getStats();
    res.json({ success: true, stats: cleanupStats });
  } catch (err) {
    logger.error('Stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

/* ---------------------------------------------------
   SERVER STARTUP
---------------------------------------------------- */
async function start() {
  try {
    await fileService.ensureDirectories();

    redisService.connect();
    const queue = queueService.initialize();

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [new BullMQAdapter(queue)],
      serverAdapter
    });

    const bullBoardApp = express();
    bullBoardApp.use('/admin/queues', serverAdapter.getRouter());

    cleanupService.start();

    const freecadCheck = await converterService.checkFreecad();
    if (!freecadCheck.available) {
      logger.warn('FreeCAD (freecadcmd) not found!');
    }

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });

    bullBoardApp.listen(config.bullBoardPort, () => {
      logger.info(`Bull Board on port ${config.bullBoardPort}/admin/queues`);
    });

    const shutdown = async (sig) => {
      logger.info(`Received ${sig}, shutting down...`);
      cleanupService.stop();
      await queueService.close();
      await redisService.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('Startup failure:', err);
    process.exit(1);
  }
}

start();
