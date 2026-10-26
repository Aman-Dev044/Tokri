/**
 * PM2 process file — runs the built API and web app.
 *
 *   pnpm install && pnpm build        (build FIRST; the web app bakes
 *                                       NEXT_PUBLIC_* in at build time)
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup           (survive a reboot)
 *
 * Secrets and URLs stay in apps/api/.env and apps/web/.env.local. Only the
 * ports and NODE_ENV live here, and the API's PORT must match its .env.
 */
module.exports = {
  apps: [
    {
      name: 'tokri-api',
      cwd: './apps/api',
      // Nest builds to dist/main.js, not dist/src/main.js.
      script: 'dist/main.js',
      env: { NODE_ENV: 'production', PORT: '9988' },
      max_memory_restart: '700M',
      time: true,
    },
    {
      name: 'tokri-web',
      cwd: './apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 9989 --hostname 0.0.0.0',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};
