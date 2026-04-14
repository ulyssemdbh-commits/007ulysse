FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN NODE_OPTIONS='--max-old-space-size=3072' npx tsx script/build.ts

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S ulysse -u 1001 -G nodejs
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && chown -R ulysse:nodejs /app
COPY --from=builder --chown=ulysse:nodejs /app/dist ./dist
COPY --from=builder --chown=ulysse:nodejs /app/client/public ./client/public
USER ulysse
EXPOSE 5000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1
CMD ["node", "--max-old-space-size=3072", "dist/index.cjs"]
