const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `Sos un asistente virtual para la fiesta de cumpleaños 50 de Fede (MYN50).
Tu tarea es interactuar con los invitados por WhatsApp de forma amigable y natural, en español rioplatense.

Tu rol principal es:
1. Pedir una selfie a cada invitado para poder identificarlos en las fotos del evento
2. Aceptar fotos de la fiesta que los invitados quieran compartir
3. Pedir el numero de WhatsApp de la pareja del invitado (si tiene) para contactarla directamente
4. Responder preguntas generales sobre la fiesta

Reglas:
- Se breve y amigable. Maximo 2-3 oraciones por mensaje.
- Usa español rioplatense (vos, che, dale, etc.)
- No uses emojis en exceso, maximo 1-2 por mensaje
- Si te preguntan algo que no sabes, deciles que consulten con Fede o los organizadores
- La fiesta es en Punta del Este, con transporte desde el Sofitel
- Para el transporte, pueden registrarse en myn50.com/transfer

Vas a recibir el contexto del invitado y debes responder con un JSON:
{
  "message": "texto para enviar al invitado",
  "action": "none" | "request_selfie" | "request_partner_phone" | "accept_photo" | "done"
}

Solo responde con el JSON, sin texto adicional.`;

// Conversation history per phone (keep last 10 messages)
const histories = new Map();

async function generateResponse(phone, guestContext, userMessage, messageType) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256,
        responseMimeType: "application/json",
      },
    });

    // Build context
    const context = `
Contexto del invitado:
- Nombre: ${guestContext.name}
- Tiene selfie: ${guestContext.hasSelfie ? "SI" : "NO"}
- Tiene pareja: ${guestContext.partnerName || "NO"}
- Pareja tiene selfie: ${guestContext.partnerHasSelfie ? "SI" : "NO"}
- Pareja tiene telefono registrado: ${guestContext.partnerHasPhone ? "SI" : "NO"}
- Fotos enviadas: ${guestContext.photosCount || 0}
- Estado actual: ${guestContext.state || "nuevo"}

Mensaje del invitado (tipo: ${messageType}): ${userMessage}`;

    // Get or create history
    let history = histories.get(phone) || [];

    const chat = model.startChat({
      history: history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await chat.sendMessage(context);
    const responseText = result.response.text();

    // Update history (keep last 10 exchanges)
    history.push({ role: "user", text: context });
    history.push({ role: "model", text: responseText });
    if (history.length > 20) history = history.slice(-20);
    histories.set(phone, history);

    const parsed = JSON.parse(responseText);
    return {
      message: parsed.message,
      action: parsed.action || "none",
    };
  } catch (error) {
    console.error("AI generation error:", error);
    return null; // Caller should use fallback
  }
}

function clearHistory(phone) {
  histories.delete(phone);
}

module.exports = { generateResponse, clearHistory };
