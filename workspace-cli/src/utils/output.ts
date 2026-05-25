import chalk from 'chalk';

export interface OutputOptions {
  json: boolean;
  verbose: boolean;
}

export function getOutputOpts(program: any): OutputOptions {
  const opts = program.opts();
  return { json: opts.json ?? false, verbose: opts.verbose ?? false };
}

export function output(data: unknown, opts: OutputOptions): void {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(data);
  }
}

export function verbose(message: string, opts: OutputOptions): void {
  if (opts.verbose) {
    console.log(chalk.dim(`[verbose] ${message}`));
  }
}
