/* =============================================
   TaskFlow AI — Firebase-Powered Application
   ============================================= */

// Firebase SDK imports (CDN ESM)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
    getAuth, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged,
    GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import {
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';

// ── Firebase Config ──
const firebaseConfig = {
    apiKey: "Add your API Key",
    authDomain: "taskflow-ai-manager.firebaseapp.com",
    projectId: "taskflow-ai-manager",
    storageBucket: "taskflow-ai-manager.firebasestorage.app",
    messagingSenderId: "Add you Messaging Sender ID",
    appId: "Add your App ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Constants ──
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const STATUS_EMOJI = { 'todo': '📌', 'in-progress': '🔄', 'done': '✅' };
const STATUS_LABELS = { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': 'Done' };

// ── State ──
let tasks = [];
let editingTaskId = null;
let deleteTaskId = null;
let importBuffer = [];
let currentUser = null;
let unsubscribeSnapshot = null;

// ── DOM Refs ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    // Auth
    authScreen: $('#authScreen'),
    appContainer: $('#appContainer'),
    btnGoogleSignIn: $('#btnGoogleSignIn'),
    btnAnonSignIn: $('#btnAnonSignIn'),
    // User menu
    userAvatar: $('#userAvatar'),
    userDropdown: $('#userDropdown'),
    userName: $('#userName'),
    userEmail: $('#userEmail'),
    btnSignOut: $('#btnSignOut'),
    // Sync
    syncIndicator: $('#syncIndicator'),
    // Main
    taskGroups: $('#taskGroups'),
    globalSearch: $('#globalSearch'),
    filterStatus: $('#filterStatus'),
    filterPriority: $('#filterPriority'),
    // Stats
    statTotal: $('#statTotal'),
    statDone: $('#statDone'),
    statInProgress: $('#statInProgress'),
    statOverdue: $('#statOverdue'),
    statUpcoming: $('#statUpcoming'),
    progressRing: $('#progressRingCircle'),
    progressPercent: $('#progressPercent'),
    // Task Modal
    taskModal: $('#taskModal'),
    modalTitle: $('#modalTitle'),
    modalClose: $('#modalClose'),
    modalCancel: $('#modalCancel'),
    modalSave: $('#modalSave'),
    taskTitle: $('#taskTitle'),
    taskDescription: $('#taskDescription'),
    taskStatus: $('#taskStatus'),
    taskDate: $('#taskDate'),
    taskCategory: $('#taskCategory'),
    taskRecurring: $('#taskRecurring'),
    taskRecurringFreq: $('#taskRecurringFreq'),
    recurringOptions: $('#recurringOptions'),
    priorityOptions: $('#priorityOptions'),
    // Confirm Modal
    confirmModal: $('#confirmModal'),
    confirmClose: $('#confirmClose'),
    confirmCancel: $('#confirmCancel'),
    confirmDelete: $('#confirmDelete'),
    confirmTaskName: $('#confirmTaskName'),
    // Import Modal
    importModal: $('#importModal'),
    importClose: $('#importClose'),
    importCancel: $('#importCancel'),
    importConfirm: $('#importConfirm'),
    importDropZone: $('#importDropZone'),
    importFileInput: $('#importFileInput'),
    importPreview: $('#importPreview'),
    // Export Modal
    exportModal: $('#exportModal'),
    exportClose: $('#exportClose'),
    exportCancel: $('#exportCancel'),
    exportCSV: $('#exportCSV'),
    exportJSON: $('#exportJSON'),
    // Review Panel
    reviewPanel: $('#reviewPanel'),
    reviewOverlay: $('#reviewOverlay'),
    reviewClose: $('#reviewClose'),
    reviewContent: $('#reviewContent'),
    // Toast
    toastContainer: $('#toastContainer'),
};

// ── Utilities ──
function today() {
    return new Date().toISOString().slice(0, 10);
}

function toDateStr(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysDiff(dateStr) {
    if (!dateStr) return Infinity;
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor((target - now) / (1000 * 60 * 60 * 24));
}

function relativeDateLabel(dateStr) {
    const diff = daysDiff(dateStr);
    if (diff < -1) return `${Math.abs(diff)} days overdue`;
    if (diff === -1) return '1 day overdue';
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    if (diff <= 7) return `${diff} days left`;
    return toDateStr(dateStr);
}

function isOverdue(task) {
    return task.status !== 'done' && daysDiff(task.targetDate) < 0;
}

function isToday(dateStr) {
    return daysDiff(dateStr) === 0;
}

function isThisWeek(dateStr) {
    const diff = daysDiff(dateStr);
    return diff >= 1 && diff <= 7;
}

function getWeekStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Toast Notifications ──
function toast(message, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
    dom.toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ── Modals ──
function openModal(overlay) {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal(overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

function closeAllModals() {
    $$('.modal-overlay').forEach(m => closeModal(m));
    closeReviewPanel();
}

// ── Sync Indicator ──
function showSync() {
    dom.syncIndicator.style.display = 'flex';
}
function hideSync() {
    dom.syncIndicator.style.display = 'none';
}

// ══════════════════════════════════════
//  AUTHENTICATION
// ══════════════════════════════════════

function setupAuth() {
    // Google Sign-In
    dom.btnGoogleSignIn.addEventListener('click', async () => {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (err) {
            if (err.code !== 'auth/popup-closed-by-user') {
                toast('Sign-in failed: ' + err.message, 'error');
            }
        }
    });

    // Anonymous Sign-In
    dom.btnAnonSignIn.addEventListener('click', async () => {
        try {
            await signInAnonymously(auth);
        } catch (err) {
            toast('Guest sign-in failed: ' + err.message, 'error');
        }
    });

    // Sign Out
    dom.btnSignOut.addEventListener('click', async () => {
        try {
            await signOut(auth);
            toast('Signed out.', 'info');
        } catch (err) {
            toast('Sign-out error: ' + err.message, 'error');
        }
    });

    // User avatar dropdown
    dom.userAvatar.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.userDropdown.classList.toggle('active');
    });
    document.addEventListener('click', () => {
        dom.userDropdown.classList.remove('active');
    });

    // Auth State Listener
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            showApp(user);
        } else {
            showAuthScreen();
        }
    });
}

function showApp(user) {
    dom.authScreen.style.display = 'none';
    dom.appContainer.style.display = 'block';

    // Set user info
    dom.userName.textContent = user.displayName || (user.isAnonymous ? 'Guest' : 'User');
    dom.userEmail.textContent = user.email || (user.isAnonymous ? 'Local-only mode' : '');

    if (user.photoURL) {
        dom.userAvatar.innerHTML = `<img src="${user.photoURL}" alt="Avatar">`;
    } else {
        dom.userAvatar.innerHTML = user.isAnonymous ? '👤' : '🧑';
    }

    // Start listening to Firestore (or localStorage for anonymous)
    startTaskSync(user);
}

function showAuthScreen() {
    dom.authScreen.style.display = 'flex';
    dom.appContainer.style.display = 'none';

    // Stop listening
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
    }
    tasks = [];
}

