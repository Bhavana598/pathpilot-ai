// ============================================================
// PathPilot AI - roadmap.js
// Renders the roadmap page from localStorage data, fetches
// YouTube videos + books, manages the progress checklist,
// and exports the roadmap to PDF.
// ============================================================

const API_BASE = window.location.origin;

// ---------- DOM references ----------
const loadingState = document.getElementById('loading-state');
const errorState = document.getElementById('error-state');
const roadmapErrorMessage = document.getElementById('roadmap-error-message');
const roadmapRetryBtn = document.getElementById('roadmap-retry-btn');
const roadmapContent = document.getElementById('roadmap-content');

const careerNameEl = document.getElementById('career-name');
const careerOverviewEl = document.getElementById('career-overview');
const weeksContainer = document.getElementById('weeks-container');
const skillsTags = document.getElementById('skills-tags');
const projectsContainer = document.getElementById('projects-container');
const resourcesList = document.getElementById('resources-list');
const youtubeContainer = document.getElementById('youtube-container');
const booksContainer = document.getElementById('books-container');
const checklist = document.getElementById('checklist');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');
const downloadPdfBtn = document.getElementById('download-pdf-btn');

let currentRoadmap = null;

// ------------------------------------------------------------
// Utility: safe localStorage read
// ------------------------------------------------------------
function loadRoadmapFromStorage() {
  try {
    const raw = localStorage.getItem('pathpilot_roadmap');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Failed to parse stored roadmap:', e);
    return null;
  }
}

function loadCheckedSkills() {
  try {
    const raw = localStorage.getItem('pathpilot_checked_skills');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCheckedSkills(skillsArray) {
  localStorage.setItem('pathpilot_checked_skills', JSON.stringify(skillsArray));
}

function saveProgress(percent) {
  localStorage.setItem('pathpilot_progress', String(percent));
}

// ------------------------------------------------------------
// Rendering functions
// ------------------------------------------------------------
function renderHeader(roadmap) {
  careerNameEl.textContent = roadmap.career || 'Your Career Roadmap';
  careerOverviewEl.textContent = roadmap.overview || '';
}

function renderWeeks(weeks) {
  weeksContainer.innerHTML = '';
  if (!weeks || weeks.length === 0) {
    weeksContainer.innerHTML = '<p>No weekly plan available.</p>';
    return;
  }

  weeks.forEach((week) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="week-label">Week ${week.week}</div>
      <h3>${escapeHtml(week.topic || '')}</h3>
      <p>${escapeHtml(week.description || '')}</p>
    `;
    weeksContainer.appendChild(card);
  });
}

function renderSkillsTags(skills) {
  skillsTags.innerHTML = '';
  (skills || []).forEach((skill) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = skill;
    skillsTags.appendChild(tag);
  });
}

function renderProjects(projects) {
  projectsContainer.innerHTML = '';
  if (!projects || projects.length === 0) {
    projectsContainer.innerHTML = '<p>No projects available.</p>';
    return;
  }

  projects.forEach((project) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3>${escapeHtml(project)}</h3><p>A hands-on project to reinforce your skills.</p>`;
    projectsContainer.appendChild(card);
  });
}

function renderResources(resources) {
  resourcesList.innerHTML = '';
  (resources || []).forEach((resource) => {
    const li = document.createElement('li');
    li.textContent = resource;
    resourcesList.appendChild(li);
  });
}

function renderChecklist(skills) {
  checklist.innerHTML = '';
  const checkedSkills = new Set(loadCheckedSkills());

  (skills || []).forEach((skill, index) => {
    const li = document.createElement('li');
    const checkboxId = `skill-check-${index}`;

    li.innerHTML = `
      <input type="checkbox" id="${checkboxId}" data-skill="${escapeHtml(skill)}" ${checkedSkills.has(skill) ? 'checked' : ''} />
      <label for="${checkboxId}">${escapeHtml(skill)}</label>
    `;
    checklist.appendChild(li);
  });

  // Attach change listeners after render
  checklist.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', handleChecklistChange);
  });

  updateProgressBar(skills);
}

function handleChecklistChange() {
  const allCheckboxes = checklist.querySelectorAll('input[type="checkbox"]');
  const checkedSkills = [];

  allCheckboxes.forEach((cb) => {
    if (cb.checked) checkedSkills.push(cb.dataset.skill);
  });

  saveCheckedSkills(checkedSkills);
  updateProgressBar(currentRoadmap.skills, checkedSkills);
}

function updateProgressBar(skills, checkedSkillsOverride) {
  const total = (skills || []).length;
  const checkedSkills = checkedSkillsOverride || loadCheckedSkills();
  const checkedCount = checkedSkills.filter((s) => (skills || []).includes(s)).length;

  const percent = total === 0 ? 0 : Math.round((checkedCount / total) * 100);

  progressBarFill.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  saveProgress(percent);
}

