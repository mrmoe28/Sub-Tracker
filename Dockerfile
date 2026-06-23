FROM node:24-bookworm AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
ENV CHECKPOINT_DISABLE=1
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts && npm cache clean --force \
    # Remove native SWC binary so Next.js falls back to WASM
    # (avoids tokio UnixStream PermissionDenied in restricted sandbox)
    && rm -rf node_modules/@next/swc-linux-x64-gnu node_modules/@next/swc-linux-x64-musl

COPY prisma ./prisma
RUN CHECKPOINT_DISABLE=1 npx prisma generate

COPY . .
RUN CHECKPOINT_DISABLE=1 npx next build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx
COPY start.sh ./start.sh
RUN chmod +x start.sh

EXPOSE 3000
CMD ["./start.sh"]