// ══════════════════════════════════════
//  DATA SYNC (Firestore / localStorage)
// ══════════════════════════════════════

function getTasksCollection() {
    return collection(db, 'users', currentUser.uid, 'tasks');
}

function startTaskSync(user) {
    // Stop old listener
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
    }

    if (user.isAnonymous) {
        // Anonymous users: use localStorage
        loadFromLocalStorage();
        render();
        return;
    }

    // Authenticated users: real-time Firestore listener
    showSync();
    const tasksRef = getTasksCollection();
    const q = query(tasksRef, orderBy('createdAt', 'desc'));

    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        hideSync();
        render();
    }, (err) => {
        hideSync();
        console.error('Firestore sync error:', err);
        toast('Sync error. Changes may not persist.', 'error');
    });
}

// localStorage fallback for anonymous
function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem('taskflow_ai_tasks');
        tasks = raw ? JSON.parse(raw) : getSampleTasks();
        if (!raw) saveToLocalStorage();
    } catch {
        tasks = getSampleTasks();
    }
}

function saveToLocalStorage() {
    localStorage.setItem('taskflow_ai_tasks', JSON.stringify(tasks));
}

// ── Firestore CRUD ──
async function addTaskToFirestore(taskData) {
    showSync();
    try {
        await addDoc(getTasksCollection(), taskData);
    } catch (err) {
        hideSync();
        toast('Failed to save task: ' + err.message, 'error');
    }
}

