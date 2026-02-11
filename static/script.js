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
        // Clear error message
        errorMsg.classList.add('d-none');
        // Show main content and hide login
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('main-content').classList.remove('d-none');
        // Load items and setup event listeners after login
        setupAfterLogin();
    } else {
        errorMsg.classList.remove('d-none');
    }
}

function setupAfterLogin() {
    // Add event listeners for search and filters
    const searchInput = document.getElementById('search');
    const dateFilter = document.getElementById('date-filter');
    
    if (searchInput) {
        searchInput.addEventListener('input', loadItems);
    }
    if (dateFilter) {
        dateFilter.addEventListener('change', loadItems);
    }
    
    // Load items for the first time
    loadItems();
}

async function logout() {
    await fetch('/logout');
    window.location.reload();
}

async function loadItems() {
    const q = document.getElementById('search')?.value || '';
    const date = document.getElementById('date-filter')?.value || '';
    
    try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(q)}&date=${encodeURIComponent(date)}`);
        if (res.status === 401) return;
        
        if (!res.ok) {
            const errorData = await res.json();
            console.error('Error loading items:', errorData);
            document.getElementById('items-list').innerHTML = `<div class="alert alert-danger">Error loading items. Please try again.</div>`;
            return;
        }
        
        const items = await res.json();
        const container = document.getElementById('items-list');
        
        if (items.length === 0) {
            container.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">No items yet. Try pasting something with Ctrl+V or use the + Add button!</div></div>`;
            return;
        }
        
        container.innerHTML = items.map(item => `
            <div class="col-md-4 mb-3">
                <div class="card h-100 shadow-sm">
                    <div class="card-body">
                        ${item.title ? `<h5 class="card-title">${escapeHtml(item.title)}</h5>` : ''}
                        ${item.type === 'text' ? 
                            `<p class="card-text">${escapeHtml(item.content)}</p>` : 
                            `<img src="${item.content}" class="img-fluid rounded mb-2" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23eee%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22%3EImage Error%3C/text%3E%3C/svg%3E'">`}
                        <div class="d-flex justify-content-between align-items-center mt-3 border-top pt-2">
                            <small class="text-muted">${item.date}</small>
                            <div>
                                <span class="badge bg-light text-dark border">${item.type}</span>
                                <button class="btn btn-sm btn-danger ms-2" onclick="deleteItem(${item.id})">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('items-list').innerHTML = `<div class="alert alert-danger">Error loading items. Please refresh the page.</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('paste', async (e) => {
    const items = e.clipboardData.items;
    for (let item of items) {
        if (item.type.includes("image")) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                await saveItem(event.target.result, 'image');
            };
            reader.readAsDataURL(item.getAsFile());
        } else if (item.type.includes("text/plain")) {
            item.getAsString(async (text) => {
                await saveItem(text, 'text');
            });
        }
    }
});

async function saveItem(content, type, title = null) {
    try {
        const res = await fetch('/api/items', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({content, type, title})
        });
        
        if (!res.ok) {
            const errorData = await res.json();
            alert('Error saving item: ' + (errorData.error || 'Unknown error'));
            return false;
        }
        
        // Clear form and close modal after successful save
        document.getElementById('item-title').value = '';
        document.getElementById('item-content').value = '';
        document.getElementById('item-image').value = '';
        document.getElementById('item-type-select').value = 'text';
        toggleInputType();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('addItemModal'));
        if (modal) modal.hide();
        
        loadItems();
        return true;
    } catch (error) {
        console.error('Error saving item:', error);
        alert('Error saving item. Please try again.');
        return false;
    }
}

async function deleteItem(itemId) {
    if (confirm('Are you sure you want to delete this item?')) {
        try {
            const res = await fetch(`/api/items/${itemId}`, {
                method: 'DELETE'
            });
            
            if (!res.ok) {
                alert('Error deleting item');
                return;
            }
            
            loadItems();
        } catch (error) {
            console.error('Error deleting item:', error);
            alert('Error deleting item. Please try again.');
        }
    }
}

document.getElementById('search')?.addEventListener('input', loadItems);
document.getElementById('date-filter')?.addEventListener('change', loadItems);

// Check if already logged in on page load
window.addEventListener('load', () => {
    const mainContent = document.getElementById('main-content');
    // If main content is visible, it means user is already logged in
    if (mainContent && !mainContent.classList.contains('d-none')) {
        setupAfterLogin();
    }
});

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
    
    try {
        if (type === 'text') {
            const content = document.getElementById('item-content').value;
            if (!content.trim()) {
                alert('Please enter some content');
                return;
            }
            await saveItem(content, 'text', title || null);
        } else {
            const fileInput = document.getElementById('item-image');
            if (!fileInput.files.length) {
                alert('Please select an image');
                return;
            }
            
            const file = fileInput.files[0];
            const maxSize = 5 * 1024 * 1024; // 5MB
            if (file.size > maxSize) {
                alert('Image size must be less than 5MB');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                await saveItem(event.target.result, 'image', title || null);
            };
            reader.readAsDataURL(file);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('An error occurred. Please try again.');
    }
}