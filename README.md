# PathPilot AI – Career Roadmap Generator

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your keys:
   ```
   cp .env.example .env
   ```
   - `GEMINI_API_KEY` — from https://aistudio.google.com/app/apikey
   - `YOUTUBE_API_KEY` — from https://console.cloud.google.com/apis/credentials (enable "YouTube Data API v3")
   - `PORT` — defaults to 3000

3. Start the server:
   ```
   npm start
   ```

4. Open your browser at `http://localhost:3000`

## How it works

- **index.html** — pick a career + skill level, click **Generate Roadmap**. This calls `POST /generate-roadmap`, which prompts Gemini and returns structured JSON. The result is saved to `localStorage` and you're redirected to `roadmap.html`.
- **roadmap.html** — reads the roadmap from `localStorage` and renders it instantly, then fetches YouTube videos (`GET /youtube?career=`) and books (`GET /books?career=`) in parallel.
- **Progress tracker** — checking a skill in the checklist updates the progress bar and persists to `localStorage`, so it's restored on your next visit.
- **Download Roadmap** — uses jsPDF (loaded via CDN) to export the full roadmap as a PDF.
- **Error handling** — any failed API call shows a friendly message with a **Retry** button instead of a blank/broken screen.

## Notes

- No API keys are ever sent to the browser — all third-party calls happen server-side in `server.js`.
- Open Library's book search needs no API key.
- If Gemini's response isn't perfectly clean JSON, `server.js` strips code fences and extracts the JSON object defensively before parsing.
