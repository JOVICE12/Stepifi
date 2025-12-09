const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const redisService = require('./redis.service');
const fileService = require('./file.service');

class CleanupService {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
  }

  start() {
    if (this.cronJob) {
      logger.warn('Cleanup service already running');
      return;
    }

    // Validate cron expression
    if (!cron.validate(config.jobs.cleanupCron)) {
      logger.error(`Invalid cron expression: ${config.jobs.cleanupCron}`);
      return;
    }

    this.cronJob = cron.schedule(config.jobs.cleanupCron, async () => {
      await this.runCleanup();
    });

    logger.info(`Cleanup service started with schedule: ${config.jobs.cleanupCron}`);

    // Run initial cleanup
    this.runCleanup();
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Cleanup service stopped');
    }
  }

  async runCleanup() {
    if (this.isRunning) {
      logger.debug('Cleanup already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    let stats = {
      jobsChecked: 0,
      jobsExpired: 0,
      filesRemoved: 0,
      errors: 0,
    };

    try {
      logger.info('Starting cleanup run');

      // Get all job keys from Redis
      const jobKeys = await redisService.getAllJobKeys();
      stats.jobsChecked = jobKeys.length;

      const validJobIds = [];

      // Check each job
      for (const key of jobKeys) {
        const jobId = key.replace('job:', '');
        
        try {
          const ttl = await redisService.getJobTTL(jobId);
          
          if (ttl <= 0) {
            // Job has expired or has no TTL
            const job = await redisService.getJob(jobId);
            
            // Delete associated files
            const { stlDeleted, stepDeleted } = await fileService.deleteJobFiles(jobId);
            if (stlDeleted) stats.filesRemoved++;
            if (stepDeleted) stats.filesRemoved++;
            
            // Delete the job from Redis (if it wasn't auto-expired)
            if (job) {
              await redisService.deleteJob(jobId);
            }
            
            stats.jobsExpired++;
            logger.debug(`Cleaned up expired job: ${jobId}`);
          } else {
            validJobIds.push(jobId);
          }
        } catch (err) {
          stats.errors++;
          logger.error(`Error cleaning up job ${jobId}:`, err);
        }
      }

      // Clean up orphaned files (files without corresponding jobs)
      const orphansCleaned = await fileService.cleanupOrphanedFiles(validJobIds);
      stats.filesRemoved += orphansCleaned;

      const duration = Date.now() - startTime;
      logger.info('Cleanup run completed', { ...stats, durationMs: duration });

    } catch (err) {
      logger.error('Cleanup run failed:', err);
      stats.errors++;
    } finally {
      this.isRunning = false;
    }

    return stats;
  }

  async getStats() {
    const jobKeys = await redisService.getAllJobKeys();
    const { uploads, converted } = await fileService.getOrphanedFiles();
    
    return {
      totalJobs: jobKeys.length,
      uploadFiles: uploads.length,
      convertedFiles: converted.length,
      cronSchedule: config.jobs.cleanupCron,
      isRunning: this.isRunning,
    };
  }
}

module.exports = new CleanupService();
