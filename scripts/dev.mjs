import { spawn } from 'node:child_process';

const processes = [
  spawn('npm', ['--prefix', 'server', 'run', 'dev'], {
    stdio: 'inherit',
    shell: true,
  }),
  spawn('npm', ['--prefix', 'client', 'run', 'dev'], {
    stdio: 'inherit',
    shell: true,
  }),
];

const shutdown = () => {
  for (const proc of processes) {
    proc.kill();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const proc of processes) {
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      shutdown();
    }
  });
}
