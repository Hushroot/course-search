Railway deployment notes

1. Create a Railway project and add this service from your GitHub repository or upload the project with Railway CLI.
2. Add a persistent Volume mounted at /data.
3. Set variables:
   NODE_ENV=production
   COOKIE_SECURE=true
   STATE_DIR=/data
   ADMIN_PASSWORD=<long unique password>
   SESSION_SECRET=<random secret at least 32 characters>
4. Start command: npm start
5. Healthcheck path: /health
6. Generate a public Railway domain.
