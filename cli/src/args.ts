import path from "path";

export interface HelpArgs {
  kind: "help";
}

export interface VersionArgs {
  kind: "version";
}

export interface MoveArgs {
  kind: "move";
  source: string;
  to: string;
  as: string;
  dryRun: boolean;
}

export type ParsedArgs = HelpArgs | VersionArgs | MoveArgs;

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    return { kind: "help" };
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    return { kind: "version" };
  }

  const command = argv[0];
  if (command !== "move") {
    throw usageError(`Unknown command: ${command}.`);
  }

  const rest = argv.slice(1);
  let source: string | undefined;
  let to: string | undefined;
  let as: string | undefined;
  let dryRun = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--to") {
      to = takeValue("--to", rest, ++i);
    } else if (arg === "--as") {
      as = takeValue("--as", rest, ++i);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("-")) {
      throw usageError(`Unknown option: ${arg}.`);
    } else if (!source) {
      source = arg;
    } else {
      throw usageError(`Unexpected argument: ${arg}.`);
    }
  }

  if (!source) throw usageError("Missing <source> argument.");
  if (!to) throw usageError("Missing --to <repo> option.");

  return {
    kind: "move",
    source,
    to,
    as: as ?? path.basename(source),
    dryRun,
  };
}

function usageError(msg: string): Error {
  return new Error(`${msg} Run monopoly --help for usage.`);
}

function takeValue(name: string, rest: string[], i: number): string {
  const value = rest[i];
  if (!value) throw usageError(`${name} requires a value.`);
  return value;
}
