import crypto from "crypto";
import WebSocket from "ws";

const APPID = process.env.XFYUN_APPID;
const API_KEY = process.env.XFYUN_API_KEY;
const API_SECRET = process.env.XFYUN_API_SECRET;

function createAuthUrl() {
  const hostUrl = "wss://iat-api.xfyun.cn/v2/iat";
  const url = new URL(hostUrl);

  const host = url.host;
  const path = url.pathname;
  const date = new Date().toUTCString();

  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  const signature = crypto
    .createHmac("sha256", API_SECRET)
    .update(signatureOrigin)
    .digest("base64");

  const authorizationOrigin = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  const authorization = Buffer
    .from(authorizationOrigin)
    .toString("base64");

  return `${hostUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${host}`;
}

function extractTextFromResult(result) {
  if (!result || !result.ws) return "";

  let text = "";

  for (const item of result.ws) {
    if (item.cw && item.cw.length > 0) {
      text += item.cw[0].w || "";
    }
  }

  return text;
}

function transcribeWithXfyun(pcmBase64) {
  return new Promise((resolve, reject) => {
    if (!APPID || !API_KEY || !API_SECRET) {
      reject(new Error("缺少讯飞环境变量，请检查 XFYUN_APPID、XFYUN_API_KEY、XFYUN_API_SECRET"));
      return;
    }

    const audioBuffer = Buffer.from(pcmBase64, "base64");

    if (!audioBuffer || audioBuffer.length === 0) {
      reject(new Error("没有收到有效音频"));
      return;
    }

    const authUrl = createAuthUrl();
    const ws = new WebSocket(authUrl);

    let finalText = "";
    let frameIndex = 0;
    const frameSize = 1280;
    let sendTimer = null;
    let finished = false;

    ws.on("open", () => {
      sendTimer = setInterval(() => {
        const start = frameIndex * frameSize;
        const end = Math.min(start + frameSize, audioBuffer.length);
        const frame = audioBuffer.slice(start, end);

        if (start >= audioBuffer.length) {
          clearInterval(sendTimer);

          ws.send(JSON.stringify({
            data: {
              status: 2,
              format: "audio/L16;rate=16000",
              encoding: "raw",
              audio: ""
            }
          }));

          return;
        }

        const status = frameIndex === 0 ? 0 : 1;

        const payload = {
          data: {
            status,
            format: "audio/L16;rate=16000",
            encoding: "raw",
            audio: frame.toString("base64")
          }
        };

        if (status === 0) {
          payload.common = {
            app_id: APPID
          };

          payload.business = {
            language: "zh_cn",
            domain: "iat",
            accent: "mandarin",
            dwa: "wpgs",
            ptt: 0
          };
        }

        ws.send(JSON.stringify(payload));
        frameIndex++;
      }, 40);
    });

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.code !== 0) {
          finished = true;
          reject(new Error(data.message || "讯飞识别失败"));
          ws.close();
          return;
        }

        const text = extractTextFromResult(data.data?.result);

        if (text) {
          finalText += text;
        }

        if (data.data && data.data.status === 2) {
          finished = true;
          ws.close();
          resolve(finalText);
        }
      } catch (error) {
        finished = true;
        reject(error);
        ws.close();
      }
    });

    ws.on("error", (error) => {
      if (!finished) {
        finished = true;
        reject(error);
      }
    });

    ws.on("close", () => {
      if (sendTimer) {
        clearInterval(sendTimer);
      }
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "只支持 POST 请求"
    });
  }

  try {
    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const { pcmBase64 } = body || {};

    if (!pcmBase64) {
      return res.status(400).json({
        error: "没有收到 pcmBase64 音频数据"
      });
    }

    const text = await transcribeWithXfyun(pcmBase64);

    return res.status(200).json({
      text: text || ""
    });
  } catch (error) {
    return res.status(500).json({
      error: "语音识别失败",
      detail: error.message
    });
  }
}
