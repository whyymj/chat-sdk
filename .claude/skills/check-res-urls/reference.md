# Check-Res-URLs 参考

## API 请求/响应示例

**请求**
```http
POST /api/check-url HTTP/1.1
Content-Type: application/json

{"urls":["https://res.smzdm.com/zmui/v1/img/radio-ac.png"]}
```

**响应（已有资源）**
```json
{
  "results": [{
    "url": "https://res.smzdm.com/zmui/v1/img/radio-ac.png",
    "isExact": true,
    "existingFiles": [{
      "path": "editor/img/radio_ac.png",
      "distance": 0,
      "similarity": 100,
      "isExact": true
    }]
  }]
}
```
替换后的完整 URL：`{STATIC_PREFIX}{path}` → `https://static.smzdm.com/public/editor/img/radio_ac.png`

**响应（无对应资源）**
```json
{
  "results": [{
    "url": "https://res.smzdm.com/xxx/not-found.png",
    "existingFiles": [],
    "closestFiles": []
  }]
}
```
此类 URL 不替换，仅下载到 DOWNLOAD_DIR（若开启下载）。

## 替换规则小结

- 代码中出现的两种形式都要替换为同一 static URL：`https://res...` 与 `//res...`。
- 只根据「无 query 的 base URL」调 API；替换时若原处带 query（如 `?v=1`），可保留或去掉，按项目约定。
- 目录型配置（如 `absolutePath: 'https://res.../dist/'`）不参与本流程。

## 输出文件 url-replace-map.json

- `replaceMap`：原 URL → 新 URL，用于批量替换或人工核对。
- `downloadList`：未在接口中找到的资源，已下载到 DOWNLOAD_DIR。
- 可在 CI 中解析该文件，仅对 replaceMap 中的键做代码替换，避免手改遗漏。
