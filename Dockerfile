# 自托管镜像：多阶段构建，产物是 Next.js standalone 服务端。
# 构建时走阿里云 / npmmirror 镜像源，因为这台机器直连 Docker Hub 与 npmjs 都不通。
FROM node:22-alpine AS deps
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# 2C2G 的机器上构建容易吃满内存，限制堆并留出余量
ENV NODE_OPTIONS=--max-old-space-size=1024
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# build:vercel 就是 next build；npm run build 会走 Cloudflare/vinext 目标，这里不能用
RUN npm run build:vercel

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# standalone 不会自带 public 与 static，必须手动搬过来
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