async function updateTaskInFirestore(taskId, updates) {
    showSync();
    try {
        const taskRef = doc(db, 'users', currentUser.uid, 'tasks', taskId);
        await updateDoc(taskRef, updates);
    } catch (err) {
        hideSync();
        toast('Failed to update task: ' + err.message, 'error');
    }
}

async function deleteTaskFromFirestore(taskId) {
    showSync();
    try {
        const taskRef = doc(db, 'users', currentUser.uid, 'tasks', taskId);
        await deleteDoc(taskRef);
    } catch (err) {
        hideSync();
        toast('Failed to delete task: ' + err.message, 'error');
    }
}

async function batchAddToFirestore(tasksArr) {
    showSync();
    try {
        const batch = writeBatch(db);
        const colRef = getTasksCollection();
        tasksArr.forEach(t => {
            const ref = doc(colRef);
            batch.set(ref, t);
        });
        await batch.commit();
    } catch (err) {
        hideSync();
        toast('Batch import failed: ' + err.message, 'error');
    }
}

function isAnonymous() {
    return currentUser && currentUser.isAnonymous;
}

// ── Stats ──
function updateStats() {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress').length;
    const overdue = tasks.filter(t => isOverdue(t)).length;
    const upcoming = tasks.filter(t => t.status !== 'done' && daysDiff(t.targetDate) >= 0).length;

    dom.statTotal.textContent = total;
    dom.statDone.textContent = done;
    dom.statInProgress.textContent = inProgress;
    dom.statOverdue.textContent = overdue;
    dom.statUpcoming.textContent = upcoming;

    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const circumference = 2 * Math.PI * 18;
    const offset = circumference - (pct / 100) * circumference;
    dom.progressRing.style.strokeDashoffset = offset;
    dom.progressPercent.textContent = `${pct}%`;
}

// ── Sorting & Grouping ──
function sortTasks(list) {
    return [...list].sort((a, b) => {
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        const aOv = isOverdue(a) ? 0 : 1;
        const bOv = isOverdue(b) ? 0 : 1;
        if (aOv !== bOv) return aOv - bOv;
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        return daysDiff(a.targetDate) - daysDiff(b.targetDate);
    });
}

function groupTasks(list) {
    const groups = {
        overdue: { label: '🚨 Overdue', tasks: [], cssClass: 'overdue' },
        today: { label: '📅 Today', tasks: [], cssClass: '' },
        thisWeek: { label: '📆 This Week', tasks: [], cssClass: '' },
        upcoming: { label: '🔮 Upcoming', tasks: [], cssClass: '' },
        completed: { label: '✅ Completed', tasks: [], cssClass: '' },
    };

    list.forEach(t => {
        if (t.status === 'done') groups.completed.tasks.push(t);
        else if (isOverdue(t)) groups.overdue.tasks.push(t);
        else if (isToday(t.targetDate)) groups.today.tasks.push(t);
        else if (isThisWeek(t.targetDate)) groups.thisWeek.tasks.push(t);
        else groups.upcoming.tasks.push(t);
    });

    return groups;
}

