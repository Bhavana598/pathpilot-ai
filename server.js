

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;


app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); 

function extractJson(rawText) {
  let cleaned = rawText.trim();

  
  cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();

 
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No valid JSON object found in Gemini response');
  }

  let jsonSlice = cleaned.slice(firstBrace, lastBrace + 1);

  jsonSlice = jsonSlice.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(jsonSlice);
  } catch (parseErr) {
    console.error('Failed to parse Gemini JSON. Raw text was:\n', rawText);
    throw parseErr;
  }
}


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
  "resources": ["string", "string"]
}

Requirements:
- Include between 8 and 12 weeks in the "weeks" array, numbered sequentially starting at 1.
- Include 6 to 10 relevant "skills" as short tags (e.g. "HTML", "Git").
- Include exactly 3 beginner-friendly "projects" tailored to ${career}.
- Include 4 to 6 free "resources" (named platforms, docs, or course titles — no need for real URLs).
- Tailor difficulty and pacing to a ${skillLevel} learner.
- Keep descriptions concise (one short sentence each) so the full response fits comfortably within the output limit.
- Output must be valid, complete, parseable JSON with no trailing commas and no truncation. Make sure the final closing brace is included.
`.trim();

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await axios.post(
      geminiUrl,
      {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const rawText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error('Gemini returned an empty response.');
    }

    const roadmapJson = extractJson(rawText);

    
    roadmapJson.career = roadmapJson.career || career;
    roadmapJson.overview = roadmapJson.overview || '';
    roadmapJson.weeks = Array.isArray(roadmapJson.weeks) ? roadmapJson.weeks : [];
    roadmapJson.skills = Array.isArray(roadmapJson.skills) ? roadmapJson.skills : [];
    roadmapJson.projects = Array.isArray(roadmapJson.projects) ? roadmapJson.projects : [];
    roadmapJson.resources = Array.isArray(roadmapJson.resources) ? roadmapJson.resources : [];

    res.json(roadmapJson);
  } catch (err) {
    console.error('Error in /generate-roadmap:', err.message);
    if (err.response) {
      console.error('Gemini API response status:', err.response.status);
      console.error('Gemini API response data:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({ error: 'Failed to generate roadmap. Please try again.' });
  }
});


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
        limit: 4
      }
    });

    const books = (response.data.docs || []).slice(0, 4).map((doc) => {
      const coverId = doc.cover_i;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : 'https://via.placeholder.com/128x193?text=No+Cover';

      return {
        title: doc.title || 'Untitled',
        author: (doc.author_name && doc.author_name[0]) || 'Unknown Author',
        cover: coverUrl
      };
    });

    res.json({ books });
  } catch (err) {
    console.error('Error in /books:', err.message);
    res.status(500).json({ error: 'Failed to fetch books. Please try again.' });
  }
});


app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`PathPilot AI server running on http://localhost:${PORT}`);
});
