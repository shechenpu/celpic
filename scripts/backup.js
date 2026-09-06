'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const destination = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'), new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(destination, { recursive: true });
for (const source of [data]) {
  if (!fs.existsSync(source)) continue;
  const target = path.join(destination, path.basename(source));
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
}
fs.writeFileSync(path.join(destination, 'README.txt'), 'CelPic 备份：data 目录内包含数据库、设置和 images 图片目录。恢复前停止服务。\n', 'utf8');
console.log(`Backup created: ${destination}`);
