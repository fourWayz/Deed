# Build from the repo root so the root deployments.json (v3 addresses and deploy block) is in the image:
#   docker build -f docker/indexer.Dockerfile -t deed-indexer .
FROM node:22-slim
WORKDIR /app/indexer
COPY indexer/package.json indexer/package-lock.json ./
RUN npm ci --omit=dev
COPY indexer/ ./
COPY deployments.json /app/deployments.json
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# one process: API plus sync loop. State lives in Postgres, so a restart resumes from the stored cursor.
CMD ["node", "src/cli.js", "run"]
