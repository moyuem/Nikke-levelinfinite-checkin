// Cloudflare Worker Script for Level Infinite Pass Auto Check-in
// Supports multiple accounts, optional Telegram notifications (summarized),
// and handles "system error" as potentially "already checked-in".
// Version: v12

// CONFIGURATION:
// Set MAX_ACCOUNTS to the highest number X for your LEVEL_INFINITE_COOKIE_X secrets
const MAX_ACCOUNTS = 20; // Example: if you have COOKIE_1 to COOKIE_5, 5 or more is fine.

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
        'Cloudflare Worker for Level Infinite Pass Check-in. Access /manual-checkin to trigger for all configured accounts.',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    );
  }
});

// --- Optional: Telegram Notification Function ---
/**
 * Sends a single summarized Telegram notification.
 * @param {string} title - The title of the notification.
 * @param {string} summaryMessageText - The fully formatted summary message body.
 */
async function sendTelegramSummaryNotification(title, summaryMessageText) {
  const botToken = globalThis.TELEGRAM_BOT_TOKEN; // Read from Secrets
  const chatId = globalThis.TELEGRAM_CHAT_ID;     // Read from Secrets

  if (!botToken || !chatId) {
    console.log(`Telegram notification skipped (Token or Chat ID not configured). Title: ${title}`);
    return;
  }

  const fullMessage = `**${title}**\n\n${summaryMessageText}`;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: fullMessage,
    parse_mode: 'Markdown'
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
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
  const allResults = [];
  const cookiesArray = getCookiesFromSecrets();
  const notificationTitle = `LIP 打卡报告 - ${triggerType}`;
  let summaryMessageLines = [];

  if (cookiesArray.length === 0) {
    const noCookieMsg = "没有从 Secrets 中找到任何 LEVEL_INFINITE_COOKIE_X 配置。";
    console.log(noCookieMsg);
    summaryMessageLines.push(`系统通知: ${noCookieMsg}`);
    await sendTelegramSummaryNotification(notificationTitle, summaryMessageLines.join('\n'));
    return [{ account: "系统配置", success: false, message: noCookieMsg }];
  }

  console.log(`发现 ${cookiesArray.length} 个账号配置。开始处理 ${triggerType}...`);

  for (let i = 0; i < cookiesArray.length; i++) {
    const cookie = cookiesArray[i];
    const accountIdentifier = `账号 ${i + 1}`;
    console.log(`[${accountIdentifier}] Starting process.`);

    let result;
    let icon = "❓"; // Default icon

    try {
      result = await doCheckIn(cookie, accountIdentifier);
      if (result.isAlreadyCheckedIn) {
        icon = "ℹ️"; // Info for "already checked-in" or "system error possibly checked-in"
      } else if (result.success) {
        icon = "✅"; // Success
      } else {
        icon = "❌"; // Failure
      }
      summaryMessageLines.push(`${accountIdentifier}: ${icon} ${result.message}`);
    } catch (error) {
      console.error(`[${accountIdentifier}] Error during overall processing:`, error);
      result = { success: false, message: `执行错误: ${error.message}`, details: error.stack, httpStatus: 500, isAlreadyCheckedIn: false };
      icon = "🆘"; // System/Execution error
      summaryMessageLines.push(`${accountIdentifier}: ${icon} ${result.message}`);
    }
    allResults.push({ account: accountIdentifier, ...result });
  }

  // Add timestamp to the summary
  const timestamp = `\n\n⏰ 时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  const finalSummaryMessage = summaryMessageLines.join('\n') + timestamp;

  await sendTelegramSummaryNotification(notificationTitle, finalSummaryMessage);

  return allResults;
}

async function handleManualTrigger(event) {
  console.log('Manual check-in for all accounts started...');
  const results = await processAllAccounts("手动触发");
  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status: results.every(r => r.success || r.isAlreadyCheckedIn) ? 200 : (results.some(r => r.success || r.isAlreadyCheckedIn) ? 207 : 500),
  });
}

async function handleScheduled() {
  console.log('Scheduled check-in for all accounts started...');
  await processAllAccounts("定时任务");
}

/**
 * Core function to perform the check-in operation for a single account.
 * @param {string} cookie - The cookie string for the account.
 * @param {string} accountIdentifier - Identifier for logging/notification.
 * @returns {Promise<Object>} An object containing the check-in result, including `isAlreadyCheckedIn` boolean.
 */
async function doCheckIn(cookie, accountIdentifier) {
  const CHECKIN_URL = 'https://api-pass.levelinfinite.com/api/rewards/proxy/lipass/Points/DailyCheckIn';
  const REQUEST_METHOD = 'POST';
  const REQUEST_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-HK,zh;q=0.9', // From user's browser
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
  const REQUEST_BODY = JSON.stringify({ task_id: "15" }); // Ensure this task_id is correct
  const requestOptions = { method: REQUEST_METHOD, headers: REQUEST_HEADERS, body: REQUEST_BODY };

  console.log(`[${accountIdentifier}] Attempting check-in to: ${CHECKIN_URL}`);

  try {
    const response = await fetch(CHECKIN_URL, requestOptions);
    const responseText = await response.text();
    const httpStatus = response.status;
    console.log(`[${accountIdentifier}] Check-in API response status: ${httpStatus}`);
    console.log(`[${accountIdentifier}] Check-in API response body (raw): ${responseText.substring(0, 300)}...`);

    let checkInSuccess = false;
    let message = `请求完成。响应状态码: ${httpStatus}.`;
    let responseData = null;
    let isAlreadyCheckedIn = false;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.warn(`[${accountIdentifier}] Check-in response body is not valid JSON: ${responseText}`);
    }

    if (responseData) {
      // Case 1: Standard successful check-in
      if (response.ok && responseData.code === 0 && responseData.msg === "ok") {
        checkInSuccess = true;
        message = `API 消息: ${responseData.msg}`;
        if (responseData.data && typeof responseData.data.status !== 'undefined') {
          message += ` | 数据状态: ${responseData.data.status}`;
        }
      }
      // Case 2: Specific "system error" that might mean "already checked-in"
      else if (responseData.code === 1001009 && responseData.msg && responseData.msg.toLowerCase().includes("system error")) {
        checkInSuccess = false; // It's still a system error, not a confirmed success
        isAlreadyCheckedIn = true; // But we treat it as "possibly already checked-in" for notification
        message = `system error，今日可能已签到 (API Code: ${responseData.code})`;
        console.log(`[${accountIdentifier}] Detected 'system error 1001009' from DailyCheckIn API response.`);
      }
      // Case 3: Other "already checked-in" scenarios (user needs to provide this specific code/msg)
      // TODO: IMPORTANT! Replace 'YOUR_ACTUAL_ALREADY_CHECKED_IN_CODE' and/or message check
      //       with the *actual* code and/or message from the DailyCheckIn API
      //       when trying to check in for an ALREADY CHECKED-IN account if it's different from 1001009.
      //       Example: else if (responseData.code === 20010)
      else if (responseData.code === 12345 || (responseData.msg && responseData.msg.toLowerCase().includes("已签到")) || (responseData.msg && responseData.msg.toLowerCase().includes("repeated operation"))) {
        // THIS IS A PLACEHOLDER for a more specific "already checked-in" response - UPDATE WITH ACTUAL VALUES!
        checkInSuccess = true; // Treat "already checked-in" as a success for the day's automation
        isAlreadyCheckedIn = true;
        message = `今日已签到 (API返回: code=${responseData.code}, msg='${responseData.msg}')`;
        console.log(`[${accountIdentifier}] Detected specific 'already checked-in' from DailyCheckIn API response.`);
      }
      // Case 4: Other failures
      else {
        checkInSuccess = false;
        message = `API Code: ${responseData.code || 'N/A'}, API Message: ${responseData.msg || responseData.message || 'No specific message'}`;
      }
    } else if (response.ok) { // HTTP OK, but no valid JSON
      checkInSuccess = false;
      message = `请求成功 (HTTP ${httpStatus})，但响应内容不是有效的JSON。原始响应: ${responseText.substring(0,100)}...`;
    } else { // HTTP error
      checkInSuccess = false;
      message = `HTTP 状态码: ${httpStatus}.`;
      if (responseText) {
        message += ` 响应片段: ${responseText.substring(0, 100)}...`;
      }
    }

    if (!checkInSuccess && !isAlreadyCheckedIn && (httpStatus === 401 || httpStatus === 403)) {
      message += ' (通常表示 Cookie 失效或权限不足，请更新此账号的 Cookie)。';
    }

    return { success: checkInSuccess, message: message, details: responseData || responseText, httpStatus: httpStatus, isAlreadyCheckedIn: isAlreadyCheckedIn };

  } catch (error) {
    console.error(`[${accountIdentifier}] Network error or internal script error during fetch:`, error);
    return { success: false, message: `网络或脚本错误: ${error.message}`, details: error.stack, httpStatus: 500, isAlreadyCheckedIn: false };
  }
}
