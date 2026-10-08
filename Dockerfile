FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV MARKET_STATE_FILE=/app/data/market-state.json
EXPOSE 3001

CMD ["node", "src/server.js"]