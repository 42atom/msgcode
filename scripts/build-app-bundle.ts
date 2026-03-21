import path from "node:path";
import { buildAppBundle } from "../src/runtime/build-app-bundle.js";

interface CliOptions {
  bundleRoot: string;
  outputPath: string;
  clean: boolean;
}

function usage(exitCode = 2): never {
  console.error("Usage: node scripts/build-app-bundle.ts --bundle-root <path> [--output <path>] [--no-clean]");
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  let bundleRoot = "";
  let outputPath = path.join(process.cwd(), "artifacts", "desktop", "MsgCode.app");
  let clean = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle-root") {
      const value = argv[index + 1];
      if (!value) usage();
      bundleRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) usage();
      outputPath = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--no-clean") {
      clean = false;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage(0);
    }
    usage();
  }

  if (!bundleRoot) usage();
  return { bundleRoot, outputPath, clean };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildAppBundle(options);

  console.log("App bundle ready:");
  console.log(`- app: ${result.appPath}`);
  console.log(`- version: ${result.appVersion}`);
  console.log(`- launcher: ${result.launcherPath}`);
  console.log(`- embedded bundle-root: ${result.embeddedBundleRoot}`);
  console.log(`- plist: ${result.plistPath}`);
}

await main();
