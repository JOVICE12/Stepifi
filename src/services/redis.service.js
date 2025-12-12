const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
  }

  connect() {
    if (this.client) {
      return this.client;
    }

    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryDelayOnFailover: 100,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      logger.info('Redis connected');
    });

    this.client.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    return this.client;
  }

  getClient() {
    if (!this.client) {
      return this.connect();
    }
    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      logger.info('Redis disconnected');
    }
  }

  // Job management methods
  async setJob(jobId, data, ttlSeconds) {
    const client = this.getClient();
    const key = `job:${jobId}`;
    await client.setex(key, ttlSeconds, JSON.stringify(data));
  }

  async getJob(jobId) {
    const client = this.getClient();
    const key = `job:${jobId}`;
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async getAllJobs() {
    const client = this.getClient();
    // Get all keys matching job:*
    const keys = await client.keys('job:*');

    if (keys.length === 0) {
      return [];
    }

    // Get all job data
    const jobs = [];
    for (const key of keys) {
      const data = await client.get(key);
      if (data) {
        const job = JSON.parse(data);
        // Get TTL for each job
        const ttl = await client.ttl(key);
        job.expiresIn = ttl > 0 ? ttl : 0;
        jobs.push(job);
      }
    }

    // Sort by creation date, newest first
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jobs;
  }

  async updateJob(jobId, updates) {
    const client = this.getClient();
    const key = `job:${jobId}`;

    const existing = await this.getJob(jobId);
    if (!existing) {
      throw new Error(`Job ${jobId} not found`);
    }

    const ttl = await client.ttl(key);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };

    if (ttl > 0) {
      await client.setex(key, ttl, JSON.stringify(updated));
    } else {
      await client.set(key, JSON.stringify(updated));
    }

    return updated;
  }

  async updateJobStatus(jobId, status, progress, error = null) {
    const updates = {
      status,
      progress,
      updatedAt: new Date().toISOString()
    };
    
    if (error) {
      updates.error = error;
    }
    
    if (status === 'failed' && error) {
      updates.message = error;
    }
    
    return this.updateJob(jobId, updates);
  }

  async deleteJob(jobId) {
    const client = this.getClient();
    const key = `job:${jobId}`;
    await client.del(key);
  }

  async getJobTTL(jobId) {
    const client = this.getClient();
    const key = `job:${jobId}`;
    return client.ttl(key);
  }

  async getAllJobKeys() {
    const client = this.getClient();
    return client.keys('job:*');
  }

  async healthCheck() {
    try {
      const client = this.getClient();
      await client.ping();
      return true;
    } catch (err) {
      logger.error('Redis health check failed:', err);
      return false;
    }
  }
}

module.exports = new RedisService();