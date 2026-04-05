require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const kapso = require("./kapso");
const sheets = require("./sheets");
const r2 = require("./r2");

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "fiesta50-fotos" });
});

// Kapso webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.KAPSO_WEBHOOK_SECRET) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Conversation states per phone number:
// - AWAITING_PARTNER_PHONE: waiting for partner's phone number
// - COLLECTING_PHOTOS: accepting party photos from guest
const conversationState = new Map();

// Track photo counts in memory per phone
const photoCounters = new Map();

// Kapso webhook (POST) - incoming messages
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        if (!value || !value.messages) continue;
        for (const message of value.messages) {
          await handleIncomingMessage(message, value.metadata);
        }
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

async function handleIncomingMessage(message, metadata) {
  const from = message.from;
  const messageType = message.type;

  console.log(`Message from ${from}, type: ${messageType}`);

  const guest = await sheets.findGuestByPhone(from);
  if (!guest) {
    await kapso.sendTextMessage(
      from,
      "Hola! No encontre tu numero en la lista de invitados. Verifica que este sea el numero registrado en la invitacion."
    );
    return;
  }

  const isPartner = guest.partnerPhone === sheets.normalizePhone(from);
  const state = conversationState.get(from);
  const name = isPartner ? guest.partnerName : guest.mainName;
  const hasSelfie = isPartner ? guest.selfiePartner : guest.selfieMain;

  // Handle photo messages
  if (messageType === "image") {
    if (!hasSelfie) {
      await handleSelfieReceived(from, message, guest, isPartner, name);
    } else {
      await handleGuestPhotoReceived(from, message, guest, isPartner, name);
    }
    return;
  }

  // Handle text messages
  if (messageType === "text") {
    const text = message.text.body.trim();
    const textLower = text.toLowerCase();

    // Check if they're sending a phone number for their partner
    if (state === "AWAITING_PARTNER_PHONE") {
      const phoneMatch = text.replace(/[\s\-\(\)\.+]/g, "");
      if (phoneMatch.length >= 8) {
        await sheets.setPartnerPhone(guest.rowIndex, phoneMatch);
        conversationState.set(from, "COLLECTING_PHOTOS");
        await kapso.sendTextMessage(
          from,
          `Perfecto! Ya tengo el numero de ${guest.partnerName}. Le voy a escribir para pedirle su selfie.\n\nMientras tanto, si tenes fotos de la fiesta podes mandarmelas y las sumo al album de todos!`
        );
        const partnerPhone = phoneMatch.replace(/[\s\-\(\)\.+]/g, "");
        await requestSelfie(partnerPhone, guest.partnerName);
        return;
      }
    }

    // If they say "listo"/"fin"/"ya" while collecting photos
    if (state === "COLLECTING_PHOTOS" && ["listo", "fin", "ya", "termine"].includes(textLower)) {
      conversationState.delete(from);
      await kapso.sendTextMessage(
        from,
        `Gracias ${name}! Despues de la fiesta te mando el link a tu album personalizado.`
      );
      return;
    }

    // Default responses
    if (!hasSelfie) {
      await kapso.sendTextMessage(
        from,
        `Hola ${name}! Mandame una selfie tuya para armar tu album personalizado de fotos de la fiesta.`
      );
    } else {
      await kapso.sendTextMessage(
        from,
        `Hola ${name}! Ya tengo tu selfie. Si tenes fotos de la fiesta, mandalas y las sumo al album de todos! Cuando termines, manda "listo".`
      );
    }
    return;
  }
}

async function handleSelfieReceived(from, message, guest, isPartner, name) {
  const mediaId = message.image.id;

  try {
    let guestId = guest.guestId;
    if (!guestId) {
      guestId = generateGuestId(guest.mainName);
      await sheets.setGuestId(guest.rowIndex, guestId);
    }

    const personId = isPartner ? generateGuestId(guest.partnerName) : guestId;

    const mediaBuffer = await kapso.downloadMedia(mediaId);
    const url = await r2.uploadSelfie(personId, mediaBuffer);
    console.log(`Selfie saved for ${name}: ${url}`);

    await sheets.markSelfieReceived(guest.rowIndex, isPartner);

    conversationState.set(from, "COLLECTING_PHOTOS");

    await kapso.sendTextMessage(
      from,
      `Recibida tu selfie, ${name}! Despues de la fiesta te mando el link a tu album personalizado.\n\nSi tenes fotos de la fiesta, mandalas y las sumo al album de todos!`
    );

    // If main guest has a partner without selfie, ask for phone or request directly
    if (!isPartner && guest.partnerName && !guest.selfiePartner) {
      if (guest.partnerPhone) {
        await requestSelfie(guest.partnerPhone, guest.partnerName);
      } else {
        conversationState.set(from, "AWAITING_PARTNER_PHONE");
        await kapso.sendTextMessage(
          from,
          `Tambien necesito una selfie de ${guest.partnerName} para armarle su album. Pasame su numero de WhatsApp asi le escribo directamente.`
        );
      }
    }
  } catch (error) {
    console.error(`Error processing selfie from ${name}:`, error);
    await kapso.sendTextMessage(
      from,
      "Hubo un error al procesar tu foto. Podes intentar mandandola de nuevo?"
    );
  }
}

