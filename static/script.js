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
        window.location.reload();
    } else {
        errorMsg.classList.remove('d-none');
    }
}

async function logout() {
    await fetch('/logout');
    window.location.reload();
}

async function loadItems() {
    const q = document.getElementById('search').value;
    const date = document.getElementById('date-filter').value;
    const res = await fetch(`/api/items?q=${q}&date=${date}`);
    if (res.status === 401) return;
    
    const items = await res.json();
    const container = document.getElementById('items-list');
    
    container.innerHTML = items.map(item => `
        <div class="col-md-4 mb-3">
            <div class="card h-100 shadow-sm">
                <div class="card-body">
                    ${item.title ? `<h5 class="card-title">${item.title}</h5>` : ''}
                    ${item.type === 'text' ? 
                        `<p class="card-text">${item.content}</p>` : 
                        `<img src="${item.content}" class="img-fluid rounded mb-2">`}
                    <div class="d-flex justify-content-between align-items-center mt-3 border-top pt-2">
                        <small class="text-muted">${item.date}</small>
                        <span class="badge bg-light text-dark border">${item.type}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
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
    await fetch('/api/items', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, type, title})
    });
    loadItems();
}

document.getElementById('search')?.addEventListener('input', loadItems);
document.getElementById('date-filter')?.addEventListener('change', loadItems);
window.onload = loadItems;

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
    const modal = bootstrap.Modal.getInstance(document.getElementById('addItemModal'));
    
    if (type === 'text') {
        const content = document.getElementById('item-content').value;
        if (!content.trim()) {
            alert('Please enter some content');
            return;
        }
        await saveItem(content, 'text', title);
    } else {
        const fileInput = document.getElementById('item-image');
        if (!fileInput.files.length) {
            alert('Please select an image');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            await saveItem(event.target.result, 'image', title);
        };
        reader.readAsDataURL(fileInput.files[0]);
    }
    
    // Clear form and close modal
    document.getElementById('item-title').value = '';
    document.getElementById('item-content').value = '';
    document.getElementById('item-image').value = '';
    document.getElementById('item-type-select').value = 'text';
    toggleInputType();
    modal.hide();
}