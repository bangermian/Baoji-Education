# 小鱼 · 陪聊客服（Cloudflare Worker）

网站上右下角的「🐟 小鱼」聊天球，前端在 `../assets/app.js`，后端就是这里的 `index.js`。

## 它是怎么跑的

```
浏览器 ──POST /api/chat──> Worker ──> DeepSeek API
                              ↑ DEEPSEEK_API_KEY 存在 Worker 的 Secret 里
```

前端只发 `{ messages: [...] }`，Worker 拿固定的系统提示词（人设）拼上下文去调 DeepSeek，
把 `reply` 原样返回。**API Key 永远不会出现在网页里。**

## 部署（两种方式，选一个）

### 方式 A：Cloudflare 后台点几下（不用装工具）

1. Cloudflare 控制台 → **Compute (Workers)** → **Create** → **Worker**
2. 名字随便，比如 `baoji-chat`，进去后把 `index.js` 的内容整段粘进编辑器，**Deploy**
3. 进这个 Worker → **Settings** → **Variables and Secrets**：
   - `DEEPSEEK_API_KEY` → 类型选 **Secret**，值填你的 key（在 https://platform.deepseek.com 拿）
   - 可选：`MODEL` = `deepseek-chat`，`DAILY_LIMIT` = `400`
4. 同一个 Worker → **Settings** → **Triggers** → **Add route**：
   - Route：`baojijiaoyu86.top/api/chat`
   - Zone：`baojijiaoyu86.top`
5. 打开网站，点右下角小鱼，能回话就通了。

> 你的站点已经在 Cloudflare 上，`/api/messages` 也是同一套路子（大概率是个 Worker），
> 给 `/api/chat` 单独加路由不会影响它——路由是「最具体优先」。

### 方式 B：命令行 wrangler

```bash
cd worker
npm install -g wrangler        # 或 npx wrangler
wrangler login
wrangler secret put DEEPSEEK_API_KEY   # 粘贴 key
wrangler deploy
```

## 想防刷爆额度？加个 KV（可选但建议）

```bash
wrangler kv namespace create CHAT_KV
```

把返回的 `id` 填到 `wrangler.toml` 的 `[[kv_namespaces]]` 里（取消注释），重新 `deploy`。
开起来之后：

- 每个 IP 每 10 分钟最多 20 条（`RATE_LIMIT`）
- 全站每天最多 400 条（`DAILY_LIMIT`），超了访客会看到「小鱼有点忙」

没有 KV 时也会限流，但只在单个 Worker 实例内存里生效，重启就清零——够用，但不严谨。

## 自测

```bash
curl -X POST https://baojijiaoyu86.top/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好呀"}]}'
```

正常返回：`{"reply":"..."}`

错误码：`rate`（太快）、`busy`（上游忙/额度用完）、`no_key`（没配 key）、`bad_request`（入参不合法）。

## 改人设

改 `index.js` 顶部的 `SYSTEM_PROMPT` 就行——写清楚它叫什么、语气、知道哪些事、不许说什么。
改完重新 deploy。

## 花费参考

`deepseek-chat` 按量计费，一次 2~3 句的回复大约几百个 token。
按你 100~200 元/年的预算，够聊几万条，日常陪聊完全用不完。
记得在 DeepSeek 后台设一个余额提醒，双保险。
