# CelPic

轻量级自托管图床，支持 Docker、本地磁盘、SQLite、多用户和上传 API。

## 一键部署

```bash
git clone https://github.com/shechenpu/celpic.git
cd celpic
cp .env.example .env
docker compose up -d --build
```

打开：`http://你的服务器IP:1018`

## 特性

- 拖拽、粘贴、多图上传
- 多用户与权限管理
- 图片图库、搜索、批量删除
- JPG、PNG、GIF、WebP
- 上传 Token 与原生 API
- SQLite + 本地持久化存储
- 单端口 Docker 部署

## 更新

```bash
git pull
docker compose up -d --build
```

数据库和图片位于 `data/`，请定期备份。不要提交 `.env`、数据库、图片或上传 Token。
