#!/usr/bin/env bash
#
# 產生 GHCR 的拉取憑證（ADR-0015）
#
# GHCR 是私有 registry，NAS 上的 Watchtower 要有憑證才拉得到映像。
# 這個檔案等同於 `docker login ghcr.io` 會產生的 ~/.docker/config.json，
# 只是改成在本機做——NAS 不方便 SSH，產生好之後用 File Station 上傳。
#
# 用法：
#   bash scripts/make_ghcr_config.sh
#
# token 要用 **classic** 的 Personal Access Token，不要用 fine-grained：
# fine-grained 對 GHCR 的支援不完整，而且權限要逐一指定 repo，
# 新 repo 不會自動納入。範圍只需要 read:packages。

set -euo pipefail

USERNAME="kylewu08"
OUTPUT="docker-config.json"

if [ -e "$OUTPUT" ]; then
  echo "⚠ $OUTPUT 已經存在。要重新產生請先刪掉它。"
  exit 1
fi

# -s 讓 token 不顯示在畫面上，也就不會留在終端機的捲動紀錄裡
read -rsp "貼上 GitHub PAT（classic，範圍 read:packages）: " TOKEN
echo

if [ -z "$TOKEN" ]; then
  echo "沒有輸入 token，中止。"
  exit 1
fi

AUTH=$(printf '%s:%s' "$USERNAME" "$TOKEN" | base64 | tr -d '\n')

cat > "$OUTPUT" <<JSON
{
  "auths": {
    "ghcr.io": {
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
