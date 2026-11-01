/**
 * Start the standalone Next server with a stable data directory.
 *
 * `output: "standalone"` generates `.next/standalone/server.js`, which chdirs
 * into `.next/standalone`. Without an explicit RELIA_DATA_DIR the SQLite file
 * would be created inside the build output and discarded on the next build.
 * Anchor it to the project's data/ directory instead (still overridable for
 * hosts that mount a volume elsewhere).
 */
const path = require("node:path");
const { spawn } = require("node:child_process");
const { prepareStandalone } = require("./prepare-standalone.cjs");

const root = path.resolve(__dirname, "..");
prepareStandalone();

if (!process.env.RELIA_DATA_DIR) {
  process.env.RELIA_DATA_DIR = path.join(root, "data");
}

const child = spawn(process.execPath, [path.join(root, ".next", "standalone", "server.js")], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
