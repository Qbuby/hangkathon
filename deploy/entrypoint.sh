#!/bin/sh
# 容器入口：先跑数据库迁移，再起 Next.js standalone 服务。
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] 应用数据库迁移…"
  node db/migrate.mjs
else
  echo "[entrypoint] 没有 DATABASE_URL，按无数据库模式启动（前端回落 localStorage）"
fi

exec node server.js