// ── Filters ──
function getFilteredTasks() {
    const searchTerm = dom.globalSearch.value.toLowerCase().trim();
    const statusFilter = dom.filterStatus.value;
    const priorityFilter = dom.filterPriority.value;

    return tasks.filter(t => {
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
        if (searchTerm) {
            const hay = `${t.title} ${t.description} ${t.category}`.toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    });
}

// ── Render ──
function render() {
    const filtered = getFilteredTasks();
    const sorted = sortTasks(filtered);
    const groups = groupTasks(sorted);

    let html = '';
    let anyVisible = false;

    for (const [key, group] of Object.entries(groups)) {
        if (group.tasks.length === 0) continue;
        anyVisible = true;
        html += `
      <div class="task-group">
        <div class="group-header ${group.cssClass}">
          <h2>${group.label}</h2>
          <span class="group-count">${group.tasks.length}</span>
        </div>
        <div class="task-list">
          ${group.tasks.map(t => renderTaskCard(t)).join('')}
        </div>
      </div>
    `;
    }

    if (!anyVisible) {
        html = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <h3>${tasks.length === 0 ? 'No tasks yet!' : 'No matching tasks'}</h3>
        <p>${tasks.length === 0 ? 'Click "Add Task" to get started.' : 'Try adjusting your search or filters.'}</p>
      </div>
    `;
    }

    dom.taskGroups.innerHTML = html;
    updateStats();
}

function renderTaskCard(task) {
    const overdue = isOverdue(task);
    const priorityCls = `priority-${task.priority}`;
    const statusCls = task.status === 'done' ? 'is-done' : '';
    const overdueCls = overdue ? 'is-overdue' : '';
    const dateLabel = relativeDateLabel(task.targetDate);

    return `
    <div class="task-card ${priorityCls} ${statusCls} ${overdueCls}" data-id="${task.id}">
      <div class="priority-indicator ${task.priority}" title="${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} Priority">
        ${PRIORITY_EMOJI[task.priority]}
      </div>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="badge badge-${task.status}">${STATUS_EMOJI[task.status]} ${STATUS_LABELS[task.status]}</span>
          ${overdue ? '<span class="badge badge-overdue">⚠️ OVERDUE</span>' : ''}
          ${task.category ? `<span class="badge badge-category">${escapeHtml(task.category)}</span>` : ''}
          <span class="task-meta-item ${overdue ? 'overdue-badge' : ''}">
            📅 ${dateLabel}
          </span>
        </div>
      </div>
      <div class="task-actions">
        ${task.status !== 'done' ? `
          <button class="task-action-btn complete" title="Mark Complete" data-action="complete" data-id="${task.id}">✓</button>
        ` : `
          <button class="task-action-btn" title="Mark In Progress" data-action="reopen" data-id="${task.id}">↩️</button>
        `}
        <button class="task-action-btn" title="Edit" data-action="edit" data-id="${task.id}">✏️</button>
        <button class="task-action-btn delete" title="Delete" data-action="delete" data-id="${task.id}">🗑️</button>
      </div>
    </div>
  `;
}

// ── CRUD Operations ──
function openAddModal() {
    editingTaskId = null;
    dom.modalTitle.textContent = 'Add New Task';
    dom.modalSave.innerHTML = '💾 Save Task';
    resetForm();
    dom.taskDate.value = today();
    selectPriority('medium');
    openModal(dom.taskModal);
    dom.taskTitle.focus();
}

function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    editingTaskId = id;
    dom.modalTitle.textContent = 'Edit Task';
    dom.modalSave.innerHTML = '💾 Update Task';

    dom.taskTitle.value = task.title;
    dom.taskDescription.value = task.description || '';
    dom.taskStatus.value = task.status;
    dom.taskDate.value = task.targetDate;
    dom.taskCategory.value = task.category || '';
    dom.taskRecurring.checked = !!task.isRecurring;
    if (task.isRecurring) {
        dom.recurringOptions.classList.add('visible');
        dom.taskRecurringFreq.value = task.recurringFreq || 'daily';
    } else {
        dom.recurringOptions.classList.remove('visible');
        dom.taskRecurringFreq.value = 'daily';
    }
    selectPriority(task.priority);

    openModal(dom.taskModal);
    dom.taskTitle.focus();
}

async function saveTask() {
    const title = dom.taskTitle.value.trim();
    const targetDate = dom.taskDate.value;

    if (!title) {
        toast('Please enter a task title.', 'error');
        dom.taskTitle.focus();
        return;
    }
    if (!targetDate) {
        toast('Please select a target date.', 'error');
        dom.taskDate.focus();
        return;
    }

    const priority = dom.priorityOptions.querySelector('.priority-option.selected')?.dataset.priority || 'medium';
    const status = dom.taskStatus.value;
    const isRecurring = dom.taskRecurring.checked;
    const recurringFreq = isRecurring ? dom.taskRecurringFreq.value : null;

    if (editingTaskId) {
        // Update
        const updates = {
            title,
            description: dom.taskDescription.value.trim(),
            priority,
            status,
            targetDate,
            category: dom.taskCategory.value.trim(),
            isRecurring,
            recurringFreq,
            completedAt: status === 'done' ? new Date().toISOString() : null,
        };

        if (isAnonymous()) {
            const task = tasks.find(t => t.id === editingTaskId);
            if (task) Object.assign(task, updates);
            saveToLocalStorage();
            render();
        } else {
            await updateTaskInFirestore(editingTaskId, updates);
        }
        toast('Task updated!', 'success');
    } else {
        // Create
        const taskData = {
            title,
            description: dom.taskDescription.value.trim(),
            priority,
            status,
            targetDate,
            category: dom.taskCategory.value.trim(),
            isRecurring,
            recurringFreq,
            createdAt: new Date().toISOString(),
            completedAt: status === 'done' ? new Date().toISOString() : null,
        };

        if (isAnonymous()) {
            taskData.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
            tasks.push(taskData);
            saveToLocalStorage();
            render();
        } else {
            await addTaskToFirestore(taskData);
        }
        toast('Task added! 🎉', 'success');
    }

    closeModal(dom.taskModal);
    resetForm();
}

async function completeTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (task.isRecurring) {
        const currentTarget = new Date(task.targetDate + 'T00:00:00');
        if (task.recurringFreq === 'daily') {
            currentTarget.setDate(currentTarget.getDate() + 1);
        } else if (task.recurringFreq === 'weekdays') {
            do {
                currentTarget.setDate(currentTarget.getDate() + 1);
            } while (currentTarget.getDay() === 0 || currentTarget.getDay() === 6);
        } else if (task.recurringFreq === 'weekly') {
            currentTarget.setDate(currentTarget.getDate() + 7);
        } else if (task.recurringFreq === 'monthly') {
            currentTarget.setMonth(currentTarget.getMonth() + 1);
        }

        const nextDateStr = currentTarget.toISOString().slice(0, 10);

        if (isAnonymous()) {
            task.targetDate = nextDateStr;
            task.status = 'todo';
            saveToLocalStorage();
            render();
        } else {
            await updateTaskInFirestore(id, { targetDate: nextDateStr, status: 'todo' });
        }
        toast(`Task rescheduled for ${toDateStr(nextDateStr)} 🔁`, 'success');
        return;
    }

    if (isAnonymous()) {
        task.status = 'done'; task.completedAt = new Date().toISOString();
        saveToLocalStorage();
        render();
    } else {
        await updateTaskInFirestore(id, { status: 'done', completedAt: new Date().toISOString() });
    }
    toast('Task completed! 🎉', 'success');
}

async function reopenTask(id) {
    if (isAnonymous()) {
        const task = tasks.find(t => t.id === id);
        if (task) { task.status = 'in-progress'; task.completedAt = null; }
        saveToLocalStorage();
        render();
    } else {
        await updateTaskInFirestore(id, { status: 'in-progress', completedAt: null });
    }
    toast('Task reopened.', 'info');
}

function requestDelete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    deleteTaskId = id;
    dom.confirmTaskName.textContent = `"${task.title}"`;
    openModal(dom.confirmModal);
}

async function confirmDeleteTask() {
    if (!deleteTaskId) return;
    if (isAnonymous()) {
        tasks = tasks.filter(t => t.id !== deleteTaskId);
        saveToLocalStorage();
        render();
    } else {
        await deleteTaskFromFirestore(deleteTaskId);
    }
    deleteTaskId = null;
    closeModal(dom.confirmModal);
    toast('Task deleted.', 'info');
}

function resetForm() {
    dom.taskTitle.value = '';
    dom.taskDescription.value = '';
    dom.taskStatus.value = 'todo';
    dom.taskDate.value = '';
    dom.taskCategory.value = '';
    dom.taskRecurring.checked = false;
    dom.recurringOptions.classList.remove('visible');
    dom.taskRecurringFreq.value = 'daily';
    selectPriority('medium');
}

function selectPriority(priority) {
    dom.priorityOptions.querySelectorAll('.priority-option').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.priority === priority);
    });
}

// ── Import ──
function openImportModal() {
    importBuffer = [];
    dom.importPreview.style.display = 'none';
    dom.importPreview.innerHTML = '';
    dom.importConfirm.disabled = true;
    dom.importDropZone.innerHTML = `
    <div class="drop-icon">📁</div>
    <p>Drag & drop a file here, or <strong>click to browse</strong></p>
    <p class="file-types">Supports CSV and JSON files</p>
  `;
    openModal(dom.importModal);
}

function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        try {
            if (file.name.endsWith('.json')) {
                importBuffer = parseJSON(content);
            } else if (file.name.endsWith('.csv')) {
                importBuffer = parseCSV(content);
            } else {
                toast('Unsupported file format. Use CSV or JSON.', 'error');
                return;
            }
            if (importBuffer.length === 0) {
                toast('No valid tasks found in file.', 'error');
                return;
            }
            showImportPreview(importBuffer, file.name);
        } catch (err) {
            toast(`Parse error: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

function parseJSON(content) {
    let data = JSON.parse(content);
    if (!Array.isArray(data)) data = [data];
    return data.map(normalizeTask).filter(Boolean);
}

function parseCSV(content) {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length) continue;
        const obj = {};
        headers.forEach((h, idx) => obj[h] = values[idx]);
        const t = normalizeTask(obj);
        if (t) result.push(t);
    }
    return result;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuote = !inQuote;
        else if (c === ',' && !inQuote) { result.push(current.trim()); current = ''; }
        else current += c;
    }
    result.push(current.trim());
    return result;
}

