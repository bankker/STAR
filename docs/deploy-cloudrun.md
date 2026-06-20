# 部署到 Google Cloud Run（方案 2）

把这个**单机有状态**应用跑在 Cloud Run 上：容器里装好 ffmpeg，全部可写状态挂到一块 GCS 存储桶，密钥走 Secret Manager，并**锁成单实例 + CPU 常开**（因为任务队列在内存、还要在请求之外轮询生成结果）。

---

## 0. 一次性前提

```bash
# 安装 Google Cloud SDK（本机没有 gcloud；或直接用 https://console.cloud.google.com 的 Cloud Shell）
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 开启所需 API
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com
```

设几个变量（其余命令都引用它们）：

```bash
PROJECT=YOUR_PROJECT_ID
REGION=asia-east1          # 离 DashScope 近一些（台湾）；也可 asia-northeast1（东京）
SERVICE=starstudio
BUCKET=gs://${PROJECT}-starstudio-state
```

---

## 1. 建状态存储桶（数据/产物/日志/密钥都放这里）

```bash
gcloud storage buckets create $BUCKET --location=$REGION --uniform-bucket-level-access
```

> 这一个桶会装下 `data/`（艺人/短剧/访谈 JSON、任务队列）、`generated/`（图/视频/音乐）、`logs/`（成本台账）、`.env`（后台录入的密钥）。容器首次启动会自动建子目录。

---

## 2. 把 DashScope 密钥放进 Secret Manager

```bash
printf '%s' 'sk-你的DashScopeKey' | gcloud secrets create dashscope-key --data-file=-

# 让 Cloud Run 的运行身份能读它（默认计算服务账号）
PROJNUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding dashscope-key \
  --member="serviceAccount:${PROJNUM}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

> 可选的备用 provider 密钥（`GEMINI_API_KEY`、`KLING_ACCESS_KEY`/`KLING_SECRET_KEY`、`ANTHROPIC_API_KEY`、`OPENROUTER_API_KEY`、`SUNO_API_KEY`）按同样方式各建一个 secret，再在第 3 步 `--set-secrets` 里追加。只用通义万相的话，只配 `dashscope-key` 即可。

再建一个**登录口令** secret（应用已内置 Basic Auth 闸：设了 `APP_PASSWORD` 就要求登录，不设则放行）：

```bash
# 生成一个强口令并存入 secret（也可换成你自己的口令）
PW=$(openssl rand -base64 18)
printf '%s' "$PW" | gcloud secrets create app-password --data-file=-
gcloud secrets add-iam-policy-binding app-password \
  --member="serviceAccount:${PROJNUM}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
echo "登录口令是：$PW   （记下来，登录时用户名随意、密码填它）"
```

---

## 3. 构建 + 部署（一条命令，含所有关键开关）

仓库里已有 `Dockerfile`，`gcloud run deploy --source .` 会用它经 Cloud Build 构建并部署：

```bash
gcloud run deploy $SERVICE \
  --source . \
  --region $REGION \
  --execution-environment gen2 \
  --add-volume   name=state,type=cloud-storage,bucket=${PROJECT}-starstudio-state \
  --add-volume-mount volume=state,mount-path=/mnt/state \
  --set-env-vars DATA_DIR=/mnt/state/data,GENERATED_DIR=/mnt/state/generated,LOGS_DIR=/mnt/state/logs,ENV_FILE=/mnt/state/.env \
  --set-secrets  DASHSCOPE_API_KEY=dashscope-key:latest,APP_PASSWORD=app-password:latest \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling \
  --cpu 2 --memory 4Gi \
  --timeout 3600 \
  --allow-unauthenticated
