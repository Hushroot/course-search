Railway deployment notes

1. Create a Railway project and add this service from your GitHub repository or upload the project with Railway CLI.
2. Add a persistent Volume mounted at /data.
3. Set variables:
   NODE_ENV=production
   COOKIE_SECURE=true
   STATE_DIR=/data
   ADMIN_PASSWORD=<long unique password>
   SESSION_SECRET=<random secret at least 32 characters>
   INFINITY_AUTH_KEY=<dedicated private base64-encoded 32-byte encryption key>
   APP_ORIGIN=<actual public HTTPS origin, no trailing slash>
4. Start command: npm start
5. Healthcheck path: /health
6. Generate a public Railway domain.
7. Run one instance/process only. Keep the volume private. See README.md for
   key generation, careful legacy-cookie migration, trusted-proxy configuration
   and the unverified live Infinity login/device/CDN limitations. No automatic
   deployment is performed by this build.
