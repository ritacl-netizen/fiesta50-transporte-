const { WhatsAppClient } = require("@kapso/whatsapp-cloud-api");

const client = new WhatsAppClient({
  kapsoApiKey: process.env.KAPSO_API_KEY,
  baseUrl: "https://app.kapso.ai/api/meta/",
});

const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

async function sendTextMessage(to, text) {
  return client.messages.sendText({
    phoneNumberId,
    to,
    body: text,
  });
}

async function sendImageMessage(to, imageUrl, caption) {
  return client.messages.sendImage({
    phoneNumberId,
    to,
    link: imageUrl,
    caption,
  });
}

async function downloadMediaFromUrl(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  sendTextMessage,
  sendImageMessage,
  downloadMediaFromUrl,
};
