// Cloudflare Worker Script for Level Infinite Pass Auto Check-in
// Version: v16 (Treats DailyCheckIn code 1001009 as "already checked-in" with concise message)

// CONFIGURATION:
const MAX_ACCOUNTS = 20;

// --- Define Check-in Tasks ---
const CHECKIN_TASKS = [
  {
    name: "每日签到", // Task 1 Name (DailyCheckIn)
    url: 'https://api-pass.levelinfinite.com/api/rewards/proxy/lipass/Points/DailyCheckIn',
    method: 'POST',
    body: JSON.stringify({ task_id: "15" }),
    success_code: 0,
    success_msg_keyword: "ok",
    // Treat code 1001009 as "already checked-in" for this task
    already_checked_in_code: 1001009,
    already_checked_in_msg_keywords: ["system error"], // Match if msg contains "system error" for code 1001009
    system_error_is_possibly_checked_in_code: null // Set to null as 1001009 is now handled by already_checked_in_code
  },
  {
    name: "阶段签到", // Task 2 Name (DailyStageCheckIn)
    url: 'https://api-pass.levelinfinite.com/api/rewards/proxy/lipass/Points/DailyStageCheckIn',
    method: 'POST',
    body: JSON.stringify({ task_id: "58" }),
    success_code: 0,
    success_msg_keyword: "ok",
    already_checked_in_code: 1002007,
    already_checked_in_msg_keywords: ["already sign in today", "stagetaskallcomplete"],
    system_error_is_possibly_checked_in_code: null
  }
  // Add more task objects here if needed
];

// --- Event Listeners ---
addEventListener('scheduled', event => {
  event.waitUntil(handleScheduled());
});

addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/manual-checkin') {
    event.respondWith(handleManualTrigger(event));
  } else {
    event.respondWith(
      new Response(
        'Cloudflare Worker for Level Infinite Pass Check-in. Access /manual-checkin to trigger.',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    );
  }
});

// --- Optional: Telegram Notification Function ---
async function sendTelegramSummaryNotification(title, summaryMessageText) {
  const botToken = globalThis.TELEGRAM_BOT_TOKEN;
  const chatId = globalThis.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log(`Telegram notification skipped (Token or Chat ID not configured). Title: ${title}`);
    return;
  }
  const fullMessage = `**${title}**\n\n${summaryMessageText}`;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = { chat_id: chatId, text: fullMessage, parse_mode: 'Markdown' };
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const responseData = await response.json();
    if (response.ok && responseData.ok) {
      console.log(`Telegram summary notification sent successfully. Title: ${title}`);
    } else {
      console.error(`Failed to send Telegram summary notification. Title: ${title}`, responseData);
    }
  } catch (error) {
    console.error(`Network error sending Telegram summary notification. Title: ${title}`, error);
  }
}

// --- Core Logic ---
function getCookiesFromSecrets() {
  const cookiesArray = [];
  for (let i = 1; i <= MAX_ACCOUNTS; i++) {
    const secretName = `LEVEL_INFINITE_COOKIE_${i}`;
    const cookieValue = globalThis[secretName];
    if (cookieValue && typeof cookieValue === 'string' && cookieValue.trim() !== '') {
      cookiesArray.push(cookieValue);
    } else {
      break;
    }
  }
  return cookiesArray;
}

