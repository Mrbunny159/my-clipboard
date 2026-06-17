import os
import sys
import base64
import requests
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = os.environ.get("SECRET_KEY", "dev-key-123")

# ==========================================
# 1. DATABASE CONFIGURATION (Neon PostgreSQL)
# ==========================================
database_url = os.environ.get("DATABASE_URL")
print(f"[INFO] DATABASE_URL exists: {bool(database_url)}", file=sys.stderr)

if database_url:
    # Fix postgresql:// to postgresql+psycopg2:// for SQLAlchemy compatibility
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    
    # Critical for Serverless environments (Vercel) to prevent connection timeouts
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'poolclass': NullPool,
        'connect_args': {'connect_timeout': 10}
    }
    print("[INFO] Using Neon PostgreSQL database", file=sys.stderr)
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = "sqlite:///clipboard.db"
    print("[WARNING] DATABASE_URL not set, using SQLite fallback", file=sys.stderr)

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

try:
    db = SQLAlchemy(app)
    print("[INFO] SQLAlchemy initialized successfully", file=sys.stderr)
except Exception as e:
    print(f"[ERROR] Failed to initialize SQLAlchemy: {e}", file=sys.stderr)
    db = None

# Login Credentials
USER_CREDENTIALS = {
    "username": os.environ.get("APP_USERNAME", "sufi"),
    "password": os.environ.get("APP_PASSWORD", "sufiroot")
}

# ==========================================
# 2. VERCEL INTEGRATION HELPERS
# ==========================================
def upload_to_vercel_blob(filename, base64_data):
    """Uploads a file to Vercel Blob Storage via REST API."""
    token = os.environ.get('BLOB_READ_WRITE_TOKEN')
    if not token:
        print("[ERROR] Vercel Blob token (BLOB_READ_WRITE_TOKEN) missing.", file=sys.stderr)
        return None
        
    # Extract raw bytes from base64 string provided by the frontend
    if ',' in base64_data:
        base64_data = base64_data.split(',')[1]
    
    try:
        file_bytes = base64.b64decode(base64_data)
        url = f"https://blob.vercel-storage.com/{filename}"
        headers = {
            "authorization": f"Bearer {token}",
        }
        
        response = requests.put(url, headers=headers, data=file_bytes)
        response.raise_for_status()
        return response.json().get('url') # Returns the live CDN link
    except Exception as e:
        print(f"[ERROR] Blob Upload Failed: {e}", file=sys.stderr)
        return None

def get_edge_config():
    """Fetches global app settings from Vercel Edge Config."""
    edge_url = os.environ.get('EDGE_CONFIG')
    if not edge_url:
        return {"default_sort": "date_desc", "show_sidebar": True}
        
    try:
        response = requests.get(edge_url)
        response.raise_for_status()
        return response.json().get('items', {})
    except Exception as e:
        print(f"[ERROR] Edge Config Fetch Failed: {e}", file=sys.stderr)
        return {"default_sort": "date_desc", "show_sidebar": True}


# ==========================================
# 3. DATABASE MODELS
# ==========================================
class Folder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship('ClipboardItem', backref='folder', lazy=True, cascade="all, delete-orphan")

class ClipboardItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=True)
    content = db.Column(db.Text, nullable=True)          # Pure text snippets
    file_url = db.Column(db.String(1024), nullable=True) # Direct URL to Vercel Blob asset
    file_size = db.Column(db.Integer, nullable=True)     # Size in bytes
    data_type = db.Column(db.String(100), nullable=False)# 'text', 'image/png', 'application/pdf', etc.
    folder_id = db.Column(db.Integer, db.ForeignKey('folder.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

def init_db():
    try:
        with app.app_context():
            db.create_all()
    except Exception as e:
        print(f"[ERROR] Database init error: {str(e)}", file=sys.stderr)


# ==========================================
# 4. APPLICATION ROUTES
# ==========================================
@app.route('/')
def index():
    init_db()
    return render_template('index.html', login_required=not session.get('logged_in'))

@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    if data.get('username') == USER_CREDENTIALS["username"] and data.get('password') == USER_CREDENTIALS["password"]:
        session['logged_in'] = True
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 401

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return jsonify({"status": "logged out"})

@app.route('/api/config', methods=['GET'])
def fetch_config():
    """Exposes Vercel Edge Config variables to the frontend"""
    if not session.get('logged_in'): return jsonify({}), 401
    return jsonify(get_edge_config())

@app.route('/api/folders', methods=['GET', 'POST'])
def handle_folders():
    if not session.get('logged_in'): return jsonify([]), 401
    
    if request.method == 'POST':
        data = request.json or {}
        name = data.get('name', '').strip()
        if not name: return jsonify({"error": "Folder name is required"}), 400
        try:
            new_folder = Folder(name=name)
            db.session.add(new_folder)
            db.session.commit()
            return jsonify({"id": new_folder.id, "name": new_folder.name}), 201
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": "Folder already exists or error occurred"}), 400

    folders = Folder.query.order_by(Folder.name.asc()).all()
    return jsonify([{"id": f.id, "name": f.name} for f in folders])

@app.route('/api/items', methods=['GET'])
def get_items():
    if not session.get('logged_in'): 
        return jsonify([]), 401
    
    query = request.args.get('q', '').strip()
    date_filter = request.args.get('date', '').strip()
    folder_id = request.args.get('folder_id', '').strip()
    sort_by = request.args.get('sort', 'date_desc').strip()
    
    items_query = ClipboardItem.query
    
    if folder_id:
        if folder_id == "none":
            items_query = items_query.filter(ClipboardItem.folder_id == None)
        else:
            items_query = items_query.filter(ClipboardItem.folder_id == int(folder_id))
            
    if query:
        items_query = items_query.filter(
            db.or_(
                ClipboardItem.title.ilike(f"%{query}%"),
                ClipboardItem.content.ilike(f"%{query}%"),
                ClipboardItem.data_type.ilike(f"%{query}%")
            )
        )
        
    if date_filter:
        items_query = items_query.filter(db.func.date(ClipboardItem.created_at) == date_filter)
        
    # Apply Sorting logic
    if sort_by == 'date_asc':
        items_query = items_query.order_by(ClipboardItem.created_at.asc())
    elif sort_by == 'size_desc':
        items_query = items_query.order_by(ClipboardItem.file_size.desc().nullslast())
    elif sort_by == 'size_asc':
        items_query = items_query.order_by(ClipboardItem.file_size.asc().nullslast())
    elif sort_by == 'title_asc':
        items_query = items_query.order_by(ClipboardItem.title.asc())
    else: 
        items_query = items_query.order_by(ClipboardItem.created_at.desc())
        
    try:
        items = items_query.all()
        response = [{
            "id": i.id, 
            "title": i.title, 
            "content": i.content, 
            "file_url": i.file_url,
            "file_size": i.file_size,
            "type": i.data_type, 
            "folder_id": i.folder_id,
            "date": i.created_at.strftime("%Y-%m-%d %H:%M")
        } for i in items]
        return jsonify(response)
    except Exception as e:
        print(f"[ERROR] Database GET error: {str(e)}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/api/items', methods=['POST'])
def add_item():
    if not session.get('logged_in'): 
        return jsonify({}), 401
    
    data = request.json or {}
    try:
        folder_id = data.get('folder_id')
        if folder_id == 'none' or folder_id == '':
            folder_id = None
        else:
            folder_id = int(folder_id)

        # ----------------------------------------------------
        # VERCEL BLOB INTERCEPTION LOGIC
        # ----------------------------------------------------
        file_url = data.get('file_url')
        content = data.get('content')
        item_type = data.get('type', 'text')
        
        # If it's a file payload sent as base64 from the frontend:
        if item_type != 'text' and content and content.startswith('data:'):
            safe_title = data.get('title', 'upload').replace(" ", "_")
            timestamp = int(datetime.utcnow().timestamp())
            blob_filename = f"{timestamp}_{safe_title}"
            
            # Send the file to Vercel Blob
            live_blob_url = upload_to_vercel_blob(blob_filename, content)
            
            if live_blob_url:
                # File successfully uploaded! Save the URL to DB, discard the heavy base64.
                file_url = live_blob_url
                content = None 

        new_item = ClipboardItem(
            title=data.get('title'),
            content=content, 
            file_url=file_url,
            file_size=data.get('file_size'),
            data_type=item_type,
            folder_id=folder_id
        )
        
        db.session.add(new_item)
        db.session.commit()
        return jsonify({"status": "saved", "id": new_item.id})
    except Exception as e:
        db.session.rollback()
        print(f"[ERROR] Database POST error: {str(e)}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    if not session.get('logged_in'): 
        return jsonify({}), 401
    
    try:
        item = ClipboardItem.query.get(item_id)
        if not item: 
            return jsonify({"status": "not found"}), 404
            
        # (Optional) If you want to delete the file from Vercel Blob when deleted from DB, 
        # you would call the Vercel Blob DELETE API here using `item.file_url`.
        
        db.session.delete(item)
        db.session.commit()
        return jsonify({"status": "deleted"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/favicon.ico')
def favicon(): return '', 204

if __name__ == '__main__':
    app.run(debug=True)