使用 Cloudflare Worker 自动进行 Level Infinite Pass 每日打卡
本项目利用 Cloudflare Workers 的免费额度，实现对 https://pass.levelinfinite.com/ 网站的每日自动打卡（签到），支持多个签到任务和多个账户。脚本能够识别并正确处理“今日已签到”的情况（需要用户根据实际API响应配置）。用户还可以选择性配置 Telegram Bot 来接收打卡结果的通知。

核心功能：

每日自动执行 Level Infinite Pass 的多个签到任务。

智能处理： 当打卡API返回特定错误码/消息（表示“今日已签到”）时，脚本会将其识别为当日任务已完成，并发送相应通知。

部署在 Cloudflare Workers 上，无需自有服务器，充分利用免费资源。

支持为单个或多个账号进行打卡（通过配置不同的 Cookie Secrets）。

可选： 通过 Telegram Bot 实时通知打卡成功、失败或已签到状态。

项目文件：

worker.js (或您指定的其他文件名): 包含 Cloudflare Worker 的执行脚本。

README.md: 本说明文件。

声明：

请确保您的自动化行为没有违反 pass.levelinfinite.com 的服务条款。滥用自动化脚本可能会导致账户被封禁。

本项目仅供学习和技术交流使用，请勿用于非法用途。

网站的登录流程、打卡接口及页面结构可能会发生变化，届时脚本可能需要更新。

准备工作
一个 Cloudflare 账户 (注册地址)。

（可选）如果您希望接收 Telegram 通知，您还需要一个 Telegram 账户。

教程步骤
第一步：获取 Level Infinite Pass 打卡所需的 Cookie 及“已签到”API响应
获取有效 Cookie:

在您的电脑浏览器中打开 https://pass.levelinfinite.com/ 并完成登录。

打开开发者工具 (F12)，切换到 "网络" (Network) 标签页，勾选 "Preserve log"。

刷新页面或在网站内进行任意操作，从一个发往 api-pass.levelinfinite.com 或 pass.levelinfinite.com 的请求的 "Request Headers" 中，找到并完整复制 cookie 字符串。

[浏览器开发者工具网络面板示意图，高亮显示请求头中的 Cookie 字符串]

重要提示： Cookie 有有效期。如果脚本后续运行失败并提示 Cookie 失效，您需要重复步骤 1 获取最新的 Cookie。

第二步：创建和部署 Cloudflare Worker
登录 Cloudflare Dashboard。

创建 Worker 服务:

进入 "Workers & Pages"，点击 "Create application" -> "Create Worker"。

设置 Worker 名称 (例如 levelinfinite-checkin)，然后点击 "Deploy"。

编辑 Worker 代码:

部署成功后，点击 "Quick edit"。

将本项目仓库中的 worker.js (或您指定的脚本文件名) 的内容完整复制并粘贴到 Cloudflare Worker 编辑器中，替换掉原有的默认代码。

点击 "Save and Deploy"。

第三步：配置 Cloudflare Worker Secrets (环境变量)
在您的 Worker 页面，导航到 "Settings" -> "Variables"。

在 "Environment Variables" (Secrets) 部分，添加以下 Secrets：

账户 Cookie(s):

脚本默认会尝试读取名为 LEVEL_INFINITE_COOKIE_1, LEVEL_INFINITE_COOKIE_2, ... 的 Secrets。

为您的第一个账号添加：

Variable name: LEVEL_INFINITE_COOKIE_1

Value: 粘贴您为第一个账号获取到的完整 cookie 字符串。

点击 "Encrypt" (加密) 并保存。

如果有更多账号，依次添加 LEVEL_INFINITE_COOKIE_2, LEVEL_INFINITE_COOKIE_3 等。请确保脚本中的 MAX_ACCOUNTS 常量（如果脚本中有此设置，通常默认为20）足够大。

可选：Telegram 通知配置

如果您希望使用 Telegram 通知功能，请先创建 Telegram Bot 并获取其 Token 和您的 Chat ID。

创建 Bot 并获取 Token: 在 Telegram 中搜索 "BotFather"，发送 /newbot 命令并按提示操作，获取 HTTP API Token。

获取 Chat ID: 向您创建的 Bot 发送一条消息，然后通过 "userinfobot" 或 API https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates 获取您的 Chat ID。

添加以下 Secrets：

Variable name: TELEGRAM_BOT_TOKEN (值为您的 Bot Token)

Variable name: TELEGRAM_CHAT_ID (值为您的 Chat ID)

均需加密保存。

[Cloudflare Worker Secrets 配置界面示意图]

第四步：配置 Cron Trigger (定时触发器)
在 Worker 的 "Settings" -> "Triggers" 页面，点击 "Add Cron Trigger"。

Cron 表达式: 设置每日执行时间 (基于 UTC)。例如，北京/新加坡时间 (UTC+8) 早上 8:05 执行，则 Cron 为 5 0 * * *。

[Cloudflare Worker Cron Trigger 配置界面示意图]

第五步：测试和使用
手动触发测试:

访问 Worker 的 URL 并在末尾加上 /manual-checkin (例如: https://<您的Worker名称>.<您的子域名>.workers.dev/manual-checkin)。

查看浏览器返回的 JSON 结果和（如果配置了）Telegram 通知。Telegram 通知现在应该是包含所有任务结果的汇总消息。

查看日志:

在 Cloudflare Worker 的 "Logs" 标签页查看脚本运行日志。

监控定时任务。

第六步：维护
Cookie 有效期: Cookie 过期后，需按【第一步】重新获取并更新对应的 LEVEL_INFINITE_COOKIE_X Secret。

网站接口/逻辑变更: 如果网站的打卡 API 或“已签到”的判断逻辑发生变化，worker.js 脚本中 CHECKIN_TASKS 的配置可能需要更新。您需要重新进行抓包分析并修改脚本。

任务 task_id 的变化： 脚本中 CHECKIN_TASKS 数组里每个任务的 body 中通常包含 task_id。如果这些ID发生变化，您需要通过抓包找到新的 task_id 并更新 worker.js 脚本中对应任务的 body 部分。

License
本项目采用 MIT License 