```

> 这里用 `--allow-unauthenticated`（任何人能打开 URL），**安全靠应用内置的 `APP_PASSWORD` 登录闸兜底**——没口令进不去任何接口。若你更想用 Google IAM 而不是口令，把这行换成 `--no-allow-unauthenticated`、并去掉 `APP_PASSWORD` secret 即可。

每个关键开关**为什么必须**：

| 开关 | 原因 |
|---|---|
| `--execution-environment gen2` | GCS 卷挂载只在二代执行环境支持 |
| `--add-volume … type=cloud-storage` + `--add-volume-mount` | 把 GCS 桶挂到 `/mnt/state`，否则容器重启数据全丢 |
| `--set-env-vars DATA_DIR/GENERATED_DIR/LOGS_DIR/ENV_FILE` | 把应用的全部可写路径重定向到那块卷 |
| `--min-instances 1 --max-instances 1` | 任务队列在内存、文件是单写入者——**绝不能多实例**，也不能缩到 0（缩到 0 会丢掉队列里在跑的任务） |
| `--no-cpu-throttling` | 默认 Cloud Run 在没有请求时把 CPU 掐到近 0，会**冻结后台轮询**（视频/音乐生成要在请求之外轮询几分钟）。必须让 CPU 常驻 |
| `--cpu 2 --memory 4Gi` | ffmpeg 合成视频吃内存/CPU，给足 |
| `--timeout 3600` | 成片是 SSE 长连接，最长给到 60 分钟（Cloud Run 上限） |
| `--no-allow-unauthenticated` | **见下方安全警告**——应用本身没有鉴权，先别公开 |

部署完会打印一个 `https://starstudio-xxxx-de.a.run.app` 地址。

---

## 🔒 安全：已内置登录闸

应用现在内置了 **HTTP Basic Auth 登录闸**（`server.js`）：设了环境变量 `APP_PASSWORD` 就要求登录，覆盖**所有**接口与 `/generated` 媒体；不设则放行（本地开发默认无闸）。所以上面的 `--allow-unauthenticated` 是安全的——公开 URL 但没口令进不去任何花钱接口。

替代方案（不想用口令时）：
- **Google IAM**：`--no-allow-unauthenticated` + 去掉 `APP_PASSWORD` secret，用 `gcloud run services proxy` 自己访问（浏览器直开会 403）。
- **IAP（Identity-Aware Proxy）**：用 Google 账号白名单控制谁能进，体验比口令更正规。

> 口令走 Secret Manager，登录时**用户名随意、密码填 `APP_PASSWORD`**。浏览器会弹原生登录框，登录态对同源的 fetch / EventSource / 媒体请求都生效。

---

## 4. GCS 卷的已知取舍（低流量可接受）

- GCS FUSE 不是真 POSIX 盘：**追加写**（成本台账 `ai-usage.jsonl`）和频繁小写会整对象重写，比本地盘慢。
- 大视频从卷里读出来再经服务端流给浏览器，会有额外延迟。
- 单用户/低并发完全够用；要做高并发再考虑换 Filestore(NFS) 或把产物直接放 GCS 公链。

---

## 5. 更新 / 回滚 / 拆除

```bash
# 改完代码重新部署（同一条 deploy 命令即可，自动建新修订版）
gcloud run deploy $SERVICE --source . --region $REGION   # 其余开关同上

# 回滚到上一个修订版
gcloud run services update-traffic $SERVICE --region $REGION --to-revisions PREV_REVISION=100

# 全部拆除（注意：删桶会删掉所有数据/产物）
gcloud run services delete $SERVICE --region $REGION
gcloud storage rm -r $BUCKET
```

---

## 本地先验证镜像（可选，但推荐）

部署上云前，可以在本机用 Docker 跑一遍，确认容器能起、能服务：

```bash
docker build -t starstudio:local .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e DATA_DIR=/state/data -e GENERATED_DIR=/state/generated \
  -e LOGS_DIR=/state/logs -e ENV_FILE=/state/.env \
  -e DASHSCOPE_API_KEY=sk-你的key \
  -v "$PWD/.localstate:/state" \
  starstudio:local
# 浏览器开 http://localhost:8080
```
