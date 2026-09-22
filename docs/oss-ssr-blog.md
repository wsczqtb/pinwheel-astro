# OSS + ESA SSR 博客部署

## 数据流

```text
ZYPlayer 发布
  -> POST /hooks/zyplayer/<WEBHOOK_TOKEN>
  -> ESA 函数触发 GitHub repository_dispatch
  -> GitHub Actions 拉取文章、转存图片和 Markdown 到 OSS
  -> Actions 更新 src/data/remote-posts.json 并推送
  -> ESA Pages 重新构建首页、列表、分类和 Pagefind 索引

访问 /blog/<slug>
  -> 若 dist 中有旧文章，ESA 直接返回静态 HTML
  -> 否则 ESA 函数从 OSS 读取 blog/posts/<slug>.md 并渲染 HTML
```

`src/data/remote-posts.json` 只保存列表需要的标题、摘要、日期、封面和分类，不保存正文。正文只在 OSS 保存一份，博客框架不会再次请求 OSS；详情请求由 ESA 函数读取 OSS 后直接返回完整 HTML。

## 1. OSS

创建或复用一个 Bucket，并让 `blog/` 路径能够通过 `OSS_PUBLIC_URL` 匿名读取。写权限只交给 GitHub Actions，ESA 函数不保存 OSS AccessKey。

建议使用绑定了 HTTPS 的 CDN 或自定义域名作为 `OSS_PUBLIC_URL`，例如 `https://cdn.example.com`。不要在结尾添加 `/`。

## 2. GitHub Actions Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 添加：

| Secret | 用途 |
| --- | --- |
| `ZYPLAYER_BASE_URL` | ZYPlayer 站点地址 |
| `ZYPLAYER_RSA_PRIVATE_KEY` | API 签名私钥，可保存带 `\n` 的单行值；对应公钥配置在 ZYPlayer「开放接口 RSA 公钥」 |
| `ZYPLAYER_SPACE_ID` | 手动触发时使用的默认空间 ID |
| `ZYPLAYER_ASSET_HOSTS` | 可选，允许转存图片的额外域名，逗号分隔 |
| `OSS_ENDPOINT` | OSS Endpoint |
| `OSS_BUCKET` | Bucket 名称 |
| `OSS_ACCESS_KEY_ID` | 只允许写入目标 Bucket 的 RAM AccessKey |
| `OSS_ACCESS_KEY_SECRET` | 对应的 Secret |
| `OSS_PUBLIC_URL` | OSS/CDN 公开读取地址 |

工作流只提交 `src/data/remote-posts.json`。Markdown 与图片不会进入 Git 仓库。

ZYPlayer Open API 使用 `content` 和 `encrypt` 表单字段。`encrypt` 是对请求内容 SHA-256 后使用 RSA 私钥生成的十六进制签名；工作流不发送 `key` 或 `signature` 字段。

## 3. ESA Pages 变量

在 ESA Pages 项目的函数环境变量中添加：

| 变量 | 用途 |
| --- | --- |
| `OSS_PUBLIC_URL` | 与 GitHub Secret 中的值完全一致 |
| `WEBHOOK_TOKEN` | 自行生成的长随机字符串，放在 webhook URL 路径中 |
| `GITHUB_DISPATCH_TOKEN` | 仅授权此仓库、`Contents: Read and write` 的 fine-grained token |

`esa.jsonc` 已配置静态目录 `dist` 和函数入口 `edge/blog.js`。不要重新加入 `notFoundStrategy: "404Page"`，否则不存在的静态文章路径会直接进入 404，无法交给 SSR 函数。

## 4. ZYPlayer 回调

把发布回调配置为：

```text
https://你的站点域名/hooks/zyplayer/<WEBHOOK_TOKEN>
```

请求方法为 `POST`，JSON 至少包含：

```json
{
  "event": "publish",
  "pageId": "文章ID",
  "spaceId": "空间ID"
}
```

未发布或草稿事件不会上传。当前工作流处理 `publish` 事件；删除和撤回需要另行定义数据保留策略。

## 5. 首次部署与验证

1. 推送本分支并在 ESA Pages 连接该 GitHub 仓库。
2. 确认安装命令为 `pnpm install --frozen-lockfile`，构建命令为 `pnpm build`，产物目录为 `dist`。
3. 在 GitHub Actions 手动运行一次 `Sync ZYPlayer articles`，填写一个已发布的 `page_id` 和 `space_id`。
4. 等待工作流提交索引并由 ESA 完成下一次部署。
5. 检查首页文章卡片、`/blog` 列表、站内搜索和 `/blog/zy-<space>-<page>` 详情页。

仓库中原有的 9 篇 Markdown 继续生成静态详情页，因此迁移期间不会产生旧链接中断；以后新同步的 ZYPlayer 文章只存 OSS。

## 本地检查

```bash
pnpm build
pnpm test:edge
```

`pnpm build` 会生成静态站、SSR HTML 模板和包含远程文章的 Pagefind 索引。若远程索引中的 OSS Markdown 无法读取，构建会直接失败，避免发布一个列表可见但搜索不可用的版本。
