# AI Star Studio v3 — 生产镜像
# 零 npm 依赖（纯 Node 内置模块），但需要系统级 ffmpeg/ffprobe 做音视频合成与对口型。
FROM node:20-bookworm-slim

# ffmpeg + ffprobe（视频/音乐/访谈合成、lipsync 必需）；ca-certificates 供出站 HTTPS 调 DashScope 等。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV NODE_ENV=production
# Cloud Run 会注入 PORT（默认 8080），server.js 用 process.env.PORT 自动绑定。
EXPOSE 8080

CMD ["node", "server.js"]
