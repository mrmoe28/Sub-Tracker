# Coolify best practices for Next.js deployment
# https://coolify.io/docs/applications/nextjs
# https://coolify.io/docs/applications/build-packs/dockerfile

# Metadata labels
LABEL maintainer="mrmoe28"
LABEL description="Sub-Tracker - Next.js application with Prisma"
LABEL version="1.0.0"

# ---------- deps ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Build-time arguments (Coolify injects these automatically)
ARG NEXT_PUBLIC_APP_URL
ARG DATABASE_URL
ARG AUTH_SECRET
ARG AUTH_GOOGLE_ID
ARG AUTH_GOOGLE_SECRET
ARG AUTH_URL

COPY package*.json ./
# Install dependencies without scripts to avoid Prisma preinstall issues in Coolify sandbox
RUN npm install --no-audit --no-fund --ignore-scripts

# ---------- builder ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV CHECKPOINT_DISABLE=1
ENV NODE_ENV=production

# Build-time arguments
ARG NEXT_PUBLIC_APP_URL
ARG DATABASE_URL
ARG AUTH_SECRET
ARG AUTH_GOOGLE_ID
ARG AUTH_GOOGLE_SECRET
ARG AUTH_URL

# Set build-time environment variables
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV DATABASE_URL=${DATABASE_URL}
ENV AUTH_SECRET=${AUTH_SECRET}
ENV AUTH_GOOGLE_ID=${AUTH_GOOGLE_ID}
ENV AUTH_GOOGLE_SECRET=${AUTH_GOOGLE_SECRET}
ENV AUTH_URL=${AUTH_URL}

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY . .

# Build application
RUN npm run build

# ---------- runner ----------
FROM node:24-bookworm-slim AS runner

# Metadata labels
LABEL maintainer="mrmoe28"
LABEL description="Sub-Tracker - Next.js application with Prisma"
LABEL version="1.0.0"

WORKDIR /app

# Runtime environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV CHECKPOINT_DISABLE=1

# Runtime arguments (Coolify injects these automatically)
ARG DATABASE_URL
ARG AUTH_SECRET
ARG AUTH_GOOGLE_ID
ARG AUTH_GOOGLE_SECRET
ARG AUTH_URL
ARG NEXTAUTH_SECRET
ARG NEXTAUTH_URL

# Set runtime environment variables
ENV DATABASE_URL=${DATABASE_URL}
ENV AUTH_SECRET=${AUTH_SECRET}
ENV AUTH_GOOGLE_ID=${AUTH_GOOGLE_ID}
ENV AUTH_GOOGLE_SECRET=${AUTH_GOOGLE_SECRET}
ENV AUTH_URL=${AUTH_URL}
ENV NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma runtime dependencies
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx

# Copy startup script
COPY start.sh ./start.sh
RUN chmod +x start.sh

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check (Coolify best practice)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start application
CMD ["./start.sh"]
