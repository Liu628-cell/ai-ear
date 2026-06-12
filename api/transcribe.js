import OpenAI from "openai";
import fs from "fs";
import os from "os";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只支持 POST 请求" });
  }

  try {
    let body = req.body;

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const { audioBase64, mimeType } = body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: "没有收到音频数据" });
    }

    let ext = "webm";
    if (mimeType && mimeType.includes("mp4")) ext = "mp4";
    if (mimeType && mimeType.includes("mpeg")) ext = "mp3";
    if (mimeType && mimeType.includes("wav")) ext = "wav";
    if (mimeType && mimeType.includes("m4a")) ext = "m4a";

    const buffer = Buffer.from(audioBase64, "base64");
    const filePath = path.join(os.tmpdir(), `audio-${Date.now()}.${ext}`);

    fs.writeFileSync(filePath, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-transcribe",
      language: "zh",
      prompt: "这是一段小学生普通话闯关朗读，请转写为简体中文。内容可能包括：老师您好、请大家讲普通话、我爱我的家乡、说好普通话沟通你我他。"
    });

    fs.unlinkSync(filePath);

    return res.status(200).json({
      text: transcription.text || ""
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "语音识别失败",
      detail: error.message
    });
  }
}
