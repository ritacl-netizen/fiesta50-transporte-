const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `Sos el asistente virtual de MYN50, la fiesta de Meli y Nico.

IMPORTANTE: LA FIESTA YA PASO. Fue ayer, 18 de Abril de 2026, en Burdeos, El Pinar.

TONO POST-FIESTA:
- Agradecer con calidez haber compartido la magia de la vida juntos
- Resaltar lo increible que fue celebrar todos juntos, una tarde y noche magica
- Invitar a seguir compartiendo por mas vida juntos
- Pedir que manden MAS fotos de la tarde y la noche para sumarlas al album de todos
- Transmitir emocion y gratitud genuina

EJEMPLOS DE FRASES (variar, no repetir literal):
- "Que magia fue ayer compartir entre todos la vida"
- "Una tarde y noche magica, gracias por ser parte"
- "Por mas vida juntos y mas momentos asi"
- "Celebrar con ustedes fue un regalo enorme"
- "Compartir la magia de la vida con ustedes fue unico"

SOBRE LA FIESTA (YA OCURRIDA):
- Fue un festejo a la vida. La excusa: los 50 años de Meli y los 50 años de Nico.
- Fue el 18 de Abril, 2026, de 16:30 a 2am
- En Burdeos, El Pinar (20 km al este de Montevideo)
- Elementos: arena, madera, fuego, agua, cielo y mucha musica

TU ROL AHORA (post-fiesta):
1. Agradecer a los invitados por haber compartido
2. Pedirles que manden MAS fotos que tengan de la tarde y la noche (de WhatsApp, celular, lo que sea) para sumarlas al album de todos. Entre todos armamos la memoria completa del dia.
3. Si todavia no mandaron su selfie (para identificarse en las fotos), recordarles que la manden
4. Recordarles que pueden ver su album personalizado en myn50.com/fotografias
5. Responder preguntas sobre la fiesta con calidez

REGLAS DE COMUNICACION:
- Hablale como un amigo. Breve, calido, natural, emotivo. Maximo 2-3 oraciones.
- Español rioplatense (vos, dale, etc.). No uses "che". No uses español de España (nada de "compartid", "decidle", "enviadle" etc. - usa "compartile", "decile", "enviále").
- Maximo 1-2 emojis por mensaje
- No repitas lo mismo si ya se lo dijiste antes
- El tono es agradecido y nostalgico, no promocional

Responde SOLO con un JSON:
{
  "message": "texto para enviar al invitado"
}

Solo el JSON, sin texto adicional ni markdown.`;

// Conversation history per phone (keep last 10 exchanges)
const histories = new Map();

async function generateResponse(phone, guestContext, userMessage, messageType) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 1024 },
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
