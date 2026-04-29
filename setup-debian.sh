#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Script cài đặt Docker + chạy SEC//CAST trên Debian
# Chạy: bash setup-debian.sh
# ─────────────────────────────────────────────────────────────
set -e

echo "==> [1/4] Cập nhật hệ thống..."
apt-get update -y && apt-get upgrade -y

echo "==> [2/4] Cài Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
| tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> [3/4] Khởi động Docker service..."
systemctl enable docker
systemctl start docker

echo "==> [4/4] Kiểm tra..."
docker --version
docker compose version

echo ""
echo "✅ Docker đã sẵn sàng!"
echo ""
echo "Tiếp theo:"
echo "  1. cd /opt/seccast"
echo "  2. cp .env.example .env  →  điền Supabase keys vào .env"
echo "  3. docker compose up -d"
echo "  4. Truy cập http://$(hostname -I | awk '{print $1}'):3000"
