FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-package-lock

COPY src ./src
COPY public ./public
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV MARKET_STATE_FILE=/app/data/market-state.json
ENV MARKET_DATA_DIR=/app/data
ENV MARKET_LOG_DIRECTORY=/app/data/logs
ENV MARKET_SYNC_ROLE=standalone
ENV MARKET_SYNC_INTERVAL_SECONDS=5
EXPOSE 3001

CMD ["node", "src/server.js"]