import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';

const sendMessage = async (botToken, chatId, text, replyMarkup = null) => {
  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const resp = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload);
    return resp.data;
  } catch (err) {
    console.error('Telegram send error:', err.response?.data || err.message);

        const fallbackPayload = {
      chat_id: chatId,
      text,
    };
    if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;

    const resp = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, fallbackPayload);
    return resp.data;
  }
};

const sendMedia = async (botToken, chatId, mediaUrl, caption, type = 'photo') => {
  try {
    const methodMap = {
      image: 'sendPhoto',
      video: 'sendVideo',
      audio: 'sendVoice', 
      file: 'sendDocument',
    };

    const method = methodMap[type] || 'sendDocument';
    const field = type === 'image' ? 'photo' : 
                  type === 'video' ? 'video' :
                  type === 'audio' ? 'voice' : 'document';

    const absolutePath = path.isAbsolute(mediaUrl) ? mediaUrl : path.resolve(process.cwd(), mediaUrl.startsWith('/') ? mediaUrl.substring(1) : mediaUrl);

        if (fs.existsSync(absolutePath)) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append(field, fs.createReadStream(absolutePath));
      if (caption) form.append('caption', caption);
      if (type === 'image' || type === 'video') form.append('parse_mode', 'Markdown');

      const resp = await axios.post(`https://api.telegram.org/bot${botToken}/${method}`, form, {
        headers: {
          ...form.getHeaders(),
        },
      });
      return resp.data;
    } else {

            const resp = await axios.post(`https://api.telegram.org/bot${botToken}/${method}`, {
        chat_id: chatId,
        [field]: mediaUrl,
        caption,
        parse_mode: 'Markdown',
      });
      return resp.data;
    }
  } catch (err) {
    console.error(`Telegram send ${type} error:`, err.response?.data || err.message);
    throw err;
  }
};

const downloadFile = async (botToken, fileId, destFolder) => {
  try {

        const fileResp = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
      params: { file_id: fileId },
    });

    if (!fileResp.data.ok) throw new Error('Failed to get file info from Telegram');
    const filePath = fileResp.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
    });

    const ext = path.extname(filePath);
    const fileName = `${Date.now()}-${fileId.substring(0, 8)}${ext}`;
    const fullFolder = path.resolve(process.cwd(), destFolder);

        if (!fs.existsSync(fullFolder)) {
      fs.mkdirSync(fullFolder, { recursive: true });
    }

    const localPath = path.join(fullFolder, fileName);
    const writer = fs.createWriteStream(localPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve({
        fileName: path.basename(filePath),
        localPath: localPath,
        relativeUrl: `/${destFolder.replace(/\\/g, '/')}${fileName}`,
        mimeType: response.headers['content-type'],
        fileSize: parseInt(response.headers['content-length'] || 0, 10),
      }));
      writer.on('error', reject);
    });
  } catch (err) {
    console.error('Telegram download error:', err.response?.data || err.message);
    throw err;
  }
};

const setWebhook = async (botToken, url, secretToken = null) => {
  const payload = {
    url,
    drop_pending_updates: true,
  };
  if (secretToken) payload.secret_token = secretToken;

  const resp = await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, payload);
  return resp.data;
};

export default {
  sendMessage,
  sendMedia,
  downloadFile,
  setWebhook,
};
