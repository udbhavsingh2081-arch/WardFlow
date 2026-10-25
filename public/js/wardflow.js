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

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    document.querySelectorAll('.alert-auto-dismiss').forEach(el => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    });
  }, 4000);

  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });

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

  document.querySelectorAll('.ticket-row[data-href]').forEach(row => {
    row.addEventListener('click', () => { window.location = row.dataset.href; });
  });
});

async function generateIncidentSummary(ticketId) {
  const btn = document.getElementById('btnGenerateSummary');
  const container = document.getElementById('aiSummaryContainer');
  if (!ticketId || !container) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Summarizing...';
  }

  container.classList.remove('d-none');
  container.innerHTML = `
    <div class="card border p-3 text-center bg-light">
      <div class="spinner-border spinner-border-sm text-secondary mb-1" role="status"></div>
      <div class="small text-muted">Summarizing incident history with Gemini...</div>
    </div>
  `;

  const esc = (str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  };

  try {
    const res = await fetch(`/tickets/${encodeURIComponent(ticketId)}/ai-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    });

    const data = await res.json();

    if (!res.ok || !data.success || !data.summary) {
      const errMsg = data.error || `Failed to generate summary (${res.status}).`;
      container.innerHTML = `
        <div class="alert alert-danger d-flex align-items-center justify-content-between p-2 mb-0 small" role="alert">
          <div><i class="bi bi-exclamation-circle me-1"></i>${esc(errMsg)}</div>
          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="generateIncidentSummary('${esc(ticketId)}')">Retry</button>
        </div>
      `;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-sparkles me-1"></i>Summary';
      }
      return;
    }

    const s = data.summary;
    const meta = s.metadata || {};
    const curr = s.currentStatus || {};
    const formattedTime = meta.generatedAt ? new Date(meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString();

    const actionsHtml = Array.isArray(s.actionsTaken) && s.actionsTaken.length > 0
      ? s.actionsTaken.map(a => `<li class="mb-1">${esc(a)}</li>`).join('')
      : '<li class="text-muted fst-italic">No actions recorded.</li>';

    const outstandingHtml = Array.isArray(s.outstandingActions) && s.outstandingActions.length > 0
      ? s.outstandingActions.map(o => `<li class="mb-1">${esc(o)}</li>`).join('')
      : '<li class="text-muted fst-italic">No outstanding actions.</li>';

    const timelineHtml = Array.isArray(s.timeline) && s.timeline.length > 0
      ? s.timeline.map(t => `
          <div class="d-flex align-items-start gap-2 mb-1">
            <span class="text-muted font-monospace" style="font-size: 0.75rem; min-width: 90px;">${esc(t.timestamp)}</span>
            <span class="text-secondary small">${esc(t.event)}</span>
          </div>
        `).join('')
      : '<div class="text-muted small fst-italic">No timeline entries.</div>';

    const supervisorHtml = Array.isArray(s.supervisorAttention) && s.supervisorAttention.length > 0
      ? s.supervisorAttention.map(item => `<div class="mb-1 small text-dark">• ${esc(item)}</div>`).join('')
      : '<div class="text-muted small fst-italic">No attention items.</div>';

    const dataGapsHtml = Array.isArray(s.dataGaps) && s.dataGaps.length > 0
      ? s.dataGaps.map(g => `<li class="mb-1">${esc(g)}</li>`).join('')
      : '<li class="text-muted fst-italic">No missing information noted.</li>';

    container.innerHTML = `
      <div class="card border mb-3 shadow-sm">
        <div class="card-header bg-white py-2 px-3 d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold text-dark small"><i class="bi bi-sparkles text-primary me-1"></i>Incident Summary</span>
            <span class="badge bg-light text-muted border fw-normal" style="font-size: 0.65rem;">AI Generated</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="text-muted" style="font-size: 0.75rem;">${esc(formattedTime)}</span>
            <button type="button" class="btn btn-sm btn-link text-muted p-0 ms-2 text-decoration-none" onclick="document.getElementById('aiSummaryContainer').classList.add('d-none')" title="Close">
              <i class="bi bi-x"></i>
            </button>
          </div>
        </div>

        <div class="card-body p-3">
          <p class="text-dark mb-3" style="font-size: 0.875rem; line-height: 1.5;">${esc(s.incidentOverview)}</p>

          <div class="row g-2 mb-3 p-2 rounded bg-light border">
            <div class="col-6 col-md-3">
              <div class="text-muted" style="font-size: 0.7rem;">Status</div>
              <div class="fw-medium text-dark text-capitalize small">${esc(curr.status || 'open')}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted" style="font-size: 0.7rem;">Priority</div>
              <div class="fw-medium text-dark text-uppercase small">${esc(curr.priority || 'medium')}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted" style="font-size: 0.7rem;">Assignee</div>
              <div class="fw-medium text-dark text-truncate small">${esc(curr.assignee || 'Unassigned')}</div>
            </div>
            <div class="col-6 col-md-3">
              <div class="text-muted" style="font-size: 0.7rem;">SLA Condition</div>
              <div class="fw-medium ${curr.isOverdue ? 'text-danger' : 'text-dark'} small">${esc(curr.slaState || 'On Track')}</div>
            </div>
          </div>

          <div class="row g-3">
            <div class="col-md-7">
              <div class="text-muted fw-semibold small text-uppercase mb-1" style="font-size: 0.7rem;">Actions Recorded</div>
              <ul class="ps-3 mb-3 small text-secondary">
                ${actionsHtml}
              </ul>

              <div class="text-muted fw-semibold small text-uppercase mb-1" style="font-size: 0.7rem;">Timeline</div>
              <div class="mb-2">
                ${timelineHtml}
              </div>
            </div>

            <div class="col-md-5">
              <div class="text-muted fw-semibold small text-uppercase mb-1" style="font-size: 0.7rem;">Pending Actions</div>
              <ul class="ps-3 mb-3 small text-secondary">
                ${outstandingHtml}
              </ul>

              ${Array.isArray(s.supervisorAttention) && s.supervisorAttention.length > 0 && !s.supervisorAttention[0].includes('No supervisor') ? `
              <div class="p-2 rounded bg-warning-subtle text-dark mb-2">
                <div class="fw-semibold mb-1 small"><i class="bi bi-info-circle me-1"></i>Attention Needed</div>
                ${supervisorHtml}
              </div>` : ''}

              ${Array.isArray(s.dataGaps) && s.dataGaps.length > 0 && !s.dataGaps[0].includes('No critical') ? `
              <div class="text-muted fw-semibold small text-uppercase mb-1" style="font-size: 0.7rem;">Missing Details</div>
              <ul class="ps-3 mb-0 small text-muted">
                ${dataGapsHtml}
              </ul>` : ''}
            </div>
          </div>
        </div>

        <div class="card-footer bg-white py-1 px-3 border-top text-muted d-flex justify-content-between align-items-center" style="font-size: 0.72rem;">
          <span>Summary generated from recorded history. Verify critical items with the log.</span>
          <button type="button" class="btn btn-sm btn-link text-secondary p-0 text-decoration-none" onclick="generateIncidentSummary('${esc(ticketId)}')">Refresh</button>
        </div>
      </div>
    `;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-sparkles me-1"></i>Summary';
    }
  } catch (err) {
    console.error('Incident summary error:', err);
    container.innerHTML = `
      <div class="alert alert-danger p-2 mb-0 small d-flex justify-content-between align-items-center" role="alert">
        <div><i class="bi bi-wifi-off me-1"></i>Unable to connect to server. Please try again.</div>
        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" onclick="generateIncidentSummary('${esc(ticketId)}')">Retry</button>
      </div>
    `;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-sparkles me-1"></i>Summary';
    }
  }
}
