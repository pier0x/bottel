# Deploying Bottel to Railway

## Prerequisites

- [Railway account](https://railway.app)
- [Railway CLI](https://docs.railway.app/develop/cli) (optional)

## Quick Deploy

### 1. Create a new Railway project

Go to [railway.app/new](https://railway.app/new) and create a new project.

### 2. Add PostgreSQL

1. Click "New" → "Database" → "PostgreSQL"
2. Wait for it to provision (takes ~30 seconds)

### 3. Deploy Bottel

**Option A: Via GitHub**
1. Push this repo to GitHub
2. In Railway, click "New" → "GitHub Repo"
3. Select your repo
4. Railway auto-detects the Dockerfile

**Option B: Via Railway CLI**
```bash
cd bottel
railway login
railway init
railway up
```

### 4. Configure Environment Variables

In your Railway service settings, add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway template) |
| `JWT_SECRET` | Generate a random 32+ char secret |
| `NODE_ENV` | `production` |

### 5. Generate Domain

1. Go to your service → Settings → Networking
2. Click "Generate Domain" to get a `*.railway.app` URL

## Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT tokens (min 32 chars) |
| `PORT` | No | Server port (Railway sets automatically) |
| `NODE_ENV` | No | Set to `production` |

## Architecture on Railway

```
┌─────────────────────────────┐
│    Railway Project          │
│  ┌───────────────────────┐  │
│  │   Bottel Service      │  │
│  │   (Docker container)  │  │
│  │   - API + WebSocket   │  │
│  │   - Static UI         │  │
│  └───────────┬───────────┘  │
│              │              │
│  ┌───────────▼───────────┐  │
│  │   PostgreSQL          │  │
│  │   (Railway Postgres)  │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

## Scaling

Railway supports horizontal scaling. To handle more concurrent connections:

1. Go to Settings → Scaling
2. Increase replicas

Note: For multiple replicas, you'll need Redis for WebSocket pub/sub (future feature).

## Costs

Railway pricing (as of 2024):
- **Hobby plan**: $5/month + usage
- **Pro plan**: $20/month + usage
- PostgreSQL: ~$5-10/month for small instances

Bottel is lightweight — expect < $10/month for moderate usage.

## Troubleshooting

### Build fails
- Check that all dependencies are in `package.json`
- Ensure `npm ci` works locally

### Database connection fails
- Verify `DATABASE_URL` is set correctly
- Check PostgreSQL service is running

### WebSocket not connecting
- Ensure the domain is using HTTPS (wss://)
- Check browser console for connection errors

## Updating

Push to your GitHub repo — Railway auto-deploys on commits to main.

Or via CLI:
```bash
railway up
```
