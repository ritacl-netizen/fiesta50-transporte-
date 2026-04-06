require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const kapso = require("./kapso");
const sheets = require("./sheets");
const r2 = require("./r2");
const rekognition = require("./rekognition");
const mappings = require("./mappings");
const ai = require("./ai");

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

// Conversation states per phone number
const conversationState = new Map();
const photoCounters = new Map();

// Kapso v2 webhook (POST)
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    // Kapso v2 format: { message, conversation, phone_number_id }
    if (body.message) {
      await handleKapsoMessage(body.message, body.conversation);
      return;
    }

    // Meta forward format (fallback): { object, entry[] }
    if (body.entry) {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (!value || !value.messages) continue;
          for (const msg of value.messages) {
            await handleMetaMessage(msg);
          }
        }
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
});

// Handle Kapso v2 format message
async function handleKapsoMessage(message, conversation) {
  // Skip outbound messages (echoes of our own messages)
  if (message.kapso?.direction === "outbound") return;
  // Skip status-only webhooks (no actual message content)
  if (!message.type) return;

  const from = message.from;
  const messageType = message.type;
  const mediaUrl = message.kapso?.media_url || message.image?.link;

  console.log(`[Kapso] Message from ${from}, type: ${messageType}`);

  await processMessage(from, messageType, message, mediaUrl);
}

// Handle Meta forward format message
async function handleMetaMessage(message) {
  const from = message.from;
  const messageType = message.type;

  console.log(`[Meta] Message from ${from}, type: ${messageType}`);

  await processMessage(from, messageType, message, null);
}

// Shared message processing logic
async function processMessage(from, messageType, message, mediaUrl) {
  const guest = await sheets.findGuestByPhone(from);
  if (!guest) {
    await kapso.sendTextMessage(
      from,
      "Hola! No encontre tu numero en la lista de invitados. Verifica que este sea el numero registrado en la invitacion, o pidele a tu pareja que registre tu telefono."
    );
    return;
  }

  const isPartner = sheets.phonesMatch(guest.partnerPhone, from);
  const state = conversationState.get(from);
  const name = isPartner ? guest.partnerName : guest.mainName;
  const hasSelfie = isPartner ? guest.selfiePartner : guest.selfieMain;

  // Handle photo messages
  if (messageType === "image") {
    if (!hasSelfie) {
      await handleSelfieReceived(from, message, guest, isPartner, name, mediaUrl);
    } else {
      await handleGuestPhotoReceived(from, message, guest, isPartner, name, mediaUrl);
    }
    return;
  }

  // Handle contact shared (WhatsApp contact card)
  if (messageType === "contacts") {
    const contacts = message.contacts || [];
    const needsPartnerPhone = guest.partnerName && !guest.partnerPhone;

    if (needsPartnerPhone && contacts.length > 0) {
      const contact = contacts[0];
      const phone = contact.phones?.[0]?.wa_id || contact.phones?.[0]?.phone || "";
      const cleanPhone = phone.replace(/[\s\-\(\)\.+]/g, "");
      if (cleanPhone.length >= 8) {
        await sheets.setPartnerPhone(guest.rowIndex, cleanPhone);
        console.log(`[CONTACTS] Saved partner phone for ${guest.partnerName}: ${cleanPhone}`);
        await kapso.sendTextMessage(
          from,
          `Genial! Ya tengo el numero de ${guest.partnerName} registrado. Si le avisas para que nos escriba desde su celu asi tambien le registramos la selfie!`
        );
        return;
      }
    }

    // If partner phone not needed or couldn't extract, let AI handle
    const guestContext = { name, hasSelfie, partnerName: guest.partnerName, partnerHasSelfie: guest.selfiePartner, partnerHasPhone: !!guest.partnerPhone, state: state || "normal" };
    const aiMsg = await ai.generateResponse(from, guestContext, "[El invitado compartio un contacto]", "contacts");
    if (aiMsg) await kapso.sendTextMessage(from, aiMsg);
    return;
  }

  // Handle text messages
  if (messageType === "text") {
    const text = (message.text?.body || "").trim();

    // Check if they're sending a phone number for their partner
    // Works whether or not AWAITING_PARTNER_PHONE state is set (Cloud Run may restart)
    const needsPartnerPhone = guest.partnerName && !guest.partnerPhone;
    if (needsPartnerPhone) {
      const phoneMatch = text.replace(/[\s\-\(\)\.+]/g, "");
      if (/^\d{8,}$/.test(phoneMatch)) {
        await sheets.setPartnerPhone(guest.rowIndex, phoneMatch);
        conversationState.delete(from);
        await kapso.sendTextMessage(
          from,
          `Genial! Ya tengo el numero de ${guest.partnerName} registrado. Si le avisas para que nos escriba desde su celu asi tambien le registramos la selfie!`
        );
        return;
      }
    }

    // Use Gemini for natural response
    const guestContext = {
      name,
      hasSelfie,
      partnerName: guest.partnerName,
      partnerHasSelfie: guest.selfiePartner,
      partnerHasPhone: !!guest.partnerPhone,
      state: state || (hasSelfie ? "tiene_selfie" : "sin_selfie"),
    };

    const aiResponse = await ai.generateResponse(from, guestContext, text, "text");

    if (aiResponse) {
      await kapso.sendTextMessage(from, aiResponse);
    } else {
      // Fallback if AI fails
      if (!hasSelfie) {
        await kapso.sendTextMessage(from, `Hola ${name}! Mandame una selfie tuya para armar tu album personalizado de fotos de la fiesta.`);
      } else {
        await kapso.sendTextMessage(from, `Hola ${name}! Ya tengo tu selfie. Si tenes fotos de la fiesta, mandalas y las sumo al album de todos!`);
      }
    }
    return;
  }
}

