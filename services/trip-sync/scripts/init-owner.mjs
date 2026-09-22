import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = new URL('../.local/', import.meta.url);
const loginFile = new URL('owner-login.txt', directory);
try { await access(loginFile); throw new Error('已有登录码，拒绝覆盖；轮换请单独处理。'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(directory, { recursive: true, mode: 0o700 });
const key = `jt_${randomBytes(32).toString('base64url')}`;
await writeFile(loginFile, `Global Trips 专用旅行登录码\n\n${key}\n\n在旅行网页的“登录以编辑”中输入。仅用于你的旅行数据，请勿放入公开仓库或分享链接。\n`, { mode: 0o600, flag: 'wx' });
await writeFile(new URL('worker-secrets.json', directory), JSON.stringify({ OWNER_KEY_HASH: createHash('sha256').update(key).digest('hex') }), { mode: 0o600, flag: 'wx' });
console.log(`登录码已保存到本机私有文件：${fileURLToPath(loginFile)}`);