function normalizeTask(obj) {
    const title = obj.title || obj.Title || obj.name || obj.Name || '';
    if (!title.trim()) return null;
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const validStatuses = ['todo', 'in-progress', 'done'];
    let priority = (obj.priority || obj.Priority || 'medium').toLowerCase();
    if (!validPriorities.includes(priority)) priority = 'medium';
    let status = (obj.status || obj.Status || 'todo').toLowerCase().replace(' ', '-');
    if (!validStatuses.includes(status)) status = 'todo';
    let targetDate = obj.targetDate || obj.targetdate || obj['target date'] || obj.date || obj.Date || obj.due || obj.Due || today();
    if (isNaN(Date.parse(targetDate))) targetDate = today();
    return {
        title: title.trim(),
        description: (obj.description || obj.Description || '').trim(),
        priority,
        status,
        targetDate: new Date(targetDate).toISOString().slice(0, 10),
        category: (obj.category || obj.Category || '').trim(),
        createdAt: new Date().toISOString(),
        completedAt: status === 'done' ? new Date().toISOString() : null,
    };
}

function showImportPreview(data, fileName) {
    dom.importDropZone.innerHTML = `
    <div class="drop-icon">✅</div>
    <p><strong>${fileName}</strong> loaded</p>
    <p class="file-types">${data.length} task(s) ready to import</p>
  `;
    let tableHtml = `
    <table class="import-preview-table">
      <thead><tr><th>Title</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead>
      <tbody>
  `;
    data.slice(0, 20).forEach(t => {
        tableHtml += `<tr>
      <td>${escapeHtml(t.title)}</td>
      <td>${PRIORITY_EMOJI[t.priority]} ${t.priority}</td>
      <td>${STATUS_LABELS[t.status]}</td>
      <td>${toDateStr(t.targetDate)}</td>
    </tr>`;
    });
    if (data.length > 20) {
        tableHtml += `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">...and ${data.length - 20} more</td></tr>`;
    }
    tableHtml += '</tbody></table>';
    dom.importPreview.innerHTML = tableHtml;
    dom.importPreview.style.display = 'block';
    dom.importConfirm.disabled = false;
}