async function processAllAccounts(triggerType) {
  const cookiesArray = getCookiesFromSecrets();
  const notificationTitle = `LIP 多任务打卡报告 - ${triggerType}`;
  let summaryMessageLines = [];

  if (cookiesArray.length === 0) {
    const noCookieMsg = "没有从 Secrets 中找到任何 LEVEL_INFINITE_COOKIE_X 配置。";
    console.log(noCookieMsg);
    summaryMessageLines.push(`系统通知: ${noCookieMsg}`);
    await sendTelegramSummaryNotification(notificationTitle, summaryMessageLines.join('\n'));
    return [{ overall_status: "config_error", message: noCookieMsg }];
  }
  console.log(`发现 ${cookiesArray.length} 个账号配置。开始处理 ${triggerType}...`);
  for (let i = 0; i < cookiesArray.length; i++) {
    const cookie = cookiesArray[i];
    const accountIdentifier = `账号 ${i + 1}`;
    summaryMessageLines.push(`\n--- ${accountIdentifier} ---`);
    for (const task of CHECKIN_TASKS) {
      console.log(`[${accountIdentifier}] Starting task: ${task.name}`);
      let taskResult;
      let icon = "❓";
      try {
        taskResult = await executeSingleTask(cookie, task, accountIdentifier);
        if (taskResult.isAlreadyCheckedIn) {
          icon = "ℹ️";
        } else if (taskResult.success) {
          icon = "✅";
        } else {
          icon = "❌";
        }
        summaryMessageLines.push(`${task.name}: ${icon} ${taskResult.message}`);
      } catch (error) {
        console.error(`[${accountIdentifier}] Error during task ${task.name}:`, error);
        taskResult = { success: false, message: `执行错误: ${error.message}`, isAlreadyCheckedIn: false };
        icon = "🆘";
        summaryMessageLines.push(`${task.name}: ${icon} ${taskResult.message}`);
      }
    }
  }
  const timestamp = `\n\n⏰ 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  const finalSummaryMessage = summaryMessageLines.join('\n') + timestamp;
  await sendTelegramSummaryNotification(notificationTitle, finalSummaryMessage);
  return [{ overall_status: "completed_processing", accounts_processed: cookiesArray.length }];
}

async function handleManualTrigger(event) {
  console.log('Manual check-in for all accounts and tasks started...');
  const resultsSummary = await processAllAccounts("手动触发");
  return new Response(JSON.stringify(resultsSummary, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status: 200,
  });
}

async function handleScheduled() {
  console.log('Scheduled check-in for all accounts and tasks started...');
  await processAllAccounts("定时任务");
}

async function executeSingleTask(cookie, taskConfig, accountIdentifier) {
  const { name: taskName, url: taskUrl, method: taskMethod, body: taskBody,
          success_code, success_msg_keyword,
          already_checked_in_code, already_checked_in_msg_keywords,
          system_error_is_possibly_checked_in_code } = taskConfig;

  const REQUEST_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-HK,zh;q=0.9',
    'Content-Type': 'application/json',
    'Cookie': cookie,
    'Origin': 'https://pass.levelinfinite.com',
    'Referer': 'https://pass.levelinfinite.com/',
    'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'X-Channel-Type': '1',
    'X-Common-Params': '{"game_id":"4","area_id":"global","source":"pc_web","lip_region":"392","env":"sg"}',
    'X-Language': 'zh',
  };
  const requestOptions = { method: taskMethod, headers: REQUEST_HEADERS, body: taskBody };

  console.log(`[${accountIdentifier}] Task '${taskName}': Attempting request to ${taskUrl}`);

  try {
    const response = await fetch(taskUrl, requestOptions);
    const responseText = await response.text();
    const httpStatus = response.status;
    console.log(`[${accountIdentifier}] Task '${taskName}': API response status: ${httpStatus}`);
    console.log(`[${accountIdentifier}] Task '${taskName}': API response body (raw): ${responseText.substring(0, 300)}...`);

    let taskSuccess = false;
    let message = `请求完成。状态码: ${httpStatus}.`;
    let responseData = null;
    let isAlreadyCheckedIn = false;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.warn(`[${accountIdentifier}] Task '${taskName}': Response body not valid JSON: ${responseText}`);
    }

    if (responseData) {
      // 1. Check for standard success
      if (response.ok && responseData.code === success_code &&
          (success_msg_keyword === null || (responseData.msg && responseData.msg.toLowerCase().includes(success_msg_keyword.toLowerCase())))) {
        taskSuccess = true;
        message = `API 消息: ${responseData.msg || '操作成功'}`;
        if (responseData.data && typeof responseData.data.status !== 'undefined') {
          message += ` | 数据状态: ${responseData.data.status}`;
        }
      }
      // 2. Check for "already checked-in" specific to this task
      // This now also explicitly handles code 1001009 for "每日签到" as "already checked-in"
      else if (responseData.code === already_checked_in_code ||
               (already_checked_in_msg_keywords && already_checked_in_msg_keywords.some(keyword => responseData.msg && responseData.msg.toLowerCase().includes(keyword.toLowerCase())))) {
        taskSuccess = true; // From automation perspective, it's done
        isAlreadyCheckedIn = true;
        // MODIFIED: Concise message for "already checked-in"
        if ((taskName === "阶段签到" && responseData.code === 1002007) || (taskName === "每日签到" && responseData.code === 1001009)) {
            message = `今日已完成此任务 (API Code: ${responseData.code})`;
        } else { // Fallback for other already_checked_in_code scenarios if any
            message = `今日已完成此任务 (API: code=${responseData.code}, msg='${responseData.msg}')`;
        }
        console.log(`[${accountIdentifier}] Task '${taskName}': Detected 'already checked-in' (Code: ${responseData.code}).`);
      }
      // 3. Check for task-specific "system error possibly checked-in" (now less likely to be hit if 1001009 is in already_checked_in_code)
      else if (system_error_is_possibly_checked_in_code && responseData.code === system_error_is_possibly_checked_in_code) {
        taskSuccess = false; // Still an error
        isAlreadyCheckedIn = true; // But flag for notification
        message = `system error，此任务今日可能已完成 (API Code: ${responseData.code})`;
        console.log(`[${accountIdentifier}] Task '${taskName}': Detected system error ${system_error_is_possibly_checked_in_code} as possibly already checked-in.`);
      }
      // 4. Other failures
      else {
        taskSuccess = false;
        message = `API Code: ${responseData.code || 'N/A'}, API Message: ${responseData.msg || responseData.message || '未知错误'}`;
      }
    } else if (response.ok) {
      taskSuccess = false;
      message = `请求成功 (HTTP ${httpStatus})，但响应内容不是有效的JSON。原始响应: ${responseText.substring(0,100)}...`;
    } else {
      taskSuccess = false;
      message = `HTTP 状态码: ${httpStatus}.`;
      if (responseText) {
        message += ` 响应片段: ${responseText.substring(0, 100)}...`;
      }
    }

    if (!taskSuccess && !isAlreadyCheckedIn && (httpStatus === 401 || httpStatus === 403)) {
      message += ' (通常表示 Cookie 失效或权限不足，请更新此账号的 Cookie)。';
    }

    return { success: taskSuccess, message: message, details: responseData || responseText, httpStatus: httpStatus, isAlreadyCheckedIn: isAlreadyCheckedIn };

  } catch (error) {
    console.error(`[${accountIdentifier}] Task '${taskName}': Network error or internal script error:`, error);
    return { success: false, message: `网络或脚本错误: ${error.message}`, details: error.stack, httpStatus: 500, isAlreadyCheckedIn: false };
  }
}