async function handleSelfieReceived(from, message, guest, isPartner, name, mediaUrl) {
  try {
    let guestId = guest.guestId;
    if (!guestId) {
      guestId = generateGuestId(guest.mainName);
      await sheets.setGuestId(guest.rowIndex, guestId);
    }

    const personId = isPartner ? generateGuestId(guest.partnerName) : guestId;

    // Download image from Kapso media URL or via media ID
    const mediaBuffer = mediaUrl
      ? await kapso.downloadMediaFromUrl(mediaUrl)
      : await kapso.downloadMediaFromUrl(message.image?.link || message.image?.url);

    const url = await r2.uploadSelfie(personId, mediaBuffer);
    console.log(`Selfie saved for ${name}: ${url}`);

    // Clear Rekognition cache so new selfie is used for matching
    rekognition.clearCache();

    await sheets.markSelfieReceived(guest.rowIndex, isPartner);

    // Generate AI response for selfie confirmation
    const selfieContext = {
      name,
      hasSelfie: true,
      partnerName: guest.partnerName,
      partnerHasSelfie: guest.selfiePartner,
      partnerHasPhone: !!guest.partnerPhone,
      state: "selfie_recibida",
    };
    const aiMsg = await ai.generateResponse(from, selfieContext, "[El invitado acaba de mandar su selfie]", "selfie_received");
    await kapso.sendTextMessage(from, aiMsg || `Recibida tu selfie, ${name}! Si tenes fotos de la fiesta, mandalas y las sumo al album de todos!`);

    // Ask for partner phone if needed
    if (!isPartner && guest.partnerName && !guest.selfiePartner && !guest.partnerPhone) {
      conversationState.set(from, "AWAITING_PARTNER_PHONE");
      const partnerMsg = await ai.generateResponse(from, selfieContext, `[Necesitamos el telefono de ${guest.partnerName} para pedirle su selfie]`, "need_partner_phone");
      await kapso.sendTextMessage(from, partnerMsg || `Tambien necesito una selfie de ${guest.partnerName}. Pasame su numero de WhatsApp asi le escribo.`);
    } else if (!isPartner && guest.partnerName && !guest.selfiePartner && guest.partnerPhone) {
      try {
        await requestSelfie(guest.partnerPhone, guest.partnerName);
      } catch (e) {
        console.log(`Could not message partner ${guest.partnerName}: ${e.message}`);
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

async function handleGuestPhotoReceived(from, message, guest, isPartner, name, mediaUrl) {
  try {
    const counter = (photoCounters.get(from) || 0) + 1;
    photoCounters.set(from, counter);

    const timestamp = Date.now();
    const photoId = `guest-${from}-${timestamp}-${counter}`;

    const mediaBuffer = mediaUrl
      ? await kapso.downloadMediaFromUrl(mediaUrl)
      : await kapso.downloadMediaFromUrl(message.image?.link || message.image?.url);

    const url = await r2.uploadGuestPhoto(photoId, mediaBuffer);
    console.log(`Guest photo saved from ${name}: ${url}`);

    await sheets.incrementPhotoCount(guest.rowIndex, isPartner);

    // Run face recognition in background (don't block response)
    matchPhotoInBackground(photoId, "whatsapp", mediaBuffer);

    if (counter === 1) {
      await kapso.sendTextMessage(
        from,
        `Foto recibida! Segui mandando las que quieras.`
      );
    } else if (counter % 5 === 0) {
      await kapso.sendTextMessage(
        from,
        `${counter} fotos recibidas! Segui mandando.`
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

// Run face matching in background
async function matchPhotoInBackground(photoId, source, photoBuffer) {
  try {
    // Get all guests who have selfies
    const guests = await sheets.getAllGuests();
    const selfieIds = guests
      .filter((g) => g.selfieMain && g.guestId)
      .map((g) => g.guestId);

    // Also include partner selfie IDs
    for (const g of guests) {
      if (g.selfiePartner && g.partnerName) {
        selfieIds.push(generateGuestId(g.partnerName));
      }
    }

    if (selfieIds.length === 0) {
      console.log(`[Rekognition] No selfies to match against`);
      return;
    }

    console.log(`[Rekognition] Matching photo ${photoId} against ${selfieIds.length} selfies...`);
    const matchedGuests = await rekognition.matchPhoto(photoBuffer, selfieIds);

    if (matchedGuests.length > 0) {
      await mappings.addMatch(photoId, source, matchedGuests);
      console.log(`[Rekognition] Photo ${photoId} matched: ${matchedGuests.join(", ")}`);
    } else {
      console.log(`[Rekognition] Photo ${photoId}: no matches`);
    }
  } catch (error) {
    console.error(`[Rekognition] Error matching ${photoId}:`, error.message);
  }
}

async function requestSelfie(phone, name) {
  await kapso.sendTextMessage(
    phone,
    `Hola ${name}!\n\nPara la fiesta de Meli y Nico, estamos armando albums de fotos personalizados. Mandame una selfie tuya asi podemos identificarte en las fotos del evento y armarte tu album.\n\nSolo manda una foto y listo! Ya falta poquito!`
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

// CORS for frontend
app.use("/api", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  next();
});

// Serve mappings.json live from backend
app.get("/api/mappings", async (req, res) => {
  try {
    const data = await mappings.load();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
          `Hola ${guest.mainName}!\n\nYa estan las fotos de la fiesta de Meli y Nico! Mira tu album personalizado aca:\n\n${albumUrl}\n\nEsperamos que la hayas pasado increible!`
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
          `Hola ${guest.partnerName}!\n\nYa estan las fotos de la fiesta de Meli y Nico! Mira tu album personalizado aca:\n\n${albumUrl}\n\nEsperamos que la hayas pasado increible!`
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
