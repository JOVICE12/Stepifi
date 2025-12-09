const { spawn } = require("child_process");
const path = require("path");
const logger = require("../utils/logger");
const config = require("../config");

class ConverterService {
  constructor() {
    this.pythonScript = path.join(__dirname, "../scripts/convert.py");
    this.cmd = "/opt/conda/bin/freecadcmd";
  }

  async convert(jobId, inputPath, outputPath, options) {
    const tolerance = options.tolerance ?? config.conversion.defaultTolerance;
    const repair = options.repair !== false;

    // ✔ CORRECT FreeCAD 0.21 script invocation
    const args = [
      "-c",
      "--python", this.pythonScript,
      "--",
      inputPath,
      outputPath,
      `--tolerance=${tolerance}`,
      repair ? "--repair" : "--no-repair"
    ];

    logger.info("Running FreeCAD conversion", {
      cmd: this.cmd,
      args
    });

    return new Promise((resolve, reject) => {
      const child = spawn(this.cmd, args, { timeout: config.conversion.timeout });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => (stdout += data.toString()));
      child.stderr.on("data", (data) => (stderr += data.toString()));

      child.on("close", (code) => {
        if (code !== 0) {
          logger.error("Conversion failed", { code, stderr });
          return reject(new Error(stderr || "FreeCAD failed"));
        }

        logger.info("Conversion completed", { stdout });

        // FreeCAD prints banners; success = STEP file exists
        resolve({ stdout, stderr });
      });

      child.on("error", (err) => {
        logger.error("Failed to run FreeCAD", { err });
        reject(err);
      });
    });
  }
}

module.exports = new ConverterService();