async function confirmImport() {
    if (importBuffer.length === 0) return;
    if (isAnonymous()) {
        importBuffer.forEach(t => {
            t.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36);
            tasks.push(t);
        });
        saveToLocalStorage();
        render();
    } else {
        await batchAddToFirestore(importBuffer);
    }
    toast(`${importBuffer.length} task(s) imported!`, 'success');
    importBuffer = [];
    closeModal(dom.importModal);
}

// ── Export ──
function openExportModal() {
    if (tasks.length === 0) {
        toast('No tasks to export.', 'error');
        return;
    }
    openModal(dom.exportModal);
}

function exportAsCSV() {
    const headers = ['title', 'description', 'priority', 'status', 'targetDate', 'category', 'createdAt', 'completedAt'];
    const csvRows = [headers.join(',')];
    tasks.forEach(t => {
        const row = headers.map(h => {
            let val = t[h] || '';
            val = String(val).replace(/"/g, '""');
            return `"${val}"`;
        });
        csvRows.push(row.join(','));
    });
    downloadFile(csvRows.join('\n'), 'taskflow_tasks.csv', 'text/csv');
    toast('Exported as CSV!', 'success');
    closeModal(dom.exportModal);
}

function exportAsJSON() {
    const exportData = tasks.map(({ id, ...rest }) => rest);
    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, 'taskflow_tasks.json', 'application/json');
    toast('Exported as JSON!', 'success');
    closeModal(dom.exportModal);
}

