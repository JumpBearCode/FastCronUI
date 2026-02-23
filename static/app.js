const API = '';
let currentTab = 'monitor';
let refreshTimer = null;

// ── New global state ─────────────────────────────────────────
let currentSubTab = 'jobs';          // 'jobs' | 'runs'
let currentDetailSubTab = 'runs';    // 'runs' | 'tasks'
let currentDetailJobId = null;
let currentDetailJobName = null;
let allJobs = [];                    // cached for search/filter
let currentFilterType = 'all';       // 'all' | 'enabled' | 'disabled'
let jobConfigCache = {};             // jobId -> config (for "Job runs" tab)

// ── Tab Navigation ───────────────────────────────────────────

function switchTab(tab, jobId, jobName) {
    currentTab = tab;
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    if (tab === 'monitor') {
        document.getElementById('page-monitor').classList.remove('hidden');
        document.getElementById('tab-monitor').classList.add('active');
        loadJobs();
        startAutoRefresh();
    } else if (tab === 'create') {
        document.getElementById('page-create').classList.remove('hidden');
        document.getElementById('tab-create').classList.add('active');
        stopAutoRefresh();
        resetForm();
    } else if (tab === 'job-detail') {
        document.getElementById('page-job-detail').classList.remove('hidden');
        document.getElementById('tab-monitor').classList.add('active');
        stopAutoRefresh();
        loadJobDetail(jobId, jobName);
        startDetailAutoRefresh(jobId, jobName);
    }
}

// ── Sub-tab switching ────────────────────────────────────────

function switchSubTab(subTab) {
    currentSubTab = subTab;
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`subtab-${subTab}`).classList.add('active');

    document.getElementById('subtab-content-jobs').classList.toggle('hidden', subTab !== 'jobs');
    document.getElementById('subtab-content-runs').classList.toggle('hidden', subTab !== 'runs');

    if (subTab === 'runs') {
        loadAllRuns();
    }
}

function switchDetailSubTab(subTab) {
    currentDetailSubTab = subTab;
    document.querySelectorAll('.detail-subtab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`detail-subtab-${subTab}`).classList.add('active');

    document.getElementById('detail-content-runs').classList.toggle('hidden', subTab !== 'runs');
    document.getElementById('detail-content-tasks').classList.toggle('hidden', subTab !== 'tasks');
}

// ── Auto Refresh ─────────────────────────────────────────────

let detailRefreshTimer = null;

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(loadJobs, 10000);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    stopDetailAutoRefresh();
}

function startDetailAutoRefresh(jobId, jobName) {
    stopDetailAutoRefresh();
    detailRefreshTimer = setInterval(() => {
        if (currentTab === 'job-detail') {
            loadJobDetail(jobId, jobName);
        }
    }, 5000);
}

function stopDetailAutoRefresh() {
    if (detailRefreshTimer) {
        clearInterval(detailRefreshTimer);
        detailRefreshTimer = null;
    }
}

// ── Load Jobs ────────────────────────────────────────────────

async function loadJobs() {
    try {
        const res = await fetch(`${API}/api/jobs`);
        const jobs = await res.json();
        allJobs = jobs;
        // Build config cache for Job runs tab
        jobs.forEach(j => { jobConfigCache[j.config.id] = j.config; });
        applyFilters(jobs);
    } catch (err) {
        console.error('Failed to load jobs:', err);
    }
}

// ── Filtering ────────────────────────────────────────────────

function filterJobs() {
    applyFilters(allJobs);
}

function filterByType(type) {
    currentFilterType = type;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`.filter-chip[data-filter="${type}"]`).classList.add('active');
    applyFilters(allJobs);
}

