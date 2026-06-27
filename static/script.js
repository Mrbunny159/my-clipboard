let currentFolderId = '';
let appState = { items: [] };

async function login() {
    const user = document.getElementById('user-input').value;
    const pass = document.getElementById('pass-input').value;
    const errorMsg = document.getElementById('login-error');

    const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });

    if (res.ok) {
        errorMsg.classList.add('d-none');
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('main-content').classList.remove('d-none');
        setupAfterLogin();
    } else {
        errorMsg.classList.remove('d-none');
    }
}

function setupAfterLogin() {
    document.getElementById('search')?.addEventListener('input', debounce(loadItems, 300));
    document.getElementById('date-filter')?.addEventListener('change', loadItems);
    loadFolders();
    loadItems();
    initializeDragAndDrop();
}

async function logout() {
    await fetch('/logout');
    window.location.reload();
}

async function loadFolders() {
    try {
        const res = await fetch('/api/folders');
        if (!res.ok) return;
        const folders = await res.json();
        
        const sidebar = document.getElementById('folder-sidebar-items');
        const modalSelect = document.getElementById('item-folder-select');
        const editModalSelect = document.getElementById('edit-item-folder');
        
        sidebar.innerHTML = document.getElementById('folder-all').outerHTML + document.getElementById('folder-none').outerHTML;
        modalSelect.innerHTML = `<option value="">Unassigned Category</option>`;
        editModalSelect.innerHTML = `<option value="">Unassigned Category</option>`;
        
        folders.forEach(f => {
            sidebar.innerHTML += `<button onclick="switchFolder(${f.id})" class="list-group-item list-group-item-action border-0 rounded mb-1" id="folder-${f.id}"><i class="bi bi-folder me-2"></i> ${escapeHtml(f.name)}</button>`;
            const opt = `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
            modalSelect.innerHTML += opt;
            editModalSelect.innerHTML += opt;
        });
        highlightActiveFolder();
    } catch (e) {}
}

function switchFolder(folderId) {
    currentFolderId = folderId === 'none' ? 'none' : (folderId ? intOrString(folderId) : '');
    highlightActiveFolder();
    loadItems();
}

function highlightActiveFolder() {
    Array.from(document.getElementById('folder-sidebar-items').children).forEach(btn => btn.classList.remove('active'));
    let targetId = currentFolderId === 'none' ? 'folder-none' : (currentFolderId ? `folder-${currentFolderId}` : 'folder-all');
    document.getElementById(targetId)?.classList.add('active');
}

async function promptCreateFolder() {
    const name = prompt("Enter a name for the new folder:");
    if (!name || !name.trim()) return;
    const res = await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
    if (res.ok) loadFolders();
}

async function loadItems() {
    const q = document.getElementById('search')?.value || '';
    const date = document.getElementById('date-filter')?.value || '';
    const sort = document.getElementById('sort-filter')?.value || 'date_desc';
    let url = `/api/items?q=${encodeURIComponent(q)}&date=${encodeURIComponent(date)}&sort=${sort}`;
    if (currentFolderId) url += `&folder_id=${currentFolderId}`;
    
    try {
        const res = await fetch(url);
        if (res.status === 401) return;
        appState.items = await res.json(); 
        renderGrid(); 
    } catch (e) { console.error(e); }
}

function renderGrid() {
    const container = document.getElementById('items-list');
    if (appState.items.length === 0) {
        container.innerHTML = `<div class="col-12"><div class="alert alert-info text-center border-0 shadow-sm py-4"><i class="bi bi-folder-x display-4 d-block mb-2 text-muted"></i>No data snippets found.</div></div>`;
        return;
    }
    
    container.innerHTML = appState.items.map(item => {
        const isImage = item.type.startsWith('image/');
        const isText = item.type === 'text';
        const displaySize = item.file_size ? formatBytes(item.file_size) : '';
        const loadingOpacity = item.isSaving ? 'opacity: 0.5; pointer-events: none;' : '';
        
        let assetCardBody = isText 
            ? `<p class="card-text text-dark flex-grow-1">${escapeHtml(item.content)}</p>` 
            : (isImage ? `<div class="image-preview-wrapper mb-2 bg-light rounded border"><img src="${item.file_url || item.content}" class="img-fluid rounded adaptive-img"></div>` 
                       : `<div class="d-flex align-items-center p-2 mb-2 bg-light rounded border text-truncate"><i class="bi bi-file-earmark-zip-fill text-primary display-6 me-3"></i><div><span class="d-block fw-semibold text-dark text-truncate">${escapeHtml(item.title || 'Binary Object')}</span><small class="text-muted font-monospace" style="font-size:0.75rem;">${escapeHtml(item.type)}</small></div></div>`);
        
        return `
            <div class="col-xl-4 col-md-6 mb-2" style="${loadingOpacity}">
                <div class="card h-100 shadow-sm border-0 contextual-card">
                    <div class="card-body d-flex flex-column p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title text-truncate mb-0 text-primary fw-bold">${escapeHtml(item.title || (isText ? 'Text Snippet' : 'Uploaded File'))}</h6>
                            <span class="badge bg-light text-secondary border font-monospace py-1" style="font-size:0.7rem;">${displaySize || item.type.split('/')[0]}</span>
                        </div>
                        ${assetCardBody}
                        <div class="d-flex justify-content-between align-items-center mt-3 border-top pt-2">
                            <small class="text-muted font-monospace" style="font-size:0.75rem;">${item.isSaving ? '<div class="spinner-border spinner-border-sm text-primary"></div> Uploading...' : `<i class="bi bi-clock me-1"></i>${item.date}`}</small>
                            <div class="btn-group">
                                ${(!isText && (item.file_url || item.content)) ? `<a href="${item.file_url || item.content}" download="${item.title || 'download'}" class="btn btn-sm btn-outline-primary py-0 px-2" target="_blank"><i class="bi bi-download"></i></a>` : ''}
                                <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="openEditModal(${item.id})"><i class="bi bi-pencil-square"></i></button>
                                <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="deleteItem(${item.id})"><i class="bi bi-trash3"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

// --- Editing Items ---
function openEditModal(id) {
    const item = appState.items.find(i => i.id === id);
    if (!item) return;
    document.getElementById('edit-item-id').value = item.id;
    document.getElementById('edit-item-title').value = item.title || '';
    document.getElementById('edit-item-folder').value = item.folder_id || '';
    if (item.type === 'text') {
        document.getElementById('edit-text-group').classList.remove('d-none');
        document.getElementById('edit-item-content').value = item.content || '';
    } else { document.getElementById('edit-text-group').classList.add('d-none'); }
    new bootstrap.Modal(document.getElementById('editItemModal')).show();
}

async function submitEditItem() {
    const id = document.getElementById('edit-item-id').value, title = document.getElementById('edit-item-title').value, folder_id = document.getElementById('edit-item-folder').value, content = document.getElementById('edit-item-content').value;
    const itemIndex = appState.items.findIndex(i => i.id == id);
    if (itemIndex > -1) {
        appState.items[itemIndex].title = title; appState.items[itemIndex].folder_id = folder_id || null;
        if (appState.items[itemIndex].type === 'text') appState.items[itemIndex].content = content;
        renderGrid(); 
    }
    bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
    await fetch(`/api/items/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, folder_id, content }) });
}

// --- SECURE PROXY FILE UPLOAD FLOW ---
async function handleGenericFileUpload(file) {
    if (file.size === 0) return alert("Cannot upload empty (0 byte) files.");
    
    // Safety Net: Max limit check (e.g., 50MB limits for browser-side safety)
    const MAX_MB = 50; 
    if (file.size > (MAX_MB * 1024 * 1024)) return alert(`File is too large. Max allowed is ${MAX_MB} MB.`);

    const title = file.name || `Screenshot_${Date.now()}.png`; 
    const type = file.type || 'application/octet-stream';
    const size = file.size;
    const tempId = Date.now();

    // 1. Instant UI Feedback
    appState.items.unshift({ id: tempId, title: title, content: null, file_url: null, type: type, file_size: size, date: 'Just now', isSaving: true });
    renderGrid();

    try {
        // 2. Send file to Python Backend, avoiding Vercel CORS completely
        const formData = new FormData();
        formData.append('file', file);

        const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!uploadRes.ok) throw new Error("Backend server rejected the file upload.");
        
        // 3. Receive the newly generated Blob URL from your backend
        const uploadData = await uploadRes.json();
        const finalUrl = uploadData.url;

        // 4. Save metadata to database
        const dbRes = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                title: title, 
                content: null, 
                file_url: finalUrl, 
                file_size: size, 
                type: type, 
                folder_id: currentFolderId 
            })
        });

        if (dbRes.ok) {
            loadItems(); 
        } else {
            console.warn("Database failed to save. Rolling back Vercel Blob file...");
            fetch('/api/blob/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: finalUrl }) });
            throw new Error("Database rejected the save.");
        }
    } catch (e) {
        appState.items = appState.items.filter(i => i.id !== tempId);
        renderGrid();
        alert("Upload failed: " + e.message);
    }
}

async function saveTextRecord(title, content, folder_id) {
    const tempId = Date.now();
    appState.items.unshift({ id: tempId, title: title || 'Saving...', content: content, file_url: null, type: 'text', file_size: null, date: 'Just now', isSaving: true });
    renderGrid();
    await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, content: content, type: "text", folder_id: folder_id }) });
    loadItems(); 
}

async function deleteItem(itemId) {
    if (confirm('Permanently delete this item?')) {
        appState.items = appState.items.filter(item => item.id !== itemId);
        renderGrid();
        await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
    }
}

function submitAddItem() {
    const title = document.getElementById('item-title').value, type = document.getElementById('item-type-select').value, folder_id = document.getElementById('item-folder-select').value;
    if (type === 'text') {
        const content = document.getElementById('item-content').value;
        if (!content.trim()) return;
        saveTextRecord(title || "Manual Note", content, folder_id);
    } else {
        const fileInput = document.getElementById('item-image');
        if (!fileInput.files.length) return;
        handleGenericFileUpload(fileInput.files[0]);
    }
    document.getElementById('item-title').value = ''; document.getElementById('item-content').value = ''; document.getElementById('item-image').value = '';
    bootstrap.Modal.getInstance(document.getElementById('addItemModal')).hide();
}

function toggleInputType() {
    const type = document.getElementById('item-type-select').value;
    document.getElementById('text-input-group').classList.toggle('d-none', type !== 'text');
    document.getElementById('image-input-group').classList.toggle('d-none', type === 'text');
}

function initializeDragAndDrop() {
    const overlay = document.getElementById('drag-drop-overlay');
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; overlay.classList.remove('d-none'); });
    window.addEventListener('dragleover', (e) => e.preventDefault());
    window.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) overlay.classList.add('d-none'); });
    window.addEventListener('drop', async (e) => {
        e.preventDefault(); dragCounter = 0; overlay.classList.add('d-none');
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) await handleGenericFileUpload(files[i]);
    });
}

document.addEventListener('paste', async (e) => {
    for (let item of e.clipboardData.items) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) await handleGenericFileUpload(file);
        } else if (item.type === 'text/plain') {
            item.getAsString(async (text) => {
                if (!text.startsWith('data:image/')) await saveTextRecord("Pasted Text Block", text, currentFolderId);
            });
        }
    }
});

function formatBytes(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function intOrString(val) { return isNaN(val) ? val : parseInt(val); }
window.addEventListener('load', () => { if (document.getElementById('main-content') && !document.getElementById('main-content').classList.contains('d-none')) setupAfterLogin(); });