function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Weekly Review Panel ──
function openReviewPanel() {
    dom.reviewPanel.classList.add('active');
    dom.reviewOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderReview();
}

function closeReviewPanel() {
    dom.reviewPanel.classList.remove('active');
    dom.reviewOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

function renderReview() {
    const weekStart = getWeekStart();
    const now = new Date();

    const completedThisWeek = tasks.filter(t => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const d = new Date(t.completedAt);
        return d >= weekStart && d <= now;
    });

    const createdThisWeek = tasks.filter(t => {
        const d = new Date(t.createdAt);
        return d >= weekStart && d <= now;
    });

    const overdueTasks = tasks.filter(t => isOverdue(t));
    const activeTasks = tasks.filter(t => t.status !== 'done');
    const totalDone = tasks.filter(t => t.status === 'done').length;
    const totalAll = tasks.length;
    const completionRate = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    dom.reviewContent.innerHTML = `
    <div class="review-section">
      <h3>📅 Week of ${weekLabel}</h3>
      <div class="review-stats">
        <div class="review-stat highlight-success"><div class="stat-number">${completedThisWeek.length}</div><div class="stat-label">Completed</div></div>
        <div class="review-stat"><div class="stat-number">${createdThisWeek.length}</div><div class="stat-label">Added</div></div>
        <div class="review-stat ${overdueTasks.length > 0 ? 'highlight-danger' : ''}"><div class="stat-number">${overdueTasks.length}</div><div class="stat-label">Overdue</div></div>
        <div class="review-stat"><div class="stat-number">${activeTasks.length}</div><div class="stat-label">Active</div></div>
      </div>
    </div>
    <div class="review-section">
      <h3>📈 Overall Completion</h3>
      <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:0.3rem;">${totalDone} of ${totalAll} tasks  (${completionRate}%)</p>
      <div class="review-progress-bar"><div class="review-progress-fill" style="width:${completionRate}%"></div></div>
    </div>
    ${overdueTasks.length > 0 ? `
      <div class="review-section">
        <h3>🚨 Overdue — Needs Attention</h3>
        <div class="review-task-list">
          ${overdueTasks.sort((a, b) => daysDiff(a.targetDate) - daysDiff(b.targetDate)).map(t => `
            <div class="review-task-item">
              <span class="emoji">${PRIORITY_EMOJI[t.priority]}</span>
              <span class="title">${escapeHtml(t.title)}</span>
              <span class="date" style="color:var(--priority-critical);">${relativeDateLabel(t.targetDate)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    ${completedThisWeek.length > 0 ? `
      <div class="review-section">
        <h3>✅ Completed This Week</h3>
        <div class="review-task-list">
          ${completedThisWeek.map(t => `
            <div class="review-task-item">
              <span class="emoji">${PRIORITY_EMOJI[t.priority]}</span>
              <span class="title">${escapeHtml(t.title)}</span>
              <span class="date">${toDateStr(t.targetDate)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : `<div class="review-section"><h3>✅ Completed This Week</h3><p style="color:var(--text-muted);font-size:0.85rem;">No tasks completed yet.</p></div>`}
    <div class="review-section">
      <h3>🔮 Coming Up This Week</h3>
      ${(() => {
            const up = activeTasks.filter(t => { const d = daysDiff(t.targetDate); return d >= 0 && d <= 7; })
                .sort((a, b) => daysDiff(a.targetDate) - daysDiff(b.targetDate));
            if (!up.length) return '<p style="color:var(--text-muted);font-size:0.85rem;">No tasks this week.</p>';
            return `<div class="review-task-list">${up.map(t => `
          <div class="review-task-item">
            <span class="emoji">${PRIORITY_EMOJI[t.priority]}</span>
            <span class="title">${escapeHtml(t.title)}</span>
            <span class="date">${relativeDateLabel(t.targetDate)}</span>
          </div>
        `).join('')}</div>`;
        })()}
    </div>
  `;
}

// ── Event Listeners ──
function bindEvents() {
    // Add task
    $('#btnAddTask').addEventListener('click', openAddModal);

    // Recurring toggle
    dom.taskRecurring.addEventListener('change', (e) => {
        if (e.target.checked) {
            dom.recurringOptions.classList.add('visible');
        } else {
            dom.recurringOptions.classList.remove('visible');
        }
    });

    // Modal close
    dom.modalClose.addEventListener('click', () => closeModal(dom.taskModal));
    dom.modalCancel.addEventListener('click', () => closeModal(dom.taskModal));
    dom.modalSave.addEventListener('click', saveTask);

    // Confirm modal
    dom.confirmClose.addEventListener('click', () => closeModal(dom.confirmModal));
    dom.confirmCancel.addEventListener('click', () => closeModal(dom.confirmModal));
    dom.confirmDelete.addEventListener('click', confirmDeleteTask);

    // Priority selection
    dom.priorityOptions.addEventListener('click', (e) => {
        const btn = e.target.closest('.priority-option');
        if (btn) selectPriority(btn.dataset.priority);
    });

    // Task actions
    dom.taskGroups.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'edit') openEditModal(id);
        if (action === 'delete') requestDelete(id);
        if (action === 'complete') completeTask(id);
        if (action === 'reopen') reopenTask(id);
    });

    // Search & Filters
    dom.globalSearch.addEventListener('input', render);
    dom.filterStatus.addEventListener('change', render);
    dom.filterPriority.addEventListener('change', render);

    // Import
    $('#btnImport').addEventListener('click', openImportModal);
    dom.importClose.addEventListener('click', () => closeModal(dom.importModal));
    dom.importCancel.addEventListener('click', () => closeModal(dom.importModal));
    dom.importConfirm.addEventListener('click', confirmImport);

    dom.importDropZone.addEventListener('click', () => dom.importFileInput.click());
    dom.importFileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportFile(e.target.files[0]);
    });
    dom.importDropZone.addEventListener('dragover', (e) => { e.preventDefault(); dom.importDropZone.classList.add('drag-over'); });
    dom.importDropZone.addEventListener('dragleave', () => dom.importDropZone.classList.remove('drag-over'));
    dom.importDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.importDropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
    });

    // Export
    $('#btnExport').addEventListener('click', openExportModal);
    dom.exportClose.addEventListener('click', () => closeModal(dom.exportModal));
    dom.exportCancel.addEventListener('click', () => closeModal(dom.exportModal));
    dom.exportCSV.addEventListener('click', exportAsCSV);
    dom.exportJSON.addEventListener('click', exportAsJSON);

    // Review
    $('#btnReview').addEventListener('click', openReviewPanel);
    dom.reviewClose.addEventListener('click', closeReviewPanel);
    dom.reviewOverlay.addEventListener('click', closeReviewPanel);

    // Close modals on overlay
    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
        if (e.key === 'n' && e.ctrlKey) { e.preventDefault(); openAddModal(); }
    });

    dom.taskModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); saveTask(); }
    });
}

