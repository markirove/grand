# playeonweb-pro

Rebuild of Playeon Web.

## Development

```bash
npm run dev     # http://localhost:4040
npm run build
npm start
```

Served in production behind nginx at `https://playeon-bot-pro.xysushi.in`
(vhost: `/etc/nginx/sites-available/playeon-bot-pro.xysushi.in` -> `127.0.0.1:4040`).

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS v4
- Fonts: Onest (`font-sans`), Geist Mono (`font-mono`)
