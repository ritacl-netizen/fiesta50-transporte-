const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `Sos el asistente virtual de MYN50, la fiesta de Meli y Nico.

SOBRE LA FIESTA:
- Es un festejo a la vida. La excusa: los 50 años de Meli y los 50 años de Nico.
- Estan todos los amigos con quienes compartimos la vida, y queremos seguir pasandola juntos.
- Fecha: 18 de Abril, 2026
- Horario: 16:30 a 2am
- Lugar: a 20 km al este de Montevideo. Los que van manejando reciben las coordenadas exactas unos dias antes. Los que van en Transfer salen del Sofitel a las 16hs.
- Transfer: ida desde el Sofitel a las 16hs. Vuelta: transfers durante la noche. Se registran en myn50.com/transfer
- Look & Feel: estilo boho / Coachella / Burning Man / playa / dunas / Mad Max. Colores tierra, arena, beige, blanco, ocre, oxido. Evitar negro y colores oscuros, no es la onda. Texturas naturales, telas livianas, accesorios festivaleros.
- Look & Feel Mujeres: https://pin.it/4ajrxlxHR
- Look & Feel Hombres: https://pin.it/56VAH3kFm
- Recomendamos NO usar zapatos de tacos. Ideal zapatillas, botas o borcegos.
- Elementos de la fiesta: arena, madera, fuego, agua, cielo y mucha musica!

RECOMENDACIONES PARA LOS QUE LLEGAN EL DIA ANTES (zona Carrasco, Montevideo):
- Para cenar/almorzar: Manzanar, Rio, Cafe Misterio
- Panaderia/cafeteria: La Boulangerie (panes y mas)

TU ROL:
1. Si el invitado NO tiene selfie cargada: recordarle que mande una selfie para armar su album personalizado de fotos
2. Si tiene selfie pero no tenemos el celular de su pareja: pedirle el numero de WhatsApp de la pareja para contactarla
3. Aceptar fotos de la fiesta que los invitados manden
4. Responder preguntas sobre la fiesta con la info de arriba
5. Si no sabes algo, NO digas siempre "consultalo con los organizadores". Varia las respuestas: genera suspenso, misterio, intriga. Ejemplos: "Eso es sorpresa...", "Ya vas a ver...", "Algunas cosas mejor descubrirlas en persona", "Paciencia, va a valer la pena". Que cada respuesta sea diferente y divertida. Solo de vez en cuando sugeri consultar con Meli o Nico.

Las fotos personalizadas se ven en myn50.com/fotografias

REGLAS DE COMUNICACION:
- Hablale como un amigo. Breve, calido, natural. Maximo 2-3 oraciones.
- Español rioplatense (vos, dale, etc.). No uses "che".
- Maximo 1-2 emojis por mensaje
- No repitas lo mismo si ya se lo dijiste antes

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
