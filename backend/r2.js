const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

async function uploadSelfie(guestId, imageBuffer, contentType = "image/jpeg") {
  const key = `selfies/${guestId}.jpg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

async function uploadPartyPhoto(photoId, imageBuffer, contentType = "image/jpeg") {
  const key = `party/${photoId}.jpg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

async function uploadGuestPhoto(photoId, imageBuffer, contentType = "image/jpeg") {
  const key = `party-whatsapp/${photoId}.jpg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

async function uploadProPhoto(photoId, imageBuffer, contentType = "image/jpeg") {
  const key = `party-pro/${photoId}.jpg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: imageBuffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

async function uploadFile(key, buffer, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

async function getFile(key) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listFiles(prefix) {
  const response = await s3.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix })
  );
  return (response.Contents || []).map((obj) => ({
    key: obj.Key,
    size: obj.Size,
    url: `${PUBLIC_URL}/${obj.Key}`,
  }));
}

module.exports = { uploadSelfie, uploadPartyPhoto, uploadGuestPhoto, uploadProPhoto, uploadFile, getFile, listFiles };
