let currentFolderId = ''; // Global Directory Tracking State variable

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
    const searchInput = document.getElementById('search');
    const dateFilter = document.getElementById('date-filter');
    
    if (searchInput) searchInput.addEventListener('input', debounce(loadItems, 300));
    if (dateFilter) dateFilter.addEventListener('change', loadItems);
    
    loadFolders();
    loadItems();
    initializeDragAndDrop();
}

async function logout() {
    await fetch('/logout');
    window.location.reload();
}

// --- Folder API Operations & Subsystems ---
async function loadFolders() {
    try {
        const res = await fetch('/api/folders');
        if (!res.ok) return;
        const folders = await res.json();
        
        // Populate folder tree array items
        const sidebar = document.getElementById('folder-sidebar-items');
        const modalSelect = document.getElementById('item-folder-select');
        
        // Retain standard structural components
        const staticAll = document.getElementById('folder-all').outerHTML;
        const staticNone = document.getElementById('folder-none').outerHTML;
        sidebar.innerHTML = staticAll + staticNone;
        
        modalSelect.innerHTML = `<option value="">Unassigned Category</option>`;
        
        folders.forEach(f => {
            sidebar.innerHTML += `
                <button onclick="switchFolder(${f.id})" class="list-group-item list-group-item-action border-0 rounded mb-1 d-flex justify-content-between align-items-center" id="folder-${f.id}">
                    <span><i class="bi bi-folder me-2"></i> ${escapeHtml(f.name)}</span>
                </button>
            `;
            modalSelect.innerHTML += `<option value="${f.id}">${escapeHtml(f.name)}</option>`;
        });
        
        highlightActiveFolder();
    } catch (e) {
        console.error("Failed handling directory tree extraction", e);
    }
}

function switchFolder(folderId) {
    currentFolderId = folderId === 'none' ? 'none' : (folderId ? intOrString(folderId) : '');
    highlightActiveFolder();
    loadItems();
}

function highlightActiveFolder() {
    const sidebar = document.getElementById('folder-sidebar-items');
    Array.from(sidebar.children).forEach(btn => btn.classList.remove('active'));
    
    let targetId = 'folder-all';
    if (currentFolderId === 'none') targetId = 'folder-none';
    else if (currentFolderId) targetId = `folder-${currentFolderId}`;
    
    const activeBtn = document.getElementById(targetId);
    if (activeBtn) activeBtn.classList.add('active');
}

async function promptCreateFolder() {
    const name = prompt("Enter a name for the new folder:");
    if (!name || !name.strip()) return;
    
    const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    });
    if (res.ok) {
        loadFolders();
    } else {
        const data = await res.json();
        alert(data.error || "Failed building catalog");
    }
}

// --- Universal Pipeline Asset Save Systems ---
async function handleGenericFileUpload(file) {
    // Determine file characteristics
    const title = file.name;
    const type = file.type || 'application/octet-stream';
    const size = file.size;

    // Show inline processing toast or UI element log context
    console.log(`Streaming structural component: ${title} (${type})`);

    // Bypassing Vercel's Payload Limits (4.5 MB function limit)
    // If you haven't wired up a customized direct client-side Vercel Blob integration yet, 
    // files are processed natively using a fallback mechanism. To support files > 4.5MB seamlessly,
    // upload directly to Vercel's Edge asset pipeline using FileReader array chunking or base64.
    const reader = new FileReader();
    reader.onload = async (event) => {
        const dataPayload = {
            title: title,
            content: event.target.result, // base64 representation of raw asset content logic fallback
            file_url: null,               // Swap to live vercel public storage object URL reference when active
            file_size: size,
            type: type,
            folder_id: currentFolderId
        };
        await pushRecordToDatabase(dataPayload);
    };
    reader.readAsDataURL(file);
}

async function pushRecordToDatabase(payload) {
    try {
        const res = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            loadItems();
        } else {
            const err = await res.json();
            alert("Storage failure occurred: " + (err.error || 'Unknown parameter'));
        }
    } catch (e) {
        console.error("Transmission breakdown", e);
    }
}