async function handleGuestPhotoReceived(from, message, guest, isPartner, name) {
  const mediaId = message.image.id;

  try {
    const counter = (photoCounters.get(from) || 0) + 1;
    photoCounters.set(from, counter);

    const timestamp = Date.now();
    const photoId = `guest-${from}-${timestamp}-${counter}`;

    const mediaBuffer = await kapso.downloadMedia(mediaId);
    const url = await r2.uploadGuestPhoto(photoId, mediaBuffer);
    console.log(`Guest photo saved from ${name}: ${url}`);

    await sheets.incrementPhotoCount(guest.rowIndex, isPartner);

    // Confirm first photo, then every 5th photo (avoid spam)
    if (counter === 1) {
      await kapso.sendTextMessage(
        from,
        `Foto recibida! Segui mandando las que quieras. Cuando termines, manda "listo".`
      );
    } else if (counter % 5 === 0) {
      await kapso.sendTextMessage(
        from,
        `${counter} fotos recibidas! Segui mandando o manda "listo" cuando termines.`
      );
    }
  } catch (error) {
    console.error(`Error processing guest photo from ${name}:`, error);
    await kapso.sendTextMessage(
      from,
      "Hubo un error con esa foto. Podes intentar de nuevo?"
    );
  }
}

async function requestSelfie(phone, name) {
  await kapso.sendTextMessage(
    phone,
    `Hola ${name}!\n\nPara la fiesta de Fede, estamos armando albums de fotos personalizados. Mandame una selfie tuya asi podemos identificarte en las fotos del evento y armarte tu album.\n\nSolo manda una foto y listo!`
  );
}

function generateGuestId(name) {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const hash = crypto
    .createHash("md5")
    .update(name)
    .digest("hex")
    .slice(0, 6);
  return `${normalized}-${hash}`;
}

// --- API endpoints ---

app.get("/api/status", async (req, res) => {
  try {
    const guests = await sheets.getAllGuests();
    const total = guests.length;
    const withSelfie = guests.filter((g) => g.selfieMain).length;
    const partnersTotal = guests.filter((g) => g.partnerName).length;
    const partnersWithSelfie = guests.filter((g) => g.selfiePartner).length;

    res.json({
      total,
      withSelfie,
      pendingSelfie: total - withSelfie,
      partnersTotal,
      partnersWithSelfie,
      partnersPending: partnersTotal - partnersWithSelfie,
      guests: guests.map((g) => ({
        mainName: g.mainName,
        partnerName: g.partnerName,
        selfieMain: g.selfieMain,
        selfiePartner: g.selfiePartner,
        guestId: g.guestId,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/broadcast", async (req, res) => {
  try {
    const guests = await sheets.getAllGuests();
    let sent = 0;

    for (const guest of guests) {
      if (!guest.selfieMain && guest.mainPhone) {
        await requestSelfie(guest.mainPhone, guest.mainName);
        sent++;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    res.json({ sent, message: `Broadcast sent to ${sent} guests` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-albums", async (req, res) => {
  try {
    const guests = await sheets.getAllGuests();
    const baseUrl = process.env.ALBUM_BASE_URL;
    let sent = 0;

    for (const guest of guests) {
      if (!guest.guestId) continue;

      if (guest.mainPhone) {
        const albumUrl = `${baseUrl}?id=${guest.guestId}`;
        await kapso.sendTextMessage(
          guest.mainPhone,
          `Hola ${guest.mainName}!\n\nYa estan las fotos de la fiesta de Fede! Mira tu album personalizado aca:\n\n${albumUrl}\n\nEsperamos que la hayas pasado increible!`
        );
        await sheets.markAlbumSent(guest.rowIndex, false);
        sent++;
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (guest.partnerName && guest.partnerPhone) {
        const partnerId = generateGuestId(guest.partnerName);
        const albumUrl = `${baseUrl}?id=${partnerId}`;
        await kapso.sendTextMessage(
          guest.partnerPhone,
          `Hola ${guest.partnerName}!\n\nYa estan las fotos de la fiesta de Fede! Mira tu album personalizado aca:\n\n${albumUrl}\n\nEsperamos que la hayas pasado increible!`
        );
        await sheets.markAlbumSent(guest.rowIndex, true);
        sent++;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    res.json({ sent, message: `Album links sent to ${sent} people` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Fiesta50 Fotos backend running on port ${PORT}`);
});
