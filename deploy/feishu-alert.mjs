/**
 * 飞书自建应用告警发送器。
 *
 * 为什么不用 Kuma 自带的 Feishu 通知：那个渠道只吃「群自定义机器人」的 webhook URL，
 * 而自建应用走的是另一套鉴权（App ID/Secret 换 tenant_access_token 再调消息 API）。
 * 两种形态互不通用，所以这里单独实现，用 HTTP 接收器挂在 Kuma 的 webhook 上。
 *
 * 环境变量（放服务器 /opt/hangkathon/.env，权限 600）：
 *   FEISHU_APP_ID       自建应用的 App ID（cli_ 开头）
 *   FEISHU_APP_SECRET   自建应用的 App Secret
 *   FEISHU_RECEIVE_ID   接收会话 ID（oc_ 或 ou_ 开头，见 README 说明怎么取）
 *
 * 用法：
 *   node deploy/feishu-alert.mjs "标题" "正文"        # 发一条
 *   node deploy/feishu-alert.mjs --probe               # 只测连通性，不发消息
 *
 * 注意：飞书要求应用至少有一个可见范围（哪怕只有自己），否则发消息会报 230001/99991672。
 */

const API_BASE = "https://open.feishu.cn/open-apis";

async function getTenantToken(appId, appSecret) {
  const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await response.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`取 token 失败：code=${data.code} msg=${data.msg}`);
  }
  return data.tenant_access_token;
}

/**
 * 发一条文本消息。receiveIdType 用 chat_id（群）或 open_id（个人）。
 * 首次试不通就把 FEISHU_RECEIVE_ID_TYPE 设成 open_id 再试。
 */
async function sendText(token, receiveId, receiveIdType, title, body) {
  const response = await fetch(
    `${API_BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: `${title}\n${body}` }),
      }),
    },
  );
  const data = await response.json();
  if (data.code !== 0) throw new Error(`发消息失败：code=${data.code} msg=${data.msg}`);
  return data.data?.message_id ?? "(ok)";
}

const args = process.argv.slice(2);
const probeOnly = args.includes("--probe");
const positional = args.filter((item) => item !== "--probe");
const title = positional[0] ?? "杭客松监控";
const body = positional.slice(1).join(" ") || "（无正文）";

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const receiveId = process.env.FEISHU_RECEIVE_ID;
const receiveIdType = process.env.FEISHU_RECEIVE_ID_TYPE ?? "chat_id";

if (!appId || !appSecret || !receiveId) {
  console.error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_RECEIVE_ID");
  process.exit(2);
}

try {
  const token = await getTenantToken(appId, appSecret);
  console.log("取 token 成功");
  if (probeOnly) {
    console.log(`配置检查通过：app_id=${appId} receive_id=${receiveId} type=${receiveIdType}`);
    process.exit(0);
  }
  const messageId = await sendText(token, receiveId, receiveIdType, title, body);
  console.log(`发送成功：${messageId}`);
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}