// --- Dynamic List Rendering Pipelines ---
async function loadItems() {
    const q = document.getElementById('search')?.value || '';
    const date = document.getElementById('date-filter')?.value || '';
    const sort = document.getElementById('sort-filter')?.value || 'date_desc';
    
    let url = `/api/items?q=${encodeURIComponent(q)}&date=${encodeURIComponent(date)}&sort=${sort}`;
    if (currentFolderId) {
        url += `&folder_id=${currentFolderId}`;
    }
    
    try {
        const res = await fetch(url);
        if (res.status === 401) return;
        if (!res.ok) throw new Error("API system fallback fault code injected.");
        
        const items = await res.json();
        const container = document.getElementById('items-list');
        
        if (items.length === 0) {
            container.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-info text-center border-0 shadow-sm py-4">
                        <i class="bi bi-folder-x display-4 d-block mb-2 text-muted"></i>
                        No data snippets found in this category slot yet.
                    </div>
                </div>`;
            return;
        }
        
        container.innerHTML = items.map(item => {
            const isImage = item.type.startsWith('image/');
            const isText = item.type === 'text';
            const displaySize = item.file_size ? formatBytes(item.file_size) : '';
            
            let assetCardBody = '';
            if (isText) {
                assetCardBody = `<p class="card-text text-dark flex-grow-1">${escapeHtml(item.content)}</p>`;
            } else if (isImage) {
                const srcData = item.file_url || item.content;
                assetCardBody = `
                    <div class="image-preview-wrapper mb-2 bg-light text-center rounded border">
                        <img src="${srcData}" class="img-fluid rounded adaptive-img" onerror="this.src='data:image/svg+xml;utf8,<svg...>'">
                    </div>`;
            } else {
                // Universal Non-Image File Layout
                assetCardBody = `
                    <div class="d-flex align-items-center p-2 mb-2 bg-light rounded border text-truncate">
                        <i class="bi bi-file-earmark-zip-fill text-primary display-6 me-3"></i>
                        <div class="text-truncate">
                            <span class="d-block text-truncate fw-semibold text-dark mb-0">${escapeHtml(item.title || 'Binary Object')}</span>
                            <small class="text-muted d-block font-monospace" style="font-size:0.75rem;">${escapeHtml(item.type)}</small>
                        </div>
                    </div>`;
            }
            
            return `
                <div class="col-xl-4 col-md-6 mb-2">
                    <div class="card h-100 shadow-sm border-0 contextual-card">
                        <div class="card-body d-flex flex-column p-3">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <h6 class="card-title text-truncate mb-0 text-primary fw-bold">${escapeHtml(item.title || (isText ? 'Text Snippet' : 'Uploaded File'))}</h6>
                                <span class="badge bg-light text-secondary border font-monospace py-1" style="font-size:0.7rem;">${displaySize || item.type.split('/')[0]}</span>
                            </div>
                            
                            ${assetCardBody}
                            
                            <div class="d-flex justify-content-between align-items-center mt-3 border-top pt-2">
                                <small class="text-muted font-monospace" style="font-size:0.75rem;"><i class="bi bi-clock me-1"></i>${item.date}</small>
                                <div class="btn-group">
                                    ${(!isText && (item.file_url || item.content)) ? `<a href="${item.file_url || item.content}" download="${item.title || 'download'}" class="btn btn-sm btn-outline-primary py-0 px-2"><i class="bi bi-download"></i></a>` : ''}
                                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="deleteItem(${item.id})"><i class="bi bi-trash3"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        document.getElementById('items-list').innerHTML = `<div class="alert alert-danger">Error rendering layout streams. Check trace logic logs.</div>`;
    }
}

// --- Global DOM Interaction Events Interceptors ---
function initializeDragAndDrop() {
    const overlay = document.getElementById('drag-drop-overlay');
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        overlay.classList.remove('d-none');
    });

    window.addEventListener('dragleover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            overlay.classList.add('d-none');
        }
    });

    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.add('d-none');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                await handleGenericFileUpload(files[i]);
            }
        }
    });
}

document.addEventListener('paste', async (e) => {
    const clipboardItems = e.clipboardData.items;
    for (let item of clipboardItems) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) await handleGenericFileUpload(file);
        } else if (item.type === 'text/plain') {
            item.getAsString(async (text) => {
                // Eliminate duplicated triggers if file processing is running concurrently
                if (text.startsWith('data:image/')) return; 
                await pushRecordToDatabase({
                    title: "Pasted Text Block",
                    content: text,
                    type: "text",
                    folder_id: currentFolderId
                });
            });
        }
    }
});

// --- Modal Controls & Interface Support Elements ---
function toggleInputType() {
    const type = document.getElementById('item-type-select').value;
    const textGroup = document.getElementById('text-input-group');
    const imageGroup = document.getElementById('image-input-group');
    
    if (type === 'text') {
        textGroup.classList.remove('d-none');
        imageGroup.classList.add('d-none');
    } else {
        textGroup.classList.add('d-none');
        imageGroup.classList.remove('d-none');
    }
}

async function submitAddItem() {
    const title = document.getElementById('item-title').value;
    const type = document.getElementById('item-type-select').value;
    const folder_id = document.getElementById('item-folder-select').value;
    
    if (type === 'text') {
        const content = document.getElementById('item-content').value;
        if (!content.trim()) return alert('Empty string initialization parameter error.');
        await pushRecordToDatabase({
            title: title || "Manual Note",
            content: content,
            type: "text",
            folder_id: folder_id
        });
    } else {
        const fileInput = document.getElementById('item-image');
        if (!fileInput.files.length) return alert('No active binary selection targets declared.');
        await handleGenericFileUpload(fileInput.files[0]);
    }
    
    // Reset structures & dismiss target modals safely
    document.getElementById('item-title').value = '';
    document.getElementById('item-content').value = '';
    document.getElementById('item-image').value = '';
    const modal = bootstrap.Modal.getInstance(document.getElementById('addItemModal'));
    if (modal) modal.hide();
}

async function deleteItem(itemId) {
    if (confirm('Permanently purge this item component row from storage architecture?')) {
        const res = await fetch(`/api/items/${itemId}`, { method: 'DELETE' });
        if (res.ok) loadItems();
    }
}

// --- Utility Helper Functions ---
function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function intOrString(val) {
    return isNaN(val) ? val : parseInt(val);
}

window.addEventListener('load', () => {
    const mainContent = document.getElementById('main-content');
    if (mainContent && !mainContent.classList.contains('d-none')) {
        setupAfterLogin();
    }
});