// ============================================================
// PathPilot AI - main.js
// Handles the home page: collecting inputs, calling the backend
// to generate a roadmap, and redirecting to the roadmap page.
// ============================================================

const API_BASE = window.location.origin;

const careerSelect = document.getElementById('career-select');
const skillSelect = document.getElementById('skill-select');
const generateBtn = document.getElementById('generate-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const errorBox = document.getElementById('error-box');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');

// Keep track of the last attempted request so Retry can replay it
let lastAttempt = null;

function setLoading(isLoading) {
  generateBtn.disabled = isLoading;
  btnText.textContent = isLoading ? 'Generating...' : 'Generate Roadmap';
  btnSpinner.classList.toggle('hidden', !isLoading);
}

function showError(message) {
  errorMessage.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

async function generateRoadmap() {
  const career = careerSelect.value;
  const skillLevel = skillSelect.value;

  lastAttempt = { career, skillLevel };
  hideError();
  setLoading(true);

  try {
    const response = await fetch(`${API_BASE}/generate-roadmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ career, skillLevel })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to generate roadmap.');
    }

    const roadmap = await response.json();

    // Save the fresh roadmap and reset any prior progress data,
    // since this is a brand new roadmap for possibly a new career.
    localStorage.setItem('pathpilot_roadmap', JSON.stringify(roadmap));
    localStorage.setItem('pathpilot_checked_skills', JSON.stringify([]));
    localStorage.setItem('pathpilot_progress', '0');

    window.location.href = 'roadmap.html';
  } catch (err) {
    console.error(err);
    showError(err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
}

generateBtn.addEventListener('click', generateRoadmap);

retryBtn.addEventListener('click', () => {
  if (lastAttempt) {
    generateRoadmap();
  }
});