// ── Sample Tasks ──
function getSampleTasks() {
    const d = (offset) => {
        const dt = new Date();
        dt.setDate(dt.getDate() + offset);
        return dt.toISOString().slice(0, 10);
    };
    const rid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36);
    return [
        { id: rid(), title: 'Review quarterly sales report', description: 'Analyze Q4 numbers.', priority: 'critical', status: 'in-progress', targetDate: d(0), category: 'Work', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Update project documentation', description: 'Add new API endpoints.', priority: 'high', status: 'todo', targetDate: d(2), category: 'Work', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Team standup preparation', description: 'Gather sprint metrics.', priority: 'medium', status: 'todo', targetDate: d(1), category: 'Meetings', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Fix authentication bug', description: 'Users getting logged out.', priority: 'critical', status: 'todo', targetDate: d(-2), category: 'Bug Fix', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Plan team offsite agenda', description: 'Activities and venue for March.', priority: 'low', status: 'todo', targetDate: d(5), category: 'Personal', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Deploy v2.1 to staging', description: 'Run full test suite.', priority: 'high', status: 'in-progress', targetDate: d(-1), category: 'DevOps', createdAt: new Date().toISOString(), completedAt: null },
        { id: rid(), title: 'Write unit tests for payments', description: 'Cover edge cases.', priority: 'medium', status: 'done', targetDate: d(-3), category: 'Work', createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
    ];
}

// ── Boot ──
bindEvents();
setupAuth();
