/**
 * `output: "standalone"` emits a self-contained server at `.next/standalone`
 * but deliberately leaves client assets out of it. Without this copy the
 * server renders HTML while every `/_next/static/...` request (CSS, JS, fonts)
 * returns 404 — the page looks unstyled.
 *
 * Run automatically via the `postbuild` script and again before `npm start`.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

function copyInto(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  return true;
}

function prepareStandalone() {
  if (!fs.existsSync(path.join(standalone, "server.js"))) {
    throw new Error("Standalone build not found. Run `npm run build` first.");
  }

  const copied = [];
  if (copyInto(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"))) {
    copied.push(".next/static");
  }
  if (copyInto(path.join(root, "public"), path.join(standalone, "public"))) {
    copied.push("public");
  }

  console.log(
    copied.length > 0
      ? `Prepared standalone assets: ${copied.join(", ")}`
      : "Standalone assets already in place",
  );
}

if (require.main === module) {
  prepareStandalone();
}

module.exports = { prepareStandalone };
