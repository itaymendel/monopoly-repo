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
    throw new Error(`Unknown command: ${command}. Run monopoly --help for usage.`);
  }

  const rest = argv.slice(1);
  let source: string | undefined;
  let to: string | undefined;
  let as: string | undefined;
  let dryRun = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--to") {
      to = rest[++i];
      if (!to) throw new Error("--to requires a value.");
    } else if (arg === "--as") {
      as = rest[++i];
      if (!as) throw new Error("--as requires a value.");
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}. Run monopoly --help for usage.`);
    } else if (!source) {
      source = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}. Run monopoly --help for usage.`);
    }
  }

  if (!source) {
    throw new Error("Missing <source> argument. Run monopoly --help for usage.");
  }
  if (!to) {
    throw new Error("Missing --to <repo> option. Run monopoly --help for usage.");
  }

  return {
    kind: "move",
    source,
    to,
    as: as ?? path.basename(source),
    dryRun,
  };
}