function applyFilters(jobs) {
    let filtered = jobs;

    // Text search
    const query = (document.getElementById('job-search').value || '').toLowerCase().trim();
    if (query) {
        filtered = filtered.filter(j =>
            j.config.name.toLowerCase().includes(query) ||
            j.config.script_path.toLowerCase().includes(query)
        );
    }

    // Enabled/Disabled filter
    if (currentFilterType === 'enabled') {
        filtered = filtered.filter(j => j.config.enabled);
    } else if (currentFilterType === 'disabled') {
        filtered = filtered.filter(j => !j.config.enabled);
    }

    renderJobs(filtered);
}

// ── Render Jobs Table ────────────────────────────────────────

function renderJobs(jobs) {
    const tbody = document.getElementById('job-table-body');
    const noJobs = document.getElementById('no-jobs');

    if (jobs.length === 0) {
        tbody.innerHTML = '';
        noJobs.classList.remove('hidden');
        return;
    }
    noJobs.classList.add('hidden');

    tbody.innerHTML = jobs.map(j => {
        const c = j.config;
        const scriptExt = c.script_path.endsWith('.py') ? 'Python' : 'Shell';
        const triggerType = c.enabled ? 'Scheduled' : 'None';
        const recentDots = renderRecentRunDots(j.recent_runs || []);

        const hasRunning = (j.recent_runs || []).some(r => r.status === 'running');
        const stopBtn = hasRunning
            ? `<button class="action-btn kill" onclick="killJob('${c.id}')">Stop</button>`
            : '';

        return `<tr>
            <td class="px-4 py-3">
                <span class="job-link" onclick="switchTab('job-detail', '${c.id}', '${escHtml(c.name)}')">${escHtml(c.name)}</span>
            </td>
            <td class="px-4 py-3 text-gray-500 text-xs">${scriptExt}</td>
            <td class="px-4 py-3 text-gray-500 text-xs font-mono">${j.next_run || '—'}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${triggerType}</td>
            <td class="px-4 py-3">${recentDots}</td>
            <td class="px-4 py-3 flex gap-2">
                <button class="action-btn run" onclick="runNow('${c.id}')">Run</button>
                ${stopBtn}
                <button class="action-btn edit" onclick="editJob('${c.id}')">Edit</button>
                <button class="action-btn del" onclick="deleteJob('${c.id}', '${escHtml(c.name)}')">Del</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Recent Run Dots ──────────────────────────────────────────

function renderRecentRunDots(runs) {
    if (!runs || runs.length === 0) {
        return '<span class="text-gray-300 text-xs">—</span>';
    }
    // Show oldest first (left-to-right chronological)
    const ordered = [...runs].reverse();
    return ordered.map(r => {
        const title = `${r.status} — ${new Date(r.started_at).toLocaleString()}`;
        return `<span class="run-dot ${r.status}" title="${escHtml(title)}"></span>`;
    }).join('');
}

// ── Status Icon (Databricks style) ──────────────────────────

function getStatusIcon(status) {
    const icons = {
        success: `<svg class="inline w-4 h-4 mr-1" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#dcfce7"/><path d="M5 8l2 2 4-4" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="text-green-700">Succeeded</span>`,
        failed: `<svg class="inline w-4 h-4 mr-1" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#fee2e2"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/></svg><span class="text-red-700">Failed</span>`,
        running: `<svg class="inline w-4 h-4 mr-1 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#bfdbfe" stroke-width="1.5"/><path d="M8 1a7 7 0 0 1 7 7" stroke="#2563eb" stroke-width="1.5" stroke-linecap="round"/></svg><span class="text-blue-700">Running</span>`,
        timeout: `<svg class="inline w-4 h-4 mr-1" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#fef9c3"/><path d="M8 4v5l3 1.5" stroke="#ca8a04" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="text-yellow-700">Timeout</span>`,
        cancelled: `<svg class="inline w-4 h-4 mr-1" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#ffedd5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ea580c" stroke-width="1.5" stroke-linecap="round"/></svg><span class="text-orange-700">Cancelled</span>`,
    };
    return icons[status] || `<span class="badge badge-none">unknown</span>`;
}

// ── Load Job Detail ──────────────────────────────────────────

async function loadJobDetail(jobId, jobName) {
    currentDetailJobId = jobId;
    currentDetailJobName = jobName;

    document.getElementById('detail-job-name').textContent = jobName;
    document.getElementById('detail-job-title').textContent = jobName;

    // Reset to runs sub-tab
    switchDetailSubTab('runs');

    // Wire up buttons
    document.getElementById('detail-run-btn').onclick = () => {
        runNow(jobId).then(() => loadJobDetail(jobId, jobName));
    };
    document.getElementById('detail-edit-btn').onclick = () => editJob(jobId);

    try {
        const [jobRes, runsRes] = await Promise.all([
            fetch(`${API}/api/jobs/${jobId}`),
            fetch(`${API}/api/jobs/${jobId}/runs?limit=50`),
        ]);
        const job = await jobRes.json();
        const runs = await runsRes.json();

        // Badge
        const latestStatus = runs.length > 0 ? runs[0].status : null;
        document.getElementById('detail-job-badge').innerHTML = latestStatus
            ? `<span class="badge badge-${latestStatus}">${latestStatus}</span>`
            : `<span class="badge badge-none">no runs</span>`;

        // Show/hide Stop button based on whether any run is in progress
        const hasRunning = runs.some(r => r.status === 'running');
        const stopBtn = document.getElementById('detail-stop-btn');
        if (hasRunning) {
            stopBtn.classList.remove('hidden');
            stopBtn.onclick = () => killJob(jobId);
        } else {
            stopBtn.classList.add('hidden');
        }

        // Render runs
        renderRunChart(runs);
        renderDetailRuns(runs);
        renderTaskInfo(job);
    } catch (err) {
        console.error('Failed to load job detail:', err);
    }
}

// ── Render Detail Runs Table ─────────────────────────────────

function renderDetailRuns(runs) {
    const tbody = document.getElementById('detail-run-table-body');
    if (runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No runs yet</td></tr>';
        return;
    }
    tbody.innerHTML = runs.map(r => {
        const dur = r.duration_ms != null ? formatDuration(r.duration_ms) : '—';
        const started = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
        const exitCode = r.exit_code != null ? r.exit_code : '—';
        const stopAction = r.status === 'running'
            ? `<button class="action-btn kill" onclick="killJob('${r.job_id}')">Stop</button>`
            : '';
        return `<tr class="hover:bg-gray-50">
            <td class="px-4 py-3 text-gray-600 text-xs">${started}</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500">${r.id}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${r.trigger}</td>
            <td class="px-4 py-3 text-gray-600 text-xs">${dur}</td>
            <td class="px-4 py-3">${getStatusIcon(r.status)}</td>
            <td class="px-4 py-3 text-gray-500 text-xs font-mono">${exitCode}</td>
            <td class="px-4 py-3 flex gap-2">
                <button class="action-btn edit" onclick="viewLog('${r.id}')">Log</button>
                ${stopAction}
            </td>
        </tr>`;
    }).join('');
}

// ── Run Duration Chart (pure SVG) ────────────────────────────

function renderRunChart(runs) {
    const container = document.getElementById('run-chart');
    if (!runs || runs.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-sm py-4 text-center">No run data to display</p>';
        return;
    }

    // Take last 30 runs, oldest first
    const data = [...runs].slice(0, 30).reverse();
    const maxDur = Math.max(...data.map(r => r.duration_ms || 0), 1);

    const barWidth = 20;
    const barGap = 4;
    const chartHeight = 120;
    const labelHeight = 20;
    const svgWidth = data.length * (barWidth + barGap) + barGap;
    const svgHeight = chartHeight + labelHeight;

    const statusColor = {
        success: '#22c55e',
        failed: '#ef4444',
        running: '#3b82f6',
        timeout: '#eab308',
        cancelled: '#f97316',
    };

    const bars = data.map((r, i) => {
        const dur = r.duration_ms || 0;
        const barH = Math.max((dur / maxDur) * chartHeight, 2);
        const x = barGap + i * (barWidth + barGap);
        const y = chartHeight - barH;
        const color = statusColor[r.status] || '#9ca3af';
        const title = `${r.status} — ${formatDuration(dur)} — ${new Date(r.started_at).toLocaleString()}`;
        return `<rect class="run-bar" x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="2" fill="${color}" onclick="viewLog('${r.id}')"><title>${escHtml(title)}</title></rect>`;
    }).join('');

    // X-axis labels (show every few)
    const labelInterval = Math.max(1, Math.floor(data.length / 8));
    const labels = data.map((r, i) => {
        if (i % labelInterval !== 0) return '';
        const x = barGap + i * (barWidth + barGap) + barWidth / 2;
        const d = new Date(r.started_at);
        const label = `${d.getMonth() + 1}/${d.getDate()}`;
        return `<text x="${x}" y="${chartHeight + 14}" text-anchor="middle" fill="#9ca3af" font-size="9">${label}</text>`;
    }).join('');

    container.innerHTML = `<svg width="${svgWidth}" height="${svgHeight}" style="min-width:${svgWidth}px">${bars}${labels}</svg>`;
}

// ── Render Task Info ─────────────────────────────────────────

function renderTaskInfo(job) {
    const el = document.getElementById('task-info');
    const freq = job.schedule.frequency;
    let schedDesc = freq.charAt(0).toUpperCase() + freq.slice(1);
    if (freq === 'hourly' && job.schedule.interval) {
        schedDesc = `Every ${job.schedule.interval} minutes`;
    } else if (freq === 'daily') {
        schedDesc = `Daily at ${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}`;
    } else if (freq === 'weekly') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        schedDesc = `Weekly on ${days[job.schedule.day_of_week || 0]} at ${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}`;
    } else if (freq === 'monthly') {
        schedDesc = `Monthly on day ${job.schedule.day_of_month || 1} at ${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}`;
    }

    el.innerHTML = `
        <div class="space-y-4">
            <div>
                <h4 class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Script Path</h4>
                <p class="text-sm font-mono text-gray-800 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">${escHtml(job.script_path)}</p>
            </div>
            <div class="grid grid-cols-3 gap-4">
                <div>
                    <h4 class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Schedule</h4>
                    <p class="text-sm text-gray-800">${schedDesc}</p>
                </div>
                <div>
                    <h4 class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Timeout</h4>
                    <p class="text-sm text-gray-800">${formatDuration(job.timeout_seconds * 1000)}</p>
                </div>
                <div>
                    <h4 class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Status</h4>
                    <p class="text-sm text-gray-800">${job.enabled ? '<span class="text-green-600 font-medium">Enabled</span>' : '<span class="text-gray-400">Disabled</span>'}</p>
                </div>
            </div>
            <div>
                <h4 class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Cron Expression</h4>
                <p class="text-sm font-mono text-gray-800">${job.schedule.frequency === 'hourly' ? `*/${job.schedule.interval || 30} * * * *` : `${job.schedule.minute} ${job.schedule.hour} * * *`}</p>
            </div>
        </div>`;
}

