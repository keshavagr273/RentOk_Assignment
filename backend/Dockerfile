FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
WORKDIR /app

# Copy installed modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source and build artifacts
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY src ./src

# Install dev deps for the build step only
RUN npm ci && npm run build && rm -rf node_modules && npm ci --only=production

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main"]
