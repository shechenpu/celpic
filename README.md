# CelPic

轻量级自托管图床，支持 Docker、本地磁盘、SQLite、多用户和上传 API。

## 特性

- 拖拽、粘贴、多图上传
- 多用户与权限管理
- 图片图库、搜索、批量删除
- JPG、PNG、GIF、WebP
- 上传 Token 与原生 API
- SQLite + 本地持久化存储
- Docker Compose 一键部署

## 快速开始

### Docker

```bash
git clone https://github.com/shechenpu/celpic.git
cd celpic
cp .env.example .env
docker compose up -d --build
```

打开：`http://localhost:1018`

### Windows 本地运行

双击 `start-celpic.cmd`，或执行：

```powershell
node server.js
```

## 数据与安全

数据库和图片位于 `data/`，请定期备份。不要提交 `.env`、数据库、图片或上传 Token。

详细部署、HTTPS、NAS、Render 和备份说明见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。