// ── Load All Runs (global "Job runs" tab) ────────────────────

async function loadAllRuns() {
    const tbody = document.getElementById('all-runs-table-body');
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-gray-400">Loading...</td></tr>';
    try {
        const res = await fetch(`${API}/api/runs?limit=100`);
        const runs = await res.json();
        if (runs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No runs yet</td></tr>';
            return;
        }
        tbody.innerHTML = runs.map(r => {
            const dur = r.duration_ms != null ? formatDuration(r.duration_ms) : '—';
            const started = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
            const jobName = jobConfigCache[r.job_id] ? jobConfigCache[r.job_id].name : r.job_id;
            const stopAction = r.status === 'running'
                ? `<button class="action-btn kill" onclick="killJob('${r.job_id}')">Stop</button>`
                : '';
            return `<tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-mono text-xs text-gray-500">${r.id}</td>
                <td class="px-4 py-3">
                    <span class="job-link" onclick="switchTab('job-detail', '${r.job_id}', '${escHtml(jobName)}')">${escHtml(jobName)}</span>
                </td>
                <td class="px-4 py-3">${getStatusIcon(r.status)}</td>
                <td class="px-4 py-3 text-gray-500 text-xs">${r.trigger}</td>
                <td class="px-4 py-3 text-gray-600 text-xs">${started}</td>
                <td class="px-4 py-3 text-gray-600 text-xs">${dur}</td>
                <td class="px-4 py-3 flex gap-2">
                    <button class="action-btn edit" onclick="viewLog('${r.id}')">Log</button>
                    ${stopAction}
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Failed to load all runs:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-red-400">Failed to load runs</td></tr>';
    }
}

// ── Log Viewer ───────────────────────────────────────────────

async function viewLog(runId) {
    document.getElementById('log-modal').classList.remove('hidden');
    document.getElementById('log-run-id').textContent = runId;
    document.getElementById('log-content').textContent = 'Loading...';

    try {
        const res = await fetch(`${API}/api/runs/${runId}/log`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        document.getElementById('log-content').textContent = text || '(empty log)';
    } catch (err) {
        document.getElementById('log-content').textContent = `Error loading log: ${err.message}`;
    }
}

function closeLogModal() {
    document.getElementById('log-modal').classList.add('hidden');
}

// ── Actions ──────────────────────────────────────────────────

async function runNow(jobId) {
    try {
        await fetch(`${API}/api/jobs/${jobId}/run`, { method: 'POST' });
        setTimeout(loadJobs, 500);
    } catch (err) {
        alert('Failed to trigger run: ' + err.message);
    }
}

async function killJob(jobId) {
    try {
        const res = await fetch(`${API}/api/jobs/${jobId}/kill`, { method: 'POST' });
        const data = await res.json();
        if (data.killed > 0) {
            setTimeout(() => {
                loadJobs();
                // Also refresh detail page if we're on it
                if (currentTab === 'job-detail' && currentDetailJobId === jobId) {
                    loadJobDetail(jobId, currentDetailJobName);
                }
            }, 500);
        }
    } catch (err) {
        alert('Failed to stop job: ' + err.message);
    }
}

async function deleteJob(jobId, name) {
    if (!confirm(`Delete job "${name}"?`)) return;
    try {
        await fetch(`${API}/api/jobs/${jobId}`, { method: 'DELETE' });
        loadJobs();
    } catch (err) {
        alert('Failed to delete: ' + err.message);
    }
}

async function editJob(jobId) {
    try {
        const res = await fetch(`${API}/api/jobs/${jobId}`);
        const job = await res.json();
        switchTab('create');
        document.getElementById('form-title').textContent = 'Edit Job';
        document.getElementById('edit-job-id').value = job.id;
        document.getElementById('f-name').value = job.name;
        document.getElementById('f-script').value = job.script_path;
        document.getElementById('f-frequency').value = job.schedule.frequency;
        document.getElementById('f-hour').value = job.schedule.hour || 0;
        document.getElementById('f-minute').value = job.schedule.minute || 0;
        document.getElementById('f-timeout').value = job.timeout_seconds;

        if (job.schedule.interval) document.getElementById('f-interval').value = job.schedule.interval;
        if (job.schedule.day_of_week != null) document.getElementById('f-dow').value = job.schedule.day_of_week;
        if (job.schedule.day_of_month != null) document.getElementById('f-dom').value = job.schedule.day_of_month;

        updateScheduleFields();
    } catch (err) {
        alert('Failed to load job: ' + err.message);
    }
}

// ── Form ─────────────────────────────────────────────────────

function updateScheduleFields() {
    const freq = document.getElementById('f-frequency').value;
    document.getElementById('sched-hourly').classList.toggle('hidden', freq !== 'hourly');
    document.getElementById('sched-time').classList.toggle('hidden', freq === 'hourly');
    document.getElementById('sched-dow').classList.toggle('hidden', freq !== 'weekly');
    document.getElementById('sched-dom').classList.toggle('hidden', freq !== 'monthly');
}

function resetForm() {
    document.getElementById('form-title').textContent = 'Create New Job';
    document.getElementById('edit-job-id').value = '';
    document.getElementById('job-form').reset();
    document.getElementById('f-frequency').value = 'daily';
    updateScheduleFields();
}

function cancelEdit() {
    switchTab('monitor');
}

async function submitJob(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-job-id').value;
    const freq = document.getElementById('f-frequency').value;

    const schedule = { frequency: freq };
    if (freq === 'hourly') {
        schedule.interval = parseInt(document.getElementById('f-interval').value);
    } else {
        schedule.hour = parseInt(document.getElementById('f-hour').value);
        schedule.minute = parseInt(document.getElementById('f-minute').value);
    }
    if (freq === 'weekly') {
        schedule.day_of_week = parseInt(document.getElementById('f-dow').value);
    }
    if (freq === 'monthly') {
        schedule.day_of_month = parseInt(document.getElementById('f-dom').value);
    }

    const body = {
        name: document.getElementById('f-name').value,
        script_path: document.getElementById('f-script').value,
        schedule,
        timeout_seconds: parseInt(document.getElementById('f-timeout').value),
    };

    try {
        const url = editId ? `${API}/api/jobs/${editId}` : `${API}/api/jobs`;
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Request failed');
        }
        switchTab('monitor');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// ── File Browser ─────────────────────────────────────────────

let browserPath = '';

function openBrowser() {
    browserPath = '';
    document.getElementById('browser-modal').classList.remove('hidden');
    loadBrowserDir('');
}

function closeBrowser() {
    document.getElementById('browser-modal').classList.add('hidden');
}

async function loadBrowserDir(path) {
    browserPath = path;
    try {
        const res = await fetch(`${API}/api/browse?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        renderBrowser(data);
    } catch (err) {
        console.error('Browse error:', err);
    }
}

function renderBrowser(data) {
    const crumb = document.getElementById('browser-breadcrumb');
    const list = document.getElementById('browser-list');

    const parts = (data.path && data.path !== '.') ? data.path.split('/') : [];
    let crumbHtml = `<span class="cursor-pointer hover:text-blue-600" onclick="loadBrowserDir('')">~</span>`;
    let acc = '';
    for (const p of parts) {
        acc += (acc ? '/' : '') + p;
        const pathStr = acc;
        crumbHtml += ` / <span class="cursor-pointer hover:text-blue-600" onclick="loadBrowserDir('${pathStr}')">${p}</span>`;
    }
    crumb.innerHTML = crumbHtml;

    let html = '';
    if (browserPath) {
        const parent = browserPath.split('/').slice(0, -1).join('/');
        html += `<div class="browser-item dir" onclick="loadBrowserDir('${parent}')">
            <span class="icon">..</span><span>Parent Directory</span>
        </div>`;
    }

    for (const item of data.items || []) {
        if (item.type === 'dir') {
            const dirPath = browserPath ? `${browserPath}/${item.name}` : item.name;
            html += `<div class="browser-item dir" onclick="loadBrowserDir('${dirPath}')">
                <span class="icon">📁</span><span>${escHtml(item.name)}</span>
            </div>`;
        } else {
            html += `<div class="browser-item file" onclick="selectFile('${escHtml(item.path)}')">
                <span class="icon">📄</span><span>${escHtml(item.name)}</span>
            </div>`;
        }
    }

    if (!data.items || data.items.length === 0) {
        html = '<div class="px-4 py-8 text-center text-gray-400 text-sm">No files here</div>';
    }

    list.innerHTML = html;
}

function selectFile(path) {
    document.getElementById('f-script').value = path;
    closeBrowser();
}

// ── Helpers ──────────────────────────────────────────────────

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
}

// Close modals on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeLogModal();
        closeBrowser();
    }
});

// Init
switchTab('monitor');
