const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const logger = require('../utils/logger');

// FreeCAD headless binary
const FREECAD = '/opt/conda/bin/freecadcmd';

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

  extractJson(stdout) {
    // Find the last JSON block inside messy stdout
    const matches = stdout.match(/\{[\s\S]*\}$/gm);
    if (!matches) return null;

    const last = matches[matches.length - 1];
    try {
      return JSON.parse(last);
    } catch {
      return null;
    }
  }

  async convert(inputPath, outputPath, options = {}) {
    const tolerance = options.tolerance || config.conversion.defaultTolerance;
    const repair = options.repair !== false;

    try {
      await fs.access(inputPath);
    } catch {
      return { success: false, error: 'Input file not found' };
    }

    return new Promise((resolve) => {
      const pythonArgv = JSON.stringify([
        this.pythonScript,
        inputPath,
        outputPath,
        `--tolerance=${tolerance}`,
        repair ? "--repair" : "--no-repair"
      ]);

      const code = `
import sys
sys.argv = ${pythonArgv}
exec(open("${this.pythonScript}").read())
`;

      const args = ['-c', code];

      logger.debug("Running FreeCAD conversion", { cmd: FREECAD, args });

      const proc = spawn(FREECAD, args, {
        env: FREECAD_ENV,
        timeout: config.conversion.timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => stdout += d.toString());
      proc.stderr.on('data', (d) => stderr += d.toString());

      proc.on('close', () => {
        const parsed = this.extractJson(stdout);

        if (parsed) {
          resolve(parsed);
        } else {
          logger.error("Failed parsing JSON output", { stdout, stderr });
          resolve({
            success: false,
            error: "Failed to parse JSON output from FreeCAD",
            stdout,
            stderr
          });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  async getMeshInfo(inputPath) {
    return new Promise((resolve) => {
      const pythonArgv = JSON.stringify([
        this.pythonScript,
        inputPath,
        "/dev/null",
        "--info"
      ]);

      const code = `
import sys
sys.argv = ${pythonArgv}
exec(open("${this.pythonScript}").read())
`;

      const proc = spawn(FREECAD, ['-c', code], {
        env: FREECAD_ENV,
        timeout: 30000
      });

      let stdout = '';
      proc.stdout.on('data', (d) => stdout += d.toString());

      proc.on('close', () => {
        const parsed = this.extractJson(stdout);
        resolve(parsed || { success: false, error: "Failed to parse mesh info" });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  async checkFreecad() {
    return new Promise((resolve) => {
      const proc = spawn(FREECAD, ['--version'], {
        env: FREECAD_ENV,
        timeout: 5000
      });

      let stdout = '';
      proc.stdout.on('data', (d) => stdout += d.toString());

      proc.on('close', (code) => {
        resolve({
          available: code === 0,
          version: stdout.trim()
        });
      });

      proc.on('error', () => resolve({ available: false }));
    });
  }
}

module.exports = new ConverterService();
