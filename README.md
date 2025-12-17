# Cloud Defender

### 1) Configure env
Backend requires Google OAuth credentials. Fill `.env` or create `.env.local`:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DESKTOP_GOOGLE_CLIENT_ID`
- `DESKTOP_GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### Start
`docker compose up -d --build`
Open: `http://localhost:${HTTP_PORT}`

### Stop
`docker compose down`
