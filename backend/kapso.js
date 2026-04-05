const { WhatsAppClient } = require("@kapso/whatsapp-cloud-api");

const client = new WhatsAppClient({
  apiKey: process.env.KAPSO_API_KEY,
});

const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

async function sendTextMessage(to, text) {
  return client.messages.send(phoneNumberId, {
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendImageMessage(to, imageUrl, caption) {
  return client.messages.send(phoneNumberId, {
    to,
    type: "image",
    image: { link: imageUrl, caption },
  });
}

async function getMediaUrl(mediaId) {
  const response = await client.media.getUrl(phoneNumberId, mediaId);
  return response.url;
}

async function downloadMedia(mediaId) {
  const response = await client.media.download(phoneNumberId, mediaId);
  return response;
}

module.exports = {
  sendTextMessage,
  sendImageMessage,
  getMediaUrl,
  downloadMedia,
};
