#!/usr/bin/env node
/**
 * 通用 res 资源检查脚本（可被 check-res-urls skill 引用）
 * 用法：在项目根执行，可通过环境变量覆盖配置；RES_URLS 需在脚本内维护或通过 --urls 传入
 *
 * 环境变量：
 *   API_URL       check-url 接口，默认 http://wh.smzdm.com:3456/api/check-url
 *   STATIC_PREFIX 已有资源替换前缀，默认 https://static.smzdm.com/public/
 *   DOWNLOAD_DIR  下载目录（相对当前工作目录），默认 download
 *   BATCH_SIZE    每批请求 URL 数量，默认 20
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const API_URL = process.env.API_URL || 'http://wh.smzdm.com:3456/api/check-url';
const STATIC_PREFIX = process.env.STATIC_PREFIX || 'https://static.smzdm.com/public/';
const DOWNLOAD_DIR = path.resolve(process.cwd(), process.env.DOWNLOAD_DIR || 'download');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 20;

// URL 来源：环境变量 RES_URLS（逗号分隔）、RES_URLS_FILE（每行一个 URL）、或脚本内 RES_URLS 默认数组
function loadUrls() {
  if (process.env.RES_URLS) {
    return process.env.RES_URLS.split(',').map(u => u.trim()).filter(Boolean);
  }
  const file = process.env.RES_URLS_FILE || path.join(process.cwd(), 'res-urls.txt');
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8')
      .split(/\n/)
      .map(u => u.replace(/#.*/, '').trim())
      .filter(u => u && (u.startsWith('http') || u.startsWith('//')))
      .map(u => u.startsWith('//') ? 'https:' + u : u)
      .map(u => u.replace(/\?.*$/, ''));
  }
  return [];
}

const RES_URLS = loadUrls();

function checkUrls(urls) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ urls });
    const u = new URL(API_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Parse response: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function downloadFile(url, savePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(savePath);
    const doGet = (target) => {
      https.get(target, { rejectUnauthorized: false }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return doGet(res.headers.location);
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(savePath); });
      }).on('error', (err) => { fs.unlink(savePath, () => {}); reject(err); });
    };
    doGet(url);
  });
}

async function main() {
  const urls = RES_URLS.length ? RES_URLS : [];
  if (urls.length === 0) {
    console.warn('未找到 URL。请：1) 设置 RES_URLS（逗号分隔）或 RES_URLS_FILE（文件路径）；2) 在项目根创建 res-urls.txt（每行一个 base URL）；3) 或修改脚本内 loadUrls() 默认逻辑。');
    process.exit(1);
  }

  const allUrls = [...new Set(urls)];
  const results = [];
  const replaceMap = {};
  const downloadList = [];

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  console.log('检查 %d 个资源 (API: %s)...\n', allUrls.length, API_URL);

  for (let i = 0; i < allUrls.length; i += BATCH_SIZE) {
    const batch = allUrls.slice(i, i + BATCH_SIZE);
    const res = await checkUrls(batch);
    if (res.results) results.push(...res.results);
  }

  for (const r of results) {
    const url = r.url;
    if (r.existingFiles && r.existingFiles.length > 0) {
      const newUrl = STATIC_PREFIX.replace(/\/$/, '') + '/' + (r.existingFiles[0].path || '').replace(/^\//, '');
      replaceMap[url] = newUrl;
      replaceMap[url.replace(/^https:/, '//')] = newUrl;
      console.log('[已存在] %s -> %s', url, newUrl);
    } else {
      downloadList.push(url);
      console.log('[需下载] %s', url);
    }
  }

  for (const url of downloadList) {
    const name = path.basename(new URL(url).pathname) || 'unknown';
    const savePath = path.join(DOWNLOAD_DIR, name);
    try {
      await downloadFile(url, savePath);
      console.log('[已下载] %s', savePath);
    } catch (e) {
      console.error('[失败] %s: %s', url, e.message);
    }
  }

  const outPath = path.join(process.cwd(), 'url-replace-map.json');
  fs.writeFileSync(outPath, JSON.stringify({
    replaceMap,
    downloadList,
    staticPrefix: STATIC_PREFIX,
    timestamp: new Date().toISOString()
  }, null, 2));
  console.log('\n映射已写入: %s', outPath);

  return { replaceMap, downloadList };
}

main().catch((err) => { console.error(err); process.exit(1); });
