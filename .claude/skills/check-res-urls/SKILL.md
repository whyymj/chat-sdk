---
name: check-res-urls
description: Scans codebase for res CDN resource URLs, calls a check-url API to find existing static equivalents, then replaces links or downloads missing files. Use when migrating from res.smzdm.com (or similar) to static CDN, when the user asks to "检查/替换 res 资源" or "check url replace", or when consolidating asset URLs via an existing-file API.
---

# Check Res URLs and Replace / Download

将「扫描 res 资源 → 调 API 查是否已有对应资源 → 有则替换链接、无则下载」封装为可复用流程，适用于任意使用 res CDN 且提供 check-url 接口的项目。

## 何时使用

- 用户要求：再次检查 res 资源、扫描 res.smzdm.com 并替换/下载
- 迁移：从 res 域名迁移到 static 等静态资源域名
- 资产去重：通过接口判断资源是否已存在，存在则用已有地址替换

## Agent 执行清单

1. 在项目根 **grep** 出所有 res 域名 URL，去重、去 query，得到 base URL 列表（或写入 `res-urls.txt`）。
2. 配置并运行脚本：设置 `API_URL`、`STATIC_PREFIX`、`DOWNLOAD_DIR`（可选），执行 `scripts/check-res-urls.js`（或本 skill 下的脚本），传入 RES_URLS / RES_URLS_FILE。
3. 根据输出的 **replaceMap**，在代码中把每个旧 URL（含 `https:` 与 `//` 形式）替换为对应新 URL。
4. 对 **downloadList** 中的资源：已下载到 DOWNLOAD_DIR；若项目需改用本地路径，再单独改引用。
5. 将「构建基地址」类配置（如 `absolutePath`）排除在本流程外，不参与替换。

## 流程概览

1. **扫描**：在项目中 grep 出所有 `res.smzdm.com`（或配置的域名）资源 URL，去重并去掉 query（如 `?v=1`）得到 base URL 列表。
2. **检查**：对 base URL 列表调用 check-url API（POST `{"urls": ["url1", "url2", ...]}`）。
3. **处理结果**：
   - 若返回中 `results[].existingFiles` 非空：用 `STATIC_PREFIX + existingFiles[0].path` 替换代码中该资源的所有引用（含 `https:` 与 `//` 协议相对写法）。
   - 若 `existingFiles` 为空：将资源下载到项目下的 `download/`（或配置目录），代码中的 URL 保持不变（或由项目自行改为本地路径）。

## API 约定

- **请求**：`POST {API_URL}`，Body `application/json`：`{"urls": ["https://res.example.com/path/to/file.png"]}`。
- **响应**：`{ "results": [ { "url": "...", "existingFiles": [ { "path": "editor/img/radio_ac.png" } ] } ] }`。
  - `existingFiles` 非空表示已有对应资源，`path` 为相对 static 根路径。
  - `existingFiles` 为空或不存在表示需自行下载或保留原链接。

## 配置项（脚本 / 环境变量）

| 变量 | 含义 | 示例 |
|------|------|------|
| `API_URL` | check-url 接口地址 | `http://wh.smzdm.com:3456/api/check-url` |
| `RES_HOST` | 要扫描的 res 域名（用于 grep） | `res.smzdm.com` |
| `STATIC_PREFIX` | 已有资源替换后的 URL 前缀 | `https://static.smzdm.com/public/` |
| `DOWNLOAD_DIR` | 不存在资源时的下载目录（相对项目根） | `download` |

## 执行步骤

1. **收集 URL**：在项目根执行 grep（或等价搜索），匹配 `RES_HOST` 的 URL，去重、去掉 query，得到 `RES_URLS` 列表。注意包含协议相对形式 `//res...` 对应的 `https:` URL。
2. **调用 API**：分批 POST 到 `API_URL`，每批约 20 个 URL，合并所有 `results`。
3. **替换**：对每个 `result.existingFiles[0].path`，在代码中把对应原 URL（含 `https:` 与 `//`）全部替换为 `STATIC_PREFIX + path`。
4. **下载**：对无 `existingFiles` 的 URL，用 GET 下载到 `DOWNLOAD_DIR`，文件名可用 URL pathname 的 basename；若重名可加前缀或子目录。
5. **输出**：可写一份 `url-replace-map.json`（replaceMap、downloadList、timestamp），便于后续人工核对或 CI 使用。

## 脚本使用

技能自带可配置 Node 脚本，需在**项目根**执行：

```bash
# 使用默认配置（smzdm 示例）
node path/to/skills/check-res-urls/scripts/check-res-urls.js

# 或通过环境变量覆盖
API_URL=https://your-api.example.com/check-url \
STATIC_PREFIX=https://cdn.example.com/ \
RES_HOST=res.example.com \
DOWNLOAD_DIR=assets/download \
node path/to/skills/check-res-urls/scripts/check-res-urls.js
```

**URL 来源**（三选一）：
- 环境变量 `RES_URLS`：逗号分隔的 base URL。
- 环境变量 `RES_URLS_FILE` 或项目根下的 `res-urls.txt`：每行一个 URL（可带 query，脚本会去掉）。
- 在脚本内修改 `loadUrls()`，从 grep 结果或项目约定路径读入。

**收集 URL 示例**（在项目根执行，得到 res-urls.txt 后可直接用脚本）：
```bash
grep -rhoE 'https?://res\.smzdm\.com[^"'\'')\s]+' --include='*.vue' --include='*.js' --include='*.ejs' src build lib 2>/dev/null \
  | sed 's/\?.*$//' | sort -u > res-urls.txt
# 若有 //res... 形式，可再追加：
grep -rhoE '//res\.smzdm\.com[^"'\'')\s]+' --include='*.vue' --include='*.js' src lib 2>/dev/null \
  | sed 's/\?.*$//' | sed 's|^|https:|' >> res-urls.txt
sort -u res-urls.txt -o res-urls.txt
```

**仅做替换、不下载**：若项目不需要下载，可在脚本中注释掉下载逻辑，仅根据 API 结果做代码内 URL 替换。

## 替换时的注意点

- 同一资源可能以 `https://res...` 和 `//res...` 两种形式出现，替换时两种都要换成同一 static URL。
- 带 query 的 URL（如 `sa-sdk.js?v=xxx`）只以 base URL 参与检查和替换，替换后是否保留 query 由项目决定。
- `build/config.js` 等里的 `absolutePath` 若为目录而非单文件 URL，通常不参与本流程，避免误替换。

## 其他项目接入

1. 将本 skill 置于 `~/.cursor/skills/check-res-urls/`（已存在则跳过）。
2. 复制或链接 `scripts/check-res-urls.js` 到目标项目，或在目标项目中用 env 指定脚本路径并传入该项目的 RES_URLS。
3. 设置 `API_URL`、`STATIC_PREFIX`、`RES_HOST`、`DOWNLOAD_DIR` 以匹配目标环境。
4. 在项目根执行脚本，根据输出的 replaceMap 在代码中执行替换（或由脚本直接写回文件）；downloadList 对应文件已落在 `DOWNLOAD_DIR`，按需接入构建或静态服务。

详细脚本逻辑与错误处理见 [scripts/check-res-urls.js](scripts/check-res-urls.js)。
