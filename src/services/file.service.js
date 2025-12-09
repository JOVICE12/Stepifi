const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class FileService {
  constructor() {
    this.uploadsDir = config.paths.uploads;
    this.convertedDir = config.paths.converted;
  }

  async ensureDirectories() {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    await fs.mkdir(this.convertedDir, { recursive: true });
    await fs.mkdir(config.paths.logs, { recursive: true });
    logger.info('Directories ensured');
  }

  getUploadPath(filename) {
    return path.join(this.uploadsDir, filename);
  }

  getConvertedPath(filename) {
    return path.join(this.convertedDir, filename);
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return null;
    }
  }

  async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
      logger.debug(`Deleted file: ${filePath}`);
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to delete file: ${filePath}`, { error: err.message });
      }
      return false;
    }
  }

  async deleteJobFiles(jobId) {
    const stlPath = this.getUploadPath(`${jobId}.stl`);
    const stepPath = this.getConvertedPath(`${jobId}.step`);
    
    const results = await Promise.all([
      this.deleteFile(stlPath),
      this.deleteFile(stepPath),
    ]);
    
    return {
      stlDeleted: results[0],
      stepDeleted: results[1],
    };
  }

  async listUploads() {
    try {
      const files = await fs.readdir(this.uploadsDir);
      return files.filter(f => f.endsWith('.stl'));
    } catch {
      return [];
    }
  }

  async listConverted() {
    try {
      const files = await fs.readdir(this.convertedDir);
      return files.filter(f => f.endsWith('.step'));
    } catch {
      return [];
    }
  }

  async getOrphanedFiles() {
    const [uploads, converted] = await Promise.all([
      this.listUploads(),
      this.listConverted(),
    ]);
    
    // Get job IDs from filenames
    const uploadIds = new Set(uploads.map(f => path.basename(f, '.stl')));
    const convertedIds = new Set(converted.map(f => path.basename(f, '.step')));
    
    return {
      uploads: uploads,
      converted: converted,
      uploadIds: Array.from(uploadIds),
      convertedIds: Array.from(convertedIds),
    };
  }

  async cleanupOrphanedFiles(validJobIds) {
    const validSet = new Set(validJobIds);
    const { uploads, converted } = await this.getOrphanedFiles();
    let cleaned = 0;
    
    for (const file of uploads) {
      const jobId = path.basename(file, '.stl');
      if (!validSet.has(jobId)) {
        await this.deleteFile(path.join(this.uploadsDir, file));
        cleaned++;
      }
    }
    
    for (const file of converted) {
      const jobId = path.basename(file, '.step');
      if (!validSet.has(jobId)) {
        await this.deleteFile(path.join(this.convertedDir, file));
        cleaned++;
      }
    }
    
    return cleaned;
  }

  validateFilename(filename) {
    // Basic security check - prevent path traversal
    const normalized = path.normalize(filename);
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      return false;
    }
    return true;
  }

  sanitizeFilename(filename) {
    // Remove dangerous characters
    return filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .substring(0, 255);
  }
}

module.exports = new FileService();
