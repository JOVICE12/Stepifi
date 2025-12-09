const express = require('express');
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

app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, error: 'Too many requests, try later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Static folder
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', conversionRoutes);

// HealthCheck
app.get('/health', async (req, res) => {
  const redisHealthy = await redisService.healthCheck();
  const freecadCheck = await converterService.checkFreecad();

  res.json({
    status: redisHealthy && freecadCheck.available ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisHealthy ? 'connected' : 'disconnected',
      freecad: freecadCheck.available ? 'available' : 'not found',
      freecadVersion: freecadCheck.version || null,
    }
  });
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const cleanupStats = await cleanupService.getStats();
    res.json({ success: true, stats: cleanupStats });
  } catch (err) {
    logger.error('Stats error:', err);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// SPA support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});


/* ---------------------------------------------------
   START SERVER
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
      serverAdapter,
    });

    const bullBoardApp = express();
    bullBoardApp.use('/admin/queues', serverAdapter.getRouter());

    cleanupService.start();

    const fc = await converterService.checkFreecad();
    if (!fc.available) logger.warn('FreeCAD missing');

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });

    bullBoardApp.listen(config.bullBoardPort, () => {
      logger.info(`Bull Board running on port ${config.bullBoardPort}`);
    });

    const shutdown = async (sig) => {
      logger.info(`Shutting down (${sig})`);
      cleanupService.stop();
      await queueService.close();
      await redisService.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('Startup error:', err);
    process.exit(1);
  }
}

start();
