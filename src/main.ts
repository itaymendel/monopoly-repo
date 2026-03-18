import { parseArgs } from "./args";
import { validate } from "./validate";
import { executeMove } from "./move";
import {
  printHelp,
  printVersion,
  printSuccess,
  printDryRun,
  printError,
} from "./output";

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.kind === "help") {
      printHelp();
      return;
    }

    if (args.kind === "version") {
      printVersion();
      return;
    }

    // args.kind === "move"
    const ctx = validate(args);

    if (args.dryRun) {
      printDryRun(args, ctx);
      return;
    }

    const result = executeMove(args, ctx);
    printSuccess(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg);
    process.exit(1);
  }
}

main();
