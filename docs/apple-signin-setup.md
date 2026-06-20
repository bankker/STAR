# 启用「使用 Apple 登录」(Sign in with Apple) — 配置指南

代码已写好并上线（`src/api/auth.js`，与 Google 登录并存，按环境变量开关）。等 **Apple Developer Program 会员**通过后，照这份做。整个过程你在 Apple 后台点几下，我这边只需改两个环境变量（**不用重新构建镜像**）。

需要的最终环境变量：
- `APPLE_CLIENT_ID` = 你的 **Services ID**（如 `com.wangrui.starstudio.web`）
- `APPLE_DOMAIN_ASSOCIATION` = Apple 给的域名验证文件内容（走 Secret Manager，多行安全）
- `APPLE_REDIRECT_URI` = `https://star.wangrui.computer/api/auth/apple/callback`（已是代码默认值，可不设）

---

## ① 建 App ID（主标识）
developer.apple.com → Certificates, IDs & Profiles → **Identifiers** → ➕ → **App IDs** → App
- Description：`Star Studio`
- Bundle ID：`com.wangrui.starstudio`（Explicit）
- 勾选能力 **Sign in with Apple** → 保存

## ② 建 Services ID（这就是网页端的 client_id）
Identifiers → ➕ → **Services IDs**
- Description：`Star Studio Web`
- Identifier：`com.wangrui.starstudio.web` ← **这串就是 `APPLE_CLIENT_ID`**，记下来
- 创建后点进去，勾 **Sign in with Apple** → **Configure**：
  - **Primary App ID**：选 ① 建的 `com.wangrui.starstudio`
  - **Domains and Subdomains**：`star.wangrui.computer`
  - **Return URLs**：`https://star.wangrui.computer/api/auth/apple/callback`
  - 这时 Apple 要求**验证域名**：点 **Download** 下载 `apple-developer-domain-association.txt`
  - **把这个文件的内容发我**（整段文本）

## ③ 我这边：让验证文件可访问（你发我内容后我做）
我把文件内容存进 Secret Manager 并接到环境变量，应用就会在
`https://star.wangrui.computer/.well-known/apple-developer-domain-association.txt`
返回它。命令（供参考）：
```bash
printf '%s' '<association 文件内容>' | gcloud secrets create apple-domain-assoc --data-file=-
gcloud secrets add-iam-policy-binding apple-domain-assoc \
  --member="serviceAccount:537820046854-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
gcloud run services update starstudio --region asia-east1 \
  --update-secrets APPLE_DOMAIN_ASSOCIATION=apple-domain-assoc:latest
```

## ④ 回 Apple 后台点「Verify / 验证」
文件能访问后，回 Services ID 配置页点验证 → 通过 → **Save**。

## ⑤ 我这边：打开 Apple 登录按钮（你发我 Services ID 后）
```bash
gcloud run services update starstudio --region asia-east1 \
  --update-env-vars APPLE_CLIENT_ID=com.wangrui.starstudio.web
```
部署后 `https://star.wangrui.computer/login` 就会多出黑色「使用 Apple 登录」按钮。点它 → 跳 Apple → 授权 → 回来自动登录（和 Google 一样发会话 cookie）。

---

## 你要发我的两样
1. **Services ID**（`com.wangrui.starstudio.web` 这串）
2. **域名验证文件内容**（②里 Download 的那个 txt 的整段文本）

收到我就把 ③⑤ 跑了，然后你回 Apple 点验证（④），全程不用重建镜像。

> 备注：白名单 `ALLOWED_EMAILS` 当前留空＝任意已验证账号都放行（和 Google 一致）。Apple 用户若选「隐藏邮箱」，邮箱是 `@privaterelay.appleid.com` 的中转地址，也算已验证、能登。想限制具体人，之后设 `ALLOWED_EMAILS` 即可。
