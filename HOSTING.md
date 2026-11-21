# Hosted deployment

The secure production version will run independently of this laptop.

## Architecture

- React website: Render Static Site
- Node.js API: Render Web Service
- PostgreSQL: Render-managed database
- HTTPS: provided by Render
- Secrets: Render environment variables
- Data: hosted PostgreSQL, not laptop SQLite

## Render setup

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render will read `render.yaml`.
4. Set secret values when Render asks:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
5. Change `FRONTEND_ORIGIN` after the website URL is known.
6. Change `VITE_API_URL` after the API URL is known.
7. Deploy both services.

## Database initialization

Before opening the website, run PostgreSQL schema initialization against the hosted database:

```bash
psql "$DATABASE_URL" -f backend/sql/schema.sql
```

Then create or synchronize the administrator:

```bash
cd backend
npm ci
npm run seed:admin
```

## Security checklist

- Never place the administrator password in frontend code.
- Use a unique strong `JWT_SECRET` of at least 64 characters.
- Use HTTPS only.
- Add backups and recovery testing for PostgreSQL.
- Rotate passwords periodically.
- Do not expose PostgreSQL publicly.
- Add a custom domain after initial deployment.

## After deployment

Open the hosted website HTTPS URL. The laptop can then be switched off: the database and API run in the cloud.
