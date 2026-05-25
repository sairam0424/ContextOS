import { Command } from 'commander';

export function completionCommand(program: Command): void {
  program
    .command('completion')
    .description('Generate shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell: string) => {
      const programName = 'context-os';
      switch (shell) {
        case 'bash':
          console.log(generateBashCompletion(programName, program));
          break;
        case 'zsh':
          console.log(generateZshCompletion(programName, program));
          break;
        case 'fish':
          console.log(generateFishCompletion(programName, program));
          break;
        default:
          console.error(`Unsupported shell: ${shell}. Use bash, zsh, or fish.`);
          process.exit(1);
      }
    });
}

function getCommandNames(program: Command): string[] {
  return program.commands.map(cmd => cmd.name());
}

function generateBashCompletion(name: string, program: Command): string {
  const commands = getCommandNames(program).join(' ');
  return `# ${name} bash completion
_${name}_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${commands}"
  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
}
complete -F _${name}_completion ${name}
# Add to ~/.bashrc: eval "$(${name} completion bash)"`;
}

function generateZshCompletion(name: string, program: Command): string {
  const commands = getCommandNames(program).map(c => `'${c}:${c} command'`).join('\n    ');
  return `#compdef ${name}
_${name}() {
  local -a commands
  commands=(
    ${commands}
  )
  _describe 'command' commands
}
compdef _${name} ${name}
# Add to ~/.zshrc: eval "$(${name} completion zsh)"`;
}

function generateFishCompletion(name: string, program: Command): string {
  const lines = getCommandNames(program).map(c => `complete -c ${name} -n '__fish_use_subcommand' -a '${c}' -d '${c} command'`).join('\n');
  return `# ${name} fish completion
${lines}
# Save to ~/.config/fish/completions/${name}.fish`;
}
