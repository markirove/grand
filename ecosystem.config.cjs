/*
  Both apps are started through their real binaries rather than `npm start`.

  npm would sit between pm2 and the process as an extra shell, and pm2's stop
  and restart signals would land on npm instead of the app. The bot cares: it
  traps SIGTERM to close the room server and its sockets before exiting, and
  that handler never runs if the signal stops at a wrapper.
*/
const BASE = __dirname

module.exports = {
  apps: [
    {
      name: 'playeon-bot',
      cwd: `${BASE}/playeon-bot`,
      // cwd matters twice over: `--env-file` resolves against it, and mtcute
      // writes `playeon-session` there - the logged-in account lives in it.
      script: 'node_modules/.bin/tsx',
      args: '--env-file=.env src/index.ts',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Telegram floods and a cold yt-dlp run both take a while; don't let pm2
      // call a slow boot a failed one.
      min_uptime: 30000,
      kill_timeout: 10000,
      merge_logs: true,
      time: true,
      out_file: `${BASE}/logs/bot-out.log`,
      error_file: `${BASE}/logs/bot-err.log`,
    },
    {
      name: 'playeon-web',
      cwd: `${BASE}/playeon-web`,
      script: 'node_modules/.bin/next',
      args: 'start -p 3006',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      min_uptime: 15000,
      kill_timeout: 10000,
      merge_logs: true,
      time: true,
      out_file: `${BASE}/logs/web-out.log`,
      error_file: `${BASE}/logs/web-err.log`,
    },
  ],
}
