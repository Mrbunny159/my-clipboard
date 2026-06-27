import os
import sys
import requests
import re
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool

app = Flask(__name__, template_folder='../templates', static_folder='../static')

# ==========================================
# SECURE CONFIGURATION
# ==========================================
server_secret = os.environ.get("SECRET_KEY")
app.secret_key = server_secret if server_secret else os.urandom(24).hex()

APP_USERNAME = os.environ.get("APP_USERNAME")
APP_PASSWORD = os.environ.get("APP_PASSWORD")

database_url = os.environ.get("DATABASE_URL")
if database_url:
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'poolclass': NullPool, 'connect_args': {'connect_timeout': 10}}
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = "sqlite:///clipboard.db"

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ==========================================
# DATABASE MODELS
# ==========================================
class Folder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship('ClipboardItem', backref='folder', lazy=True, cascade="all, delete-orphan")

class ClipboardItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=True)
    content = db.Column(db.Text, nullable=True)          
    file_url = db.Column(db.String(1024), nullable=True) 
    file_size = db.Column(db.Integer, nullable=True)     
    data_type = db.Column(db.String(100), nullable=False)
    folder_id = db.Column(db.Integer, db.ForeignKey('folder.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

def init_db():
    try:
        with app.app_context(): db.create_all()
    except: pass

# ==========================================
# ROUTES & SECURITY
# ==========================================
@app.route('/')
def index():
    init_db()
    return render_template('index.html', login_required=not session.get('logged_in'))

@app.route('/login', methods=['POST'])
def login():
    if not APP_USERNAME or not APP_PASSWORD:
        return jsonify({"status": "error", "message": "Server configuration error"}), 500
    data = request.json or {}
    if data.get('username') == APP_USERNAME and data.get('password') == APP_PASSWORD:
        session['logged_in'] = True
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 401

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return jsonify({"status": "logged out"})

@app.route('/api/force-reset-db')
def force_reset_db():
    try:
        db.drop_all()
        db.create_all()
        return jsonify({"message": "Database successfully upgraded."}), 200
    except Exception as e: return jsonify({"error": str(e)}), 500

# ==========================================
# VERCEL BLOB ARCHITECTURE INTEGRATIONS
# ==========================================
@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Securely proxy the file upload from Flask directly to Vercel Blob."""
    if not session.get('logged_in'): 
        return jsonify({"error": "Unauthorized"}), 401
    
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    token = os.environ.get('BLOB_READ_WRITE_TOKEN')
    if not token:
        return jsonify({"error": "Server configuration error"}), 500
        
    # Clean the filename and build the target Blob URL
    safe_title = re.sub(r'[^a-zA-Z0-9.\-]', '_', file.filename)
    timestamped_name = f"{int(datetime.utcnow().timestamp())}_{safe_title}"
    blob_url = f"https://blob.vercel-storage.com/{timestamped_name}"
    
    headers = {
        "authorization": f"Bearer {token}",
        "x-api-version": "7",
        "content-type": file.mimetype or "application/octet-stream"
    }
    
    try:
        # Pushing the file directly to Vercel from the server
        response = requests.put(blob_url, headers=headers, data=file.read())
        response.raise_for_status() 
        
        result = response.json()
        return jsonify({"url": result.get('url')}), 200
        
    except Exception as e:
        return jsonify({"error": f"Vercel Blob rejection: {str(e)}"}), 500

@app.route('/api/blob/delete', methods=['POST'])
def delete_blob_orphan():
    """Rollback route: Deletes orphaned files from Vercel Blob if Neon DB fails to save."""
    if not session.get('logged_in'): return jsonify({}), 401
    url = request.json.get('url')
    token = os.environ.get('BLOB_READ_WRITE_TOKEN')
    if url and token:
        try:
            headers = {"authorization": f"Bearer {token}", "x-api-version": "7"}
            requests.post("https://blob.vercel-storage.com/delete", headers=headers, json={"urls": [url]})
        except: pass
    return jsonify({"status": "cleanup_attempted"})

# ==========================================
# CORE DATA API
# ==========================================
@app.route('/api/folders', methods=['GET', 'POST'])
def handle_folders():
    if not session.get('logged_in'): return jsonify([]), 401
    if request.method == 'POST':
        name = (request.json or {}).get('name', '').strip()
        if not name: return jsonify({"error": "Name required"}), 400
        try:
            new_folder = Folder(name=name)
            db.session.add(new_folder)
            db.session.commit()
            return jsonify({"id": new_folder.id, "name": new_folder.name}), 201
        except:
            db.session.rollback()
            return jsonify({"error": "Folder exists"}), 400
    folders = Folder.query.order_by(Folder.name.asc()).all()
    return jsonify([{"id": f.id, "name": f.name} for f in folders])

@app.route('/api/items', methods=['GET'])
def get_items():
    if not session.get('logged_in'): return jsonify([]), 401
    query, date_filter, folder_id, sort_by = request.args.get('q', '').strip(), request.args.get('date', '').strip(), request.args.get('folder_id', '').strip(), request.args.get('sort', 'date_desc').strip()
    
    items_query = ClipboardItem.query
    if folder_id:
        items_query = items_query.filter(ClipboardItem.folder_id == None) if folder_id == "none" else items_query.filter(ClipboardItem.folder_id == int(folder_id))
    if query:
        items_query = items_query.filter(db.or_(ClipboardItem.title.ilike(f"%{query}%"), ClipboardItem.content.ilike(f"%{query}%"), ClipboardItem.data_type.ilike(f"%{query}%")))
    if date_filter: items_query = items_query.filter(db.func.date(ClipboardItem.created_at) == date_filter)
        
    if sort_by == 'date_asc': items_query = items_query.order_by(ClipboardItem.created_at.asc())
    elif sort_by == 'size_desc': items_query = items_query.order_by(ClipboardItem.file_size.desc().nullslast())
    elif sort_by == 'size_asc': items_query = items_query.order_by(ClipboardItem.file_size.asc().nullslast())
    elif sort_by == 'title_asc': items_query = items_query.order_by(ClipboardItem.title.asc())
    else: items_query = items_query.order_by(ClipboardItem.created_at.desc())
        
    try:
        items = items_query.all()
        return jsonify([{"id": i.id, "title": i.title, "content": i.content, "file_url": i.file_url, "file_size": i.file_size, "type": i.data_type, "folder_id": i.folder_id, "date": i.created_at.strftime("%Y-%m-%d %H:%M")} for i in items])
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/items', methods=['POST'])
def add_item():
    if not session.get('logged_in'): return jsonify({}), 401
    data = request.json or {}
    try:
        folder_id = data.get('folder_id')
        folder_id = None if folder_id in ['none', '', None] else int(folder_id)

        new_item = ClipboardItem(
            title=data.get('title'),
            content=data.get('content'), 
            file_url=data.get('file_url'),
            file_size=data.get('file_size'),
            data_type=data.get('type', 'text'),
            folder_id=folder_id
        )
        db.session.add(new_item)
        db.session.commit()
        return jsonify({"status": "saved", "id": new_item.id})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/api/items/<int:item_id>', methods=['PUT'])
def update_item(item_id):
    if not session.get('logged_in'): return jsonify({}), 401
    try:
        item = ClipboardItem.query.get(item_id)
        if not item: return jsonify({"status": "not found"}), 404
        data = request.json or {}
        if 'title' in data: item.title = data['title']
        if 'folder_id' in data:
            f_id = data['folder_id']
            item.folder_id = None if f_id in ['none', '', None] else int(f_id)
        if 'content' in data and item.data_type == 'text': item.content = data['content']
        db.session.commit()
        return jsonify({"status": "updated"})
    except: return jsonify({"error": "Failed"}), 500

@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    if not session.get('logged_in'): return jsonify({}), 401
    try:
        item = ClipboardItem.query.get(item_id)
        if not item: return jsonify({"status": "not found"}), 404
        
        # Clean up Vercel Blob Space automatically
        if item.file_url:
            token = os.environ.get('BLOB_READ_WRITE_TOKEN')
            if token:
                try: 
                    headers = {"authorization": f"Bearer {token}", "x-api-version": "7"}
                    requests.post("https://blob.vercel-storage.com/delete", headers=headers, json={"urls": [item.file_url]})
                except: pass

        db.session.delete(item)
        db.session.commit()
        return jsonify({"status": "deleted"})
    except: return jsonify({"error": "Failed"}), 500

@app.route('/favicon.ico')
def favicon(): return '', 204

if __name__ == '__main__': app.run(debug=True)