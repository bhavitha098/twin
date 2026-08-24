// Vercel Serverless Function — the ONLY place in this project that holds a
// secret. GEMINI_API_KEY must be set in the Vercel dashboard (Project ->
// Settings -> Environment Variables), never committed to this repo. This
// function exists purely to keep that one key off the browser; everything
// else in the app still talks to Supabase directly with the public anon key.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server' });
    return;
  }

  const { mode, question, trends, context } = req.body || {};

  let systemPrompt;
  let userPrompt;

  if (mode === 'insight') {
    systemPrompt = 'You are Civic Twin\'s analyst for Hyderabad. Given 6-hour trend data and the current live snapshot, produce exactly ONE actionable insight a city admin has not already seen. Respond with ONLY valid JSON, no markdown fences, no commentary: {"icon": "traffic|water|waste|general", "category": "traffic|water|waste|general", "title": "<max 8 words>", "body": "<max 2 sentences, cite real numbers from the data>"}.';
    userPrompt = `TREND DATA (last 6h):\n${JSON.stringify(trends)}\n\nCURRENT SNAPSHOT:\n${JSON.stringify(context)}\n\nGenerate the insight now.`;
  } else {
    systemPrompt = `You are Civic Twin, an AI city-intelligence copilot for Hyderabad. Answer the admin's question using ONLY the live city data JSON below — be specific, cite real numbers, keep it to 2-3 sentences, plain text, no markdown. If the data does not cover the question, say so briefly rather than inventing numbers.\n\nLIVE CITY DATA:\n${JSON.stringify(context)}`;
    userPrompt = question || '';
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.4,
          // gemini-3.6-flash spends part of the token budget on internal
          // "thinking" before producing output text — verified a low
          // maxOutputTokens (100-400) gets eaten entirely by that and
          // truncates the real answer to nothing. 1024 leaves real room.
          thinkingConfig: { thinkingBudget: 200 },
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini ${geminiRes.status}: ${errText.slice(0, 300)}`);
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) throw new Error('Empty response from Gemini');

    if (mode === 'insight') {
      const cleaned = text.trim().replace(/^```json?\s*|\s*```$/g, '');
      const parsed = JSON.parse(cleaned);
      res.status(200).json(parsed);
    } else {
      res.status(200).json({ answer: text.trim() });
    }
  } catch (e) {
    console.error('[api/ask-ai]', e.message);
    res.status(500).json({ error: e.message });
  }
};
