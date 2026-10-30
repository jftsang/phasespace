#!/usr/bin/env node
// Runs the Parcel production build.
// If PUBLIC_URL is set, it is used as the app's public path
// (e.g. /phasespace for a GitHub Pages project site). Leave it unset when
// the app is served from the domain root and no flag is added.
const { spawnSync } = require("node:child_process");

const args = ["parcel", "build", "--no-scope-hoist"];

if (process.env.PUBLIC_URL) {
  args.push("--public-url", process.env.PUBLIC_URL);
}

const result = spawnSync(args[0], args.slice(1), {
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
