# The app has no dependencies to install, so the image is just Node plus source.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data

RUN mkdir -p /data && addgroup -S clinic && adduser -S clinic -G clinic \
    && chown -R clinic:clinic /app /data
USER clinic

VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
