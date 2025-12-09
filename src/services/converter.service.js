const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const logger = require('../utils/logger');

const FREECAD = '/opt/conda/bin/freecadcmd';

// Required environment for FreeCAD headless operation
const FREECAD_ENV = {
  ...process.env,
  QT_QPA_PLATFORM: 'offscreen',
  XDG_RUNTIME_DIR: '/tmp/runtime',
  CONDA_PREFIX: '/opt/conda',
  LD_LIBRARY_PATH: '/opt/conda/lib'
};

class ConverterService {
  constructor() {
    this.pythonScript = path.join(config.paths.pythonScripts, 'convert.py');
  }

  /**
   * Convert STL → STEP
   */
  async convert(inputPath, outputPath, options = {}) {
    const tolerance = options.tolerance || config.conversion.defaultTolerance;
    const repair = options.repair !== false && config.conversion.repairMesh;

    // Validate input
    try {
      await fs.access(inputPath);
    } catch {
      return { success: false, error: 'Input file not found' };
    }

    // Build correct FreeCAD argument list
    const args = [
      this.pythonScript,
      "--",                            // ← REQUIRED so FreeCAD stops parsing
      inputPath,
      outputPath,
      `--tolerance=${tolerance}`,
      repair ? "--repair" : "--no-repair"
    ];

    logger.info("Running FreeCAD conversion", {
      cmd: FREECAD,
      args
    });

    return new Promise((resolve) => {
      const proc = spawn(FREECAD, args, {
        timeout: config.conversion.timeout,
        env: FREECAD_ENV
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());

      proc.on("close", (code) => {
        // Success
        if (code === 0) {
          try {
            // convert.py prints JSON as last line
            const lines = stdout.trim().split("\n");
            const json = JSON.parse(lines[lines.length - 1]);
            resolve(json);
          } catch (err) {
            logger.error("Failed to parse conversion output", { stdout, stderr });
            resolve({
              success: false,
              error: "Failed to parse conversion result",
              stdout,
              stderr
            });
          }
          return;
        }

        // Error
        logger.error("Conversion failed", { code, stderr });
        resolve({
          success: false,
          error: stderr.trim() || "Conversion failed",
          code,
          stderr
        });
      });

      proc.on("error", (err) => {
        logger.error("Failed to spawn FreeCAD", { error: err.message });
        resolve({
          success: false,
          error: err.code === "ENOENT" ? "FreeCAD not found" : err.message
        });
      });
    });
  }

  /**
   * Extract mesh info
   */
  async getMeshInfo(inputPath) {
    const args = [
      this.pythonScript,
      "--",
      inputPath,
      "/dev/null",
      "--info"
    ];

    return new Promise((resolve) => {
      const proc = spawn(FREECAD, args, {
        timeout: 30000,
        env: FREECAD_ENV
      });

      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const lines = stdout.trim().split("\n");
            resolve(JSON.parse(lines[lines.length - 1]));
          } catch {
            resolve({ success: false, error: "Failed to parse mesh info" });
          }
        } else {
          resolve({ success: false, error: "Mesh info command failed" });
        }
      });

      proc.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }


  /**
   * Check FreeCAD availability
   */
  async checkFreecad() {
    return new Promise((resolve) => {
      const proc = spawn(FREECAD, ["--version"], {
        timeout: 10000,
        env: FREECAD_ENV
      });

      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());

      proc.on("close", (code) => {
        resolve({
          available: code === 0,
          version: stdout.trim() || null
        });
      });

      proc.on("error", () => {
        resolve({ available: false });
      });
    });
  }
}

module.exports = new ConverterService();
