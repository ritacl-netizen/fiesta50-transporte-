const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `Sos un asistente virtual para la fiesta de cumpleaños 50 de Fede (MYN50).
Tu nombre es MYN50 Bot. Interactuas con los invitados por WhatsApp de forma amigable y natural, en español rioplatense.

Lo que haces:
1. Pedirle una selfie al invitado para poder identificarlo en las fotos del evento
2. Aceptar fotos de la fiesta que los invitados quieran compartir
3. Si el invitado tiene pareja registrada y no tenemos su telefono, pedirle el numero de WhatsApp de la pareja
4. Responder preguntas generales sobre la fiesta

Info de la fiesta:
- La fiesta es en Punta del Este
- Hay transporte ida y vuelta desde el Sofitel. Se registran en myn50.com/transfer
- Las fotos personalizadas se ven en myn50.com/fotografias

Reglas:
- Se breve y amigable. Maximo 2-3 oraciones.
- Usa español rioplatense (vos, che, dale, etc.)
- No uses emojis en exceso, maximo 1-2 por mensaje
- Si te preguntan algo que no sabes, deciles que consulten con Fede o los organizadores

Vas a recibir el contexto del invitado y debes responder SOLO con un JSON:
{
  "message": "texto para enviar al invitado"
}

Solo responde con el JSON, sin texto adicional ni markdown.`;

// Conversation history per phone (keep last 10 exchanges)
const histories = new Map();

async function generateResponse(phone, guestContext, userMessage, messageType) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      },
      systemInstruction: SYSTEM_PROMPT,
    });

    const context = `Contexto del invitado:
- Nombre: ${guestContext.name}
- Tiene selfie: ${guestContext.hasSelfie ? "SI" : "NO"}
- Tiene pareja: ${guestContext.partnerName || "NO"}
- Pareja tiene selfie: ${guestContext.partnerHasSelfie ? "SI" : "NO"}
- Pareja tiene telefono registrado: ${guestContext.partnerHasPhone ? "SI" : "NO"}
- Estado: ${guestContext.state || "normal"}

Mensaje del invitado (tipo: ${messageType}): ${userMessage}`;

    let history = histories.get(phone) || [];

    const chat = model.startChat({
      history: history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
    });

    const result = await chat.sendMessage(context);
    const responseText = result.response.text().trim();

    // Update history (keep last 10 exchanges)
    history.push({ role: "user", text: context });
    history.push({ role: "model", text: responseText });
    if (history.length > 20) history = history.slice(-20);
    histories.set(phone, history);

    console.log("[AI] Raw response:", responseText.substring(0, 300));

    // Parse JSON response - try multiple extraction methods
    let msg = null;

    // Try direct JSON parse
    try {
      const cleaned = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      msg = parsed.message;
    } catch (e) {
      // Try extracting JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (jsonMatch) {
        msg = jsonMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
      } else {
        // Last resort: use the raw text as the message
        msg = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/^\{?\s*"message"\s*:\s*"?/i, "").replace(/"?\s*\}?\s*$/i, "").trim();
      }
    }

    return msg || null;
  } catch (error) {
    console.error("[AI] Error:", error.message);
    return null; // Caller uses fallback
  }
}

module.exports = { generateResponse };
