// ============================================================
// PathPilot AI - Backend Server
// Handles: Gemini roadmap generation, YouTube video search,
// Open Library book search. API keys stay server-side only.
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve index.html, roadmap.html, style.css, js files

// ------------------------------------------------------------
// Helper: Extract JSON safely from Gemini's text response.
// Gemini sometimes wraps JSON in ```json fences or adds text
// around it, so we strip fences and grab the first {...} block.
// ------------------------------------------------------------
function extractJson(rawText) {
  let cleaned = rawText.trim();

  // Remove markdown code fences if present
  cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Find the first '{' and the last '}' to isolate the JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No valid JSON object found in Gemini response');
  }

  let jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);

  // Remove trailing commas before ] or } which Gemini sometimes adds
  // and which are invalid in strict JSON (e.g. [1, 2, 3,] or {"a":1,})
  jsonSlice = jsonSlice.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(jsonSlice);
  } catch (parseErr) {
    console.error('Failed to parse Gemini JSON. Raw text was:\n', rawText);
    throw parseErr;
  }
}

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Gemini may return resources as plain strings (older format) or as
// { name, url } objects. This normalizes both into one consistent shape
// and falls back to a Google search link if the url is missing/invalid,
// so the frontend never has to deal with a dead or malformed link.
function normalizeResource(resource) {
  if (typeof resource === 'string') {
    return {
      name: resource,
      url: `https://www.google.com/search?q=${encodeURIComponent(resource)}`
    };
  }

  const name = (resource && resource.name) || 'Resource';
  const url =
    resource && resource.url && isValidHttpUrl(resource.url)
      ? resource.url
      : `https://www.google.com/search?q=${encodeURIComponent(name)}`;

  return { name, url };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries a single model's request on transient errors (503 = overloaded,
// 429 = rate limited) with a short exponential backoff. Anything else
// (400, 403, 404, etc.) fails immediately since retrying won't help.
async function callGeminiWithRetry(url, payload, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isTransient = status === 503 || status === 429;

      if (!isTransient || attempt === maxRetries) {
        throw err;
      }

      const delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s...
      console.warn(
        `Gemini request failed with ${status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// Models to try, in order. Different models often have independent load/quota,
// so if the first one is overloaded (503) or rate-limited (429), we fall
// through to the next one instead of failing outright.
const GEMINI_MODEL_FALLBACKS = ['gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];

async function callGeminiWithFallback(payload) {
  let lastError;

  for (const model of GEMINI_MODEL_FALLBACKS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await callGeminiWithRetry(url, payload);
      if (model !== GEMINI_MODEL_FALLBACKS[0]) {
        console.log(`Succeeded using fallback model: ${model}`);
      }
      return response;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isTransient = status === 503 || status === 429;

      if (!isTransient) {
        throw err; // non-transient error (bad key, bad request) - no point trying other models
      }

      console.warn(`Model ${model} unavailable (status ${status}), trying next fallback model...`);
    }
  }

  throw lastError;
}

// ------------------------------------------------------------
// POST /generate-roadmap
// Body: { career, skillLevel }
// Sends a structured prompt to Gemini and returns parsed JSON.
// ------------------------------------------------------------
app.post('/generate-roadmap', async (req, res) => {
  try {
    const { career, skillLevel } = req.body;

    if (!career || !skillLevel) {
      return res.status(400).json({ error: 'career and skillLevel are required.' });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY. Check your .env file.' });
    }

    const prompt = `
Create a ${skillLevel.toLowerCase()}-friendly, week-by-week learning roadmap for becoming a ${career}.
Return STRICT JSON ONLY. Do not include any explanation, markdown, or code fences — only the raw JSON object.

The JSON must exactly follow this structure:
{
  "career": "string",
  "overview": "2-3 sentence summary of what this career path involves",
  "weeks": [
    { "week": 1, "topic": "string", "description": "string" }
  ],
  "skills": ["string", "string"],
  "projects": ["string", "string", "string"],
  "resources": [
    { "name": "string", "url": "string" }
  ]
}

Requirements:
- Include between 8 and 12 weeks in the "weeks" array, numbered sequentially starting at 1.
- Include 6 to 10 relevant "skills" as short tags (e.g. "HTML", "Git").
- Include exactly 3 beginner-friendly "projects" tailored to ${career}.
- Include 4 to 6 free "resources". Each resource needs a "name" (e.g. "freeCodeCamp") and a "url"
  pointing to that resource's real, official homepage or documentation root (e.g. "https://www.freecodecamp.org/",
  "https://developer.mozilla.org/", "https://docs.python.org/3/"). Use only well-known, real, stable URLs you are
  confident actually exist — do not invent or guess a URL.
- Tailor difficulty and pacing to a ${skillLevel} learner.
- Keep descriptions concise (one short sentence each) so the full response fits comfortably within the output limit.
- Output must be valid, complete, parseable JSON with no trailing commas and no truncation. Make sure the final closing brace is included.
`.trim();

    const geminiResponse = await callGeminiWithFallback({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096
      }
    });

    const rawText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error('Gemini returned an empty response.');
    }

    const roadmapJson = extractJson(rawText);

    // Basic shape validation / fallback defaults so the frontend never breaks
    roadmapJson.career = roadmapJson.career || career;
    roadmapJson.overview = roadmapJson.overview || '';
    roadmapJson.weeks = Array.isArray(roadmapJson.weeks) ? roadmapJson.weeks : [];
    roadmapJson.skills = Array.isArray(roadmapJson.skills) ? roadmapJson.skills : [];
    roadmapJson.projects = Array.isArray(roadmapJson.projects) ? roadmapJson.projects : [];
    roadmapJson.resources = Array.isArray(roadmapJson.resources)
      ? roadmapJson.resources.map((r) => normalizeResource(r))
      : [];

    res.json(roadmapJson);
  } catch (err) {
    console.error('Error in /generate-roadmap:', err.message);
    const status = err.response?.status;
    if (err.response) {
      console.error('Gemini API response status:', status);
      console.error('Gemini API response data:', JSON.stringify(err.response.data, null, 2));
    }

    const friendlyMessage =
      status === 503
        ? "Gemini is experiencing high demand right now. We retried a few times automatically — please try again in a moment."
        : status === 429
        ? 'API request limit reached. Please wait a bit before trying again.'
        : 'Failed to generate roadmap. Please try again.';

    res.status(500).json({ error: friendlyMessage });
  }
});

// ------------------------------------------------------------
// GET /youtube?career=
// Returns top 4 YouTube videos related to the career.
// ------------------------------------------------------------
app.get('/youtube', async (req, res) => {
  try {
    const { career } = req.query;

    if (!career) {
      return res.status(400).json({ error: 'career query parameter is required.' });
    }

    if (!YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY. Check your .env file.' });
    }

    const searchQuery = `${career} roadmap tutorial for beginners`;

    const youtubeUrl = 'https://www.googleapis.com/youtube/v3/search';

    const response = await axios.get(youtubeUrl, {
      params: {
        part: 'snippet',
        q: searchQuery,
        type: 'video',
        maxResults: 4,
        key: YOUTUBE_API_KEY,
        safeSearch: 'strict',
        relevanceLanguage: 'en'
      }
    });

    const videos = (response.data.items || []).map((item) => ({
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));

    res.json({ videos });
  } catch (err) {
    console.error('Error in /youtube:', err.message);
    res.status(500).json({ error: 'Failed to fetch YouTube videos. Please try again.' });
  }
});

// ------------------------------------------------------------
// GET /books?career=
// Returns top 4 books from Open Library (no API key needed).
// ------------------------------------------------------------
app.get('/books', async (req, res) => {
  try {
    const { career } = req.query;

    if (!career) {
      return res.status(400).json({ error: 'career query parameter is required.' });
    }

    const openLibraryUrl = 'https://openlibrary.org/search.json';

    const response = await axios.get(openLibraryUrl, {
      params: {
        q: career,
        limit: 20, // fetch extra so we can prioritize ones that are actually readable online
        fields: 'title,author_name,cover_i,key,ia,ebook_access,has_fulltext'
      }
    });

    const allDocs = response.data.docs || [];

    // Prefer books Internet Archive can render in its inline "read online" viewer.
    // ebook_access "public" = fully readable now; "borrowable" = read after a
    // 1-hour library loan (still no purchase). Both open a direct reader, not a store.
    const readableDocs = allDocs.filter(
      (doc) => doc.ia && doc.ia.length > 0 && ['public', 'borrowable'].includes(doc.ebook_access)
    );

    const chosenDocs = (readableDocs.length > 0 ? readableDocs : allDocs).slice(0, 4);

    const books = chosenDocs.map((doc) => {
      const coverId = doc.cover_i;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : 'https://via.placeholder.com/128x193?text=No+Cover';

      // If Internet Archive has a scan, link straight to its reader.
      // Otherwise fall back to the book's Open Library page.
      const readUrl =
        doc.ia && doc.ia.length > 0
          ? `https://archive.org/details/${doc.ia[0]}`
          : doc.key
          ? `https://openlibrary.org${doc.key}`
          : 'https://openlibrary.org';

      return {
        title: doc.title || 'Untitled',
        author: (doc.author_name && doc.author_name[0]) || 'Unknown Author',
        cover: coverUrl,
        readUrl
      };
    });

    res.json({ books });
  } catch (err) {
    console.error('Error in /books:', err.message);
    res.status(500).json({ error: 'Failed to fetch books. Please try again.' });
  }
});

// ------------------------------------------------------------
// Health check
// ------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`PathPilot AI server running on http://localhost:${PORT}`);
});
