const API = '';
let currentTab = 'monitor';
let refreshTimer = null;

// ── Tab Navigation ───────────────────────────────────────────

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-${tab}`).classList.add('active');

    if (tab === 'monitor') {
        loadJobs();
        startAutoRefresh();
    } else {
        stopAutoRefresh();
        resetForm();
    }
}

// ── Auto Refresh ─────────────────────────────────────────────

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(loadJobs, 10000);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// ── Load Jobs ────────────────────────────────────────────────

async function loadJobs() {
    try {
        const res = await fetch(`${API}/api/jobs`);
        const jobs = await res.json();
        renderJobs(jobs);
    } catch (err) {
        console.error('Failed to load jobs:', err);
    }
}

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
        const statusBadge = j.last_status
            ? `<span class="badge badge-${j.last_status}">${j.last_status}</span>`
            : `<span class="badge badge-none">no runs</span>`;
        const lastRun = j.last_run ? timeAgo(j.last_run) : '—';
        const scriptShort = c.script_path.split('/').slice(-2).join('/');

        return `<tr class="cursor-pointer" onclick="showRunHistory('${c.id}', '${escHtml(c.name)}')">
            <td class="px-4 py-3 font-medium text-gray-100">${escHtml(c.name)}</td>
            <td class="px-4 py-3 text-gray-400 text-xs font-mono">${escHtml(scriptShort)}</td>
            <td class="px-4 py-3 text-gray-400 text-xs font-mono">${j.next_run || '—'}</td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${lastRun}</td>
            <td class="px-4 py-3 flex gap-2" onclick="event.stopPropagation()">
                <button class="action-btn run" onclick="runNow('${c.id}')">Run</button>
                <button class="action-btn edit" onclick="editJob('${c.id}')">Edit</button>
                <button class="action-btn del" onclick="deleteJob('${c.id}', '${escHtml(c.name)}')">Del</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Run History ──────────────────────────────────────────────

async function showRunHistory(jobId, jobName) {
    document.getElementById('run-history-panel').classList.remove('hidden');
    document.getElementById('rh-job-name').textContent = jobName;

    try {
        const res = await fetch(`${API}/api/jobs/${jobId}/runs`);
        const runs = await res.json();
        renderRuns(runs);
    } catch (err) {
        console.error('Failed to load runs:', err);
    }
}

function closeRunHistory() {
    document.getElementById('run-history-panel').classList.add('hidden');
}

function renderRuns(runs) {
    const tbody = document.getElementById('run-table-body');
    if (runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500">No runs yet</td></tr>';
        return;
    }
    tbody.innerHTML = runs.map(r => {
        const dur = r.duration_ms != null ? formatDuration(r.duration_ms) : '—';
        const started = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
        return `<tr>
            <td class="px-4 py-3 font-mono text-xs text-gray-400">${r.id}</td>
            <td class="px-4 py-3"><span class="badge badge-${r.status}">${r.status}</span></td>
            <td class="px-4 py-3 text-gray-400 text-xs">${r.trigger}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${started}</td>
            <td class="px-4 py-3 text-gray-400 text-xs">${dur}</td>
            <td class="px-4 py-3">
                <button class="action-btn edit" onclick="viewLog('${r.id}')">View Log</button>
            </td>
        </tr>`;
    }).join('');
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

async function deleteJob(jobId, name) {
    if (!confirm(`Delete job "${name}"?`)) return;
    try {
        await fetch(`${API}/api/jobs/${jobId}`, { method: 'DELETE' });
        closeRunHistory();
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
    let crumbHtml = `<span class="cursor-pointer hover:text-blue-400" onclick="loadBrowserDir('')">~/Desktop/project</span>`;
    let acc = '';
    for (const p of parts) {
        acc += (acc ? '/' : '') + p;
        const pathStr = acc;
        crumbHtml += ` / <span class="cursor-pointer hover:text-blue-400" onclick="loadBrowserDir('${pathStr}')">${p}</span>`;
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
        html = '<div class="px-4 py-8 text-center text-gray-500 text-sm">No .sh or .py files here</div>';
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
