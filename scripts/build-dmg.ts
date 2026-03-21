import path from "node:path";
import { buildDmg } from "../src/runtime/build-dmg.js";

interface CliOptions {
  appPath: string;
  outputPath: string;
  clean: boolean;
}

function usage(exitCode = 2): never {
  console.error("Usage: node scripts/build-dmg.ts --app <path> [--output <path>] [--no-clean]");
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  let appPath = "";
  let outputPath = path.join(process.cwd(), "artifacts", "desktop", "MsgCode.dmg");
  let clean = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app") {
      const value = argv[index + 1];
      if (!value) usage();
      appPath = path.resolve(value);
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

  if (!appPath) usage();
  return { appPath, outputPath, clean };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await buildDmg(options);

  console.log("DMG ready:");
  console.log(`- app: ${result.appPath}`);
  console.log(`- dmg: ${result.outputPath}`);
  console.log(`- volume: ${result.volumeName}`);
  console.log(`- signing: ${result.signingStatus}`);
  console.log(`- notarization: ${result.notarizationStatus}`);
}

await main();
