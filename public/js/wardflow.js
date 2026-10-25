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

// AI Incident Summary
async function generateIncidentSummary(ticketId) {
  const btn = document.getElementById('btnGenerateSummary');
  const container = document.getElementById('aiSummaryContainer');
  if (!ticketId || !container) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Analyzing Incident...';
  }

  container.classList.remove('d-none');
  container.innerHTML = `
    <div class="wf-card border-primary-subtle shadow-sm p-4 text-center">
      <div class="spinner-border text-primary mb-2" role="status"></div>
      <div class="fw-semibold text-dark">Generating AI Incident Summary...</div>
      <div class="text-muted small mt-1">Analyzing reported details, chronological audit history, and operational comments with Google Gemini.</div>
    </div>
  `;

  // Safe HTML escaper to strictly prevent executable HTML injection
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
      const errMsg = data.error || `Failed to generate summary (HTTP ${res.status}).`;
      container.innerHTML = `
        <div class="alert alert-danger d-flex align-items-center justify-content-between p-3 mb-0" role="alert">
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>AI Summary Failed:</strong> ${esc(errMsg)}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="generateIncidentSummary('${esc(ticketId)}')">
            <i class="bi bi-arrow-clockwise me-1"></i>Retry
          </button>
        </div>
      `;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-stars me-1"></i>Generate AI Summary';
      }
      return;
    }

    const s = data.summary;
    const meta = s.metadata || {};
    const curr = s.currentStatus || {};
    const formattedTime = meta.generatedAt ? new Date(meta.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString();

    // Build Actions Taken List
    const actionsHtml = Array.isArray(s.actionsTaken) && s.actionsTaken.length > 0
      ? s.actionsTaken.map(a => `<li class="mb-1 text-secondary">${esc(a)}</li>`).join('')
      : '<li class="text-muted fst-italic">No recorded actions.</li>';

    // Build Outstanding Actions List
    const outstandingHtml = Array.isArray(s.outstandingActions) && s.outstandingActions.length > 0
      ? s.outstandingActions.map(o => `<li class="mb-1 text-secondary">${esc(o)}</li>`).join('')
      : '<li class="text-muted fst-italic">No pending actions recorded.</li>';

    // Build Timeline
    const timelineHtml = Array.isArray(s.timeline) && s.timeline.length > 0
      ? s.timeline.map(t => `
          <div class="d-flex align-items-start gap-2 mb-2 pb-2 border-bottom border-light">
            <span class="badge bg-light text-dark border font-monospace" style="font-size: 0.72rem; min-width: 140px;">${esc(t.timestamp)}</span>
            <span class="small text-secondary flex-grow-1">${esc(t.event)}</span>
          </div>
        `).join('')
      : '<div class="text-muted small fst-italic">No timeline recorded.</div>';

    // Build Supervisor Attention List
    const supervisorHtml = Array.isArray(s.supervisorAttention) && s.supervisorAttention.length > 0
      ? s.supervisorAttention.map(item => `
          <div class="d-flex align-items-start gap-2 mb-1">
            <i class="bi bi-exclamation-circle text-warning mt-1"></i>
            <span class="small text-dark fw-medium">${esc(item)}</span>
          </div>
        `).join('')
      : '<div class="text-muted small fst-italic">No supervisor escalation items recorded.</div>';

    // Build Data Gaps List
    const dataGapsHtml = Array.isArray(s.dataGaps) && s.dataGaps.length > 0
      ? s.dataGaps.map(g => `<li class="mb-1 text-secondary">${esc(g)}</li>`).join('')
      : '<li class="text-muted fst-italic">No critical data gaps noted in current records.</li>';

    container.innerHTML = `
      <div class="wf-card border-primary shadow-sm">
        <!-- Card Header -->
        <div class="p-3 border-bottom bg-light-subtle d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-primary text-white d-flex align-items-center gap-1 py-1 px-2">
              <i class="bi bi-stars"></i> Gemini AI
            </span>
            <h6 class="mb-0 fw-bold text-dark">Incident Summary &amp; Historical Overview</h6>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="text-muted small"><i class="bi bi-clock me-1"></i>Generated at ${esc(formattedTime)}</span>
            <button type="button" class="btn btn-sm btn-link text-secondary p-0 ms-2 text-decoration-none" onclick="document.getElementById('aiSummaryContainer').classList.add('d-none')" title="Close Summary">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
        </div>

        <div class="wf-card-body p-4">
          <!-- 1. Incident Overview -->
          <div class="mb-4">
            <div class="meta-label mb-1 text-uppercase text-primary fw-bold" style="font-size: 0.72rem; letter-spacing: 0.05em;">
              <i class="bi bi-file-text me-1"></i>1. Incident Overview
            </div>
            <div class="p-3 rounded bg-light border text-dark" style="font-size: 0.875rem; line-height: 1.6;">
              ${esc(s.incidentOverview)}
            </div>
          </div>

          <!-- 2. Current Status & SLA Telemetry (Database Anchored) -->
          <div class="mb-4">
            <div class="meta-label mb-2 text-uppercase text-primary fw-bold" style="font-size: 0.72rem; letter-spacing: 0.05em;">
              <i class="bi bi-speedometer2 me-1"></i>2. Current Status &amp; SLA Condition (Live Database)
            </div>
            <div class="row g-2">
              <div class="col-sm-3">
                <div class="p-2 border rounded bg-light text-center">
                  <div class="text-muted" style="font-size: 0.7rem;">STATUS</div>
                  <div class="fw-semibold text-dark text-capitalize">${esc(curr.status || 'open')}</div>
                </div>
              </div>
              <div class="col-sm-3">
                <div class="p-2 border rounded bg-light text-center">
                  <div class="text-muted" style="font-size: 0.7rem;">PRIORITY</div>
                  <div class="fw-semibold text-dark text-uppercase">${esc(curr.priority || 'medium')}</div>
                </div>
              </div>
              <div class="col-sm-3">
                <div class="p-2 border rounded bg-light text-center">
                  <div class="text-muted" style="font-size: 0.7rem;">CURRENT ASSIGNEE</div>
                  <div class="fw-semibold text-dark text-truncate">${esc(curr.assignee || 'Unassigned')}</div>
                </div>
              </div>
              <div class="col-sm-3">
                <div class="p-2 border rounded ${curr.isOverdue ? 'bg-danger-subtle border-danger' : 'bg-light'} text-center">
                  <div class="text-muted" style="font-size: 0.7rem;">SLA STATE</div>
                  <div class="fw-semibold ${curr.isOverdue ? 'text-danger' : 'text-dark'}" style="font-size: 0.8rem;">${esc(curr.slaState || 'On Track')}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Actions Taken & 4. Outstanding Actions -->
          <div class="row g-3 mb-4">
            <div class="col-md-6">
              <div class="p-3 border rounded h-100 bg-white">
                <div class="meta-label mb-2 text-uppercase fw-bold text-dark" style="font-size: 0.72rem;">
                  <i class="bi bi-check2-circle text-success me-1"></i>3. Actions Taken (History)
                </div>
                <ul class="mb-0 ps-3 small">
                  ${actionsHtml}
                </ul>
              </div>
            </div>
            <div class="col-md-6">
              <div class="p-3 border rounded h-100 bg-white">
                <div class="meta-label mb-2 text-uppercase fw-bold text-dark" style="font-size: 0.72rem;">
                  <i class="bi bi-hourglass-split text-warning me-1"></i>4. Outstanding Actions
                </div>
                <ul class="mb-0 ps-3 small">
                  ${outstandingHtml}
                </ul>
              </div>
            </div>
          </div>

          <!-- 5. Timeline of Milestones -->
          <div class="mb-4">
            <div class="meta-label mb-2 text-uppercase text-dark fw-bold" style="font-size: 0.72rem;">
              <i class="bi bi-calendar-event me-1"></i>5. Chronological Milestones
            </div>
            <div class="p-3 border rounded bg-white">
              ${timelineHtml}
            </div>
          </div>

          <!-- 6. Supervisor Attention & 7. Data Gaps -->
          <div class="row g-3">
            <div class="col-md-6">
              <div class="p-3 border rounded h-100 bg-warning-subtle border-warning-subtle">
                <div class="meta-label mb-2 text-uppercase fw-bold text-dark" style="font-size: 0.72rem;">
                  <i class="bi bi-bell-fill text-warning me-1"></i>6. Supervisor Attention Items
                </div>
                ${supervisorHtml}
              </div>
            </div>
            <div class="col-md-6">
              <div class="p-3 border rounded h-100 bg-light">
                <div class="meta-label mb-2 text-uppercase fw-bold text-dark" style="font-size: 0.72rem;">
                  <i class="bi bi-question-circle text-secondary me-1"></i>7. Documented Data Gaps
                </div>
                <ul class="mb-0 ps-3 small">
                  ${dataGapsHtml}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Card Footer: Disclaimer -->
        <div class="card-footer bg-light py-2 px-3 border-top d-flex align-items-center justify-content-between flex-wrap gap-2 text-muted" style="font-size: 0.75rem;">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-shield-check text-success"></i>
            <span><strong>Human Verification Notice:</strong> Automatically summarized with ${esc(meta.model || 'Gemini AI')}. Primary database records remain the authoritative source.</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size: 0.72rem;" onclick="generateIncidentSummary('${esc(ticketId)}')">
            <i class="bi bi-arrow-clockwise me-1"></i>Regenerate
          </button>
        </div>
      </div>
    `;

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Regenerate AI Summary';
    }
  } catch (err) {
    console.error('Incident summary client error:', err);
    container.innerHTML = `
      <div class="alert alert-danger d-flex align-items-center justify-content-between p-3 mb-0" role="alert">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-wifi-off fs-5"></i>
          <div><strong>Network Error:</strong> Unable to communicate with the server. Please check your connection.</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="generateIncidentSummary('${esc(ticketId)}')">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>
    `;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-stars me-1"></i>Generate AI Summary';
    }
  }
}
