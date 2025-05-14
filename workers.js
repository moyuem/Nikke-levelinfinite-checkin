// 监听 Cloudflare 的 Cron 调度事件，用于定时自动执行
addEventListener('scheduled', event => {
  event.waitUntil(handleScheduled());
});

// 监听 HTTP Fetch 事件，允许通过访问特定 URL 手动触发打卡，方便测试
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/manual-checkin') {
    event.respondWith(handleManualTrigger(event));
  } else {
    event.respondWith(
      new Response(
        'Cloudflare Worker for Level Infinite Pass Check-in. Access /manual-checkin to trigger manually.',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    );
  }
});

/**
 * 发送 Telegram 通知的函数
 * @param {string} messageText - 要发送的消息内容
 * @param {boolean} isSuccess - 标记消息是否为成功通知 (用于格式化)
 */
async function sendTelegramNotification(messageText, isSuccess = true) {
  const botToken = TELEGRAM_BOT_TOKEN; // 从 Secrets 获取
  const chatId = TELEGRAM_CHAT_ID;     // 从 Secrets 获取

  if (!botToken || !chatId) {
    console.error('Telegram Bot Token 或 Chat ID 未在 Secrets 中配置，跳过发送通知。');
    return;
  }

  const prefix = isSuccess ? "✅ 打卡成功" : "❌ 打卡失败";
  const fullMessage = `${prefix}\n\n${messageText}`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: fullMessage,
    parse_mode: 'Markdown' // 可选: Markdown, HTML
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();
    if (response.ok && responseData.ok) {
      console.log('Telegram 通知已成功发送。');
    } else {
      console.error('发送 Telegram 通知失败:', responseData);
    }
  } catch (error) {
    console.error('发送 Telegram 通知时发生网络错误:', error);
  }
}


/**
 * 处理手动触发的请求，并返回 JSON 响应
 */
async function handleManualTrigger(event) {
  let result;
  try {
    result = await doCheckIn();
    // 手动触发时也发送通知 (可选)
    await sendTelegramNotification(`手动触发结果: ${result.message}`, result.success);

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: result.success ? 200 : (result.httpStatus || 500),
    });
  } catch (error) {
    console.error('Error during manual trigger:', error);
    await sendTelegramNotification(`手动触发执行错误: ${error.message}`, false);
    return new Response(JSON.stringify({ success: false, message: error.message, error: error.stack }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    });
  }
}

/**
 * 处理定时任务 (Cron Trigger)
 */
async function handleScheduled() {
  console.log('Scheduled check-in started...');
  let result;
  try {
    result = await doCheckIn();
    if (result.success) {
      console.log('Scheduled Check-in successful:', result.message);
      await sendTelegramNotification(`定时任务结果: ${result.message}`, true);
    } else {
      console.error('Scheduled Check-in failed:', result.message, result.details || '');
      await sendTelegramNotification(`定时任务结果: ${result.message}\n详情: ${JSON.stringify(result.details, null, 2)}`, false);
    }
  } catch (error) {
    console.error('Error during scheduled check-in execution:', error);
    await sendTelegramNotification(`定时任务执行错误: ${error.message}`, false);
  }
}

/**
 * 执行打卡操作的核心函数
 */
async function doCheckIn() {
  const cookie = LEVEL_INFINITE_COOKIE; // 从 Secrets 获取

  if (!cookie) {
    const errorMessage = '错误：LEVEL_INFINITE_COOKIE 未在 Worker Secrets 中设置。请在 Cloudflare 控制台配置。';
    console.error(errorMessage);
    return { success: false, message: errorMessage, httpStatus: 500 };
  }

  const CHECKIN_URL = 'https://api-pass.levelinfinite.com/api/rewards/proxy/lipass/Points/DailyCheckIn';
  const REQUEST_METHOD = 'POST';

  const REQUEST_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-HK,zh;q=0.9,tr;q=0.8,ja;q=0.7,en-US;q=0.6,en;q=0.5,zh-CN;q=0.4,zh-TW;q=0.3',
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

  const REQUEST_BODY = JSON.stringify({
    task_id: "15"
  });

  const requestOptions = {
    method: REQUEST_METHOD,
    headers: REQUEST_HEADERS,
    body: REQUEST_BODY,
  };

  console.log(`准备发起打卡请求到: ${CHECKIN_URL} 使用方法: ${REQUEST_METHOD}`);
  // console.log(`请求头: ${JSON.stringify(REQUEST_HEADERS, null, 2)}`); // 避免在日志中打印完整的 Cookie
  console.log(`请求体: ${REQUEST_BODY}`);

  try {
    const response = await fetch(CHECKIN_URL, requestOptions);
    const responseText = await response.text();

    console.log(`打卡 API 响应状态码: ${response.status}`);
    console.log(`打卡 API 响应体 (原始文本): ${responseText}`);

    let checkInSuccess = false;
    let message = `请求完成。响应状态码: ${response.status}.`;
    let responseData = null;
    let httpStatus = response.status;

    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.warn('响应体不是有效的 JSON 格式。将作为纯文本处理。');
    }

    if (responseData) {
      if (response.ok && responseData.code === 0 && responseData.msg === "ok") {
        checkInSuccess = true;
        message = `API 消息: ${responseData.msg}`;
        if (responseData.data && typeof responseData.data.status !== 'undefined') {
            message += ` | 数据状态: ${responseData.data.status}`;
        }
      } else {
        message = `API Code: ${responseData.code || 'N/A'}, API Message: ${responseData.msg || responseData.message || 'No message'}`;
      }
    } else if (response.ok) {
        message = `请求成功 (HTTP ${response.status})，但响应内容不是预期的JSON格式或解析失败。`;
        console.warn('Response was OK but not valid JSON or parsing failed.');
    } else {
        message = `HTTP 状态码: ${response.status}.`;
        if (responseText) {
            message += ` 响应: ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`; // 截断过长的响应
        }
    }
    
    if (response.status === 401 || response.status === 403) {
        message += ' (通常表示 Cookie 失效或权限不足，请更新 Cookie)。';
    }

    return { success: checkInSuccess, message: message, details: responseData || responseText, httpStatus: httpStatus };

  } catch (error) {
    console.error('执行 fetch 操作时发生网络错误或脚本内部错误:', error);
    return { success: false, message: `网络或脚本错误: ${error.message}`, details: error.stack, httpStatus: 500 };
  }
}
    