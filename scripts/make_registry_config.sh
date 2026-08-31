#!/usr/bin/env bash
#
# 產生 Docker Hub 的拉取憑證（ADR-0015、ADR-0022）
#
# 映像放在私有 repo，NAS 上的 **Watchtower** 要有憑證才檢查得到新版。
#
# ⚠️ **這個檔案救不了第一次拉取。** 它掛載給 Watchtower 容器，
# 而第一次拉映像是 Container Manager 用 Docker daemon 的憑證做的——
# 那是 DSM「登錄檔」設定或 `docker login` 的事。見 ADR-0022。
# 這個檔案等同於 `docker login ghcr.io` 會產生的 ~/.docker/config.json，
# 只是改成在本機做——NAS 不方便 SSH，產生好之後用 File Station 上傳。
#
# 用法：
#   bash scripts/make_ghcr_config.sh
#
# 用 Docker Hub 的 **Access Token**（Account Settings → Personal access tokens），
# 不要用登入密碼。權限選 Read-only 就夠——NAS 只需要拉，不需要推。

set -euo pipefail

USERNAME="kylewu08"   # Docker Hub 帳號，與 GitHub 的不一定相同
OUTPUT="docker-config.json"

if [ -e "$OUTPUT" ]; then
  echo "⚠ $OUTPUT 已經存在。要重新產生請先刪掉它。"
  exit 1
fi

# -s 讓 token 不顯示在畫面上，也就不會留在終端機的捲動紀錄裡
read -rsp "貼上 Docker Hub Access Token（Read-only 即可）: " TOKEN
echo

if [ -z "$TOKEN" ]; then
  echo "沒有輸入 token，中止。"
  exit 1
fi

AUTH=$(printf '%s:%s' "$USERNAME" "$TOKEN" | base64 | tr -d '\n')

cat > "$OUTPUT" <<JSON
{
  "auths": {
    "https://index.docker.io/v1/": {
      "auth": "$AUTH"
    }
  }
}
JSON

chmod 600 "$OUTPUT"

echo "✓ 已產生 $OUTPUT"
echo
echo "下一步：用 File Station 上傳到 NAS 的 /volume1/docker/kidgo/"
echo "        要跟 docker-compose.yml 放在同一層，否則 Watchtower 找不到。"
echo
echo "⚠ 這個檔案含有 token，已被 .gitignore 擋住，不要提交。"
