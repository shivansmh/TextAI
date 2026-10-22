FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8787
ENV DATABASE_PATH=/data/textai.sqlite
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8787
CMD ["node", "src/server.js"]
