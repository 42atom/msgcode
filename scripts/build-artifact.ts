import path from "node:path";
import { buildArtifact } from "../src/runtime/build-artifact.js";

interface CliOptions {
  outputRoot: string;
  clean: boolean;
}

function usage(exitCode = 2): never {
  console.error("Usage: node scripts/build-artifact.ts [--output <path>] [--no-clean]");
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  let outputRoot = path.join(process.cwd(), "artifacts", "desktop", "bundle-root");
  let clean = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) {
        usage();
      }
      outputRoot = path.resolve(value);
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

  return { outputRoot, clean };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildArtifact({
    projectRoot: process.cwd(),
    outputRoot: options.outputRoot,
    clean: options.clean,
  });

  console.log("Build artifact ready:");
  console.log(`- output: ${result.outputRoot}`);
  console.log(`- version: ${result.appVersion}`);
  console.log(`- cli entry: ${path.join(result.runtimeRoot, "dist", "cli.js")}`);
  console.log(`- daemon entry: ${path.join(result.runtimeRoot, "dist", "daemon.js")}`);
  console.log(`- runtime launcher: ${result.runtimeLauncher}`);
  console.log(`- bundle launcher: ${result.bundleLauncher}`);
  console.log(`- manifest: ${result.manifestPath}`);
  console.log(`- bootstrap: ${result.bootstrapDir}`);
}

await main();
