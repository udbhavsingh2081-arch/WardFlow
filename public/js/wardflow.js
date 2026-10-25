/* WardFlow — Client-side helpers */

// AI ticket suggestion
async function suggestTicket(description) {
  const panel = document.getElementById('ai-suggestion-panel');
  const btn = document.getElementById('ai-suggest-btn');
  if (!description || !description.trim()) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Analysing...';

  try {
    const res = await fetch('/api/ai/suggest-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const data = await res.json();

    if (data.suggestion) {
      const s = data.suggestion;
      const titleElem = document.getElementById('ticket-title');
      const descElem = document.getElementById('ticket-description');
      if (titleElem && s.title) titleElem.value = s.title;
      if (descElem && s.description) descElem.value = s.description;

      if (s.category) {
        const catSelect = document.getElementById('ticket-category');
        if (catSelect) {
          for (let opt of catSelect.options) {
            if (opt.value === s.category) { catSelect.value = s.category; break; }
          }
        }
      }
      if (panel) {
        panel.classList.remove('d-none');
        document.getElementById('ai-suggestion-text').textContent =
          `AI suggested: ${s.title} (${s.category}) — please review and confirm.`;
        const missingElem = document.getElementById('ai-missing-info');
        if (missingElem) {
          if (s.missingInformation && s.missingInformation.length) {
            missingElem.textContent = 'Missing: ' + s.missingInformation.join(', ');
          } else {
            missingElem.textContent = '';
          }
        }
      }
    } else if (data.error && panel) {
      panel.classList.remove('d-none');
      document.getElementById('ai-suggestion-text').textContent = data.error;
    }
  } catch (e) {
    console.error('AI suggestion failed:', e);
    if (panel) {
      panel.classList.remove('d-none');
      document.getElementById('ai-suggestion-text').textContent =
        'AI suggestion unavailable. Please fill in the fields manually.';
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-stars"></i> AI Suggest';
  }
}

// Auto-dismiss alerts
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    document.querySelectorAll('.alert-auto-dismiss').forEach(el => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    });
  }, 4000);

  // Confirm dialogs
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });

  // Mobile sidebar toggle
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('wfSidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (window.innerWidth < 992 && sidebar.classList.contains('show') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('show');
      }
    });
  }

  // Ticket row click
  document.querySelectorAll('.ticket-row[data-href]').forEach(row => {
    row.addEventListener('click', () => { window.location = row.dataset.href; });
  });
});
