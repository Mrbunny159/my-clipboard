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

async function saveItem(content, type) {
    await fetch('/api/items', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, type})
    });
    loadItems();
}

document.getElementById('search')?.addEventListener('input', loadItems);
document.getElementById('date-filter')?.addEventListener('change', loadItems);
window.onload = loadItems;