function renderMediaCards(container, items, type) {
  container.innerHTML = '';

  if (!items || items.length === 0) {
    container.innerHTML = `<p>No ${type} found.</p>`;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    if (type === 'videos') {
      card.innerHTML = `
        <img src="${item.thumbnail}" alt="${escapeHtml(item.title)}" />
        <div class="media-body">
          <h4>${escapeHtml(item.title)}</h4>
          <button class="watch-btn" data-url="${item.videoUrl}">Watch</button>
        </div>
      `;
    } else {
      card.innerHTML = `
        <img src="${item.cover}" alt="${escapeHtml(item.title)}" />
        <div class="media-body">
          <h4>${escapeHtml(item.title)}</h4>
          <p class="author">${escapeHtml(item.author)}</p>
        </div>
      `;
    }

    container.appendChild(card);
  });

  if (type === 'videos') {
    container.querySelectorAll('.watch-btn').forEach((btn) => {
      btn.addEventListener('click', () => window.open(btn.dataset.url, '_blank'));
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ------------------------------------------------------------
// Fetch supplementary data (videos + books) from backend
// ------------------------------------------------------------
async function fetchYoutubeVideos(career) {
  const response = await fetch(`${API_BASE}/youtube?career=${encodeURIComponent(career)}`);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to fetch videos.');
  }
  const data = await response.json();
  return data.videos || [];
}

async function fetchBooks(career) {
  const response = await fetch(`${API_BASE}/books?career=${encodeURIComponent(career)}`);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to fetch books.');
  }
  const data = await response.json();
  return data.books || [];
}

// ------------------------------------------------------------
// PDF export using jsPDF
// ------------------------------------------------------------
function downloadRoadmapAsPdf() {
  if (!currentRoadmap) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 50;
  const pageHeight = doc.internal.pageSize.height;
  const lineHeight = 16;
  const maxWidth = 515;

  function checkPageBreak(extra = lineHeight) {
    if (y + extra > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
  }

  function addHeading(text, size = 16) {
    checkPageBreak(size + 10);
    doc.setFontSize(size);
    doc.setFont(undefined, 'bold');
    doc.text(text, marginX, y);
    y += size + 8;
  }

  function addParagraph(text, size = 11) {
    doc.setFontSize(size);
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line) => {
      checkPageBreak();
      doc.text(line, marginX, y);
      y += lineHeight;
    });
    y += 4;
  }

  addHeading(`${currentRoadmap.career} - Career Roadmap`, 18);
  addParagraph(currentRoadmap.overview || '');

  addHeading('Weekly Plan', 14);
  (currentRoadmap.weeks || []).forEach((week) => {
    addParagraph(`Week ${week.week}: ${week.topic}`, 12);
    addParagraph(week.description || '', 10);
  });

  addHeading('Skills', 14);
  addParagraph((currentRoadmap.skills || []).join(', '));

  addHeading('Projects', 14);
  (currentRoadmap.projects || []).forEach((p) => addParagraph(`• ${p}`));

  addHeading('Resources', 14);
  (currentRoadmap.resources || []).forEach((r) => addParagraph(`• ${r}`));

  doc.save(`${(currentRoadmap.career || 'career').replace(/\s+/g, '_')}_Roadmap.pdf`);
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
async function init() {
  const roadmap = loadRoadmapFromStorage();

  if (!roadmap) {
    errorState.classList.remove('hidden');
    roadmapErrorMessage.textContent = 'No roadmap found. Please generate one from the home page first.';
    roadmapRetryBtn.textContent = 'Back to Home';
    roadmapRetryBtn.onclick = () => (window.location.href = 'index.html');
    return;
  }

  currentRoadmap = roadmap;

  // Render everything we already have locally right away
  renderHeader(roadmap);
  renderWeeks(roadmap.weeks);
  renderSkillsTags(roadmap.skills);
  renderProjects(roadmap.projects);
  renderResources(roadmap.resources);
  renderChecklist(roadmap.skills);
  roadmapContent.classList.remove('hidden');

  // Fetch videos and books (these can fail independently without
  // blocking the rest of the roadmap from displaying)
  loadingState.classList.remove('hidden');

  try {
    const [videos, books] = await Promise.all([
      fetchYoutubeVideos(roadmap.career),
      fetchBooks(roadmap.career)
    ]);
    renderMediaCards(youtubeContainer, videos, 'videos');
    renderMediaCards(booksContainer, books, 'books');
  } catch (err) {
    console.error(err);
    youtubeContainer.innerHTML = `
      <div class="error-box">
        <p>${escapeHtml(err.message || 'Failed to load videos/books.')}</p>
        <button id="media-retry-btn" class="btn-secondary">Retry</button>
      </div>
    `;
    document.getElementById('media-retry-btn').addEventListener('click', init);
  } finally {
    loadingState.classList.add('hidden');
  }
}

downloadPdfBtn.addEventListener('click', downloadRoadmapAsPdf);

document.addEventListener('DOMContentLoaded', init);
