import os
import sys
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import NullPool

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = os.environ.get("SECRET_KEY", "dev-key-123")

# Database Configuration
database_url = os.environ.get("DATABASE_URL")
print(f"[INFO] DATABASE_URL exists: {bool(database_url)}", file=sys.stderr)

if database_url:
    # Fix postgresql:// to postgresql+psycopg2://
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    # For serverless environments, use NullPool
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'poolclass': NullPool,
        'connect_args': {'connect_timeout': 10}
    }
    print("[INFO] Using Neon PostgreSQL database", file=sys.stderr)
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = "sqlite:///clipboard.db"
    print("[WARNING] DATABASE_URL not set, using SQLite", file=sys.stderr)

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

try:
    db = SQLAlchemy(app)
    print("[INFO] SQLAlchemy initialized successfully", file=sys.stderr)
except Exception as e:
    print(f"[ERROR] Failed to initialize SQLAlchemy: {e}", file=sys.stderr)
    db = None

# Login Credentials - Use environment variable if available
USER_CREDENTIALS = {
    "username": os.environ.get("APP_USERNAME", "sufi"),
    "password": os.environ.get("APP_PASSWORD", "sufiroot")
}
print(f"[INFO] Using username from env: {bool(os.environ.get('APP_USERNAME'))}", file=sys.stderr)

# Model
class ClipboardItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=True)
    content = db.Column(db.Text, nullable=False)
    data_type = db.Column(db.String(10), nullable=False) # 'text' or 'image'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Create tables safely
def init_db():
    try:
        with app.app_context():
            print("[DEBUG] Creating database tables", file=sys.stderr)
            db.create_all()
            print("[DEBUG] Database tables created successfully", file=sys.stderr)
    except Exception as e:
        print(f"[ERROR] Database init error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

@app.route('/')
def index():
    try:
        print("[DEBUG] Serving index.html", file=sys.stderr)
        init_db()  # Initialize database on first request
        return render_template('index.html', login_required=not session.get('logged_in'))
    except Exception as e:
        print(f"[ERROR] Error serving index: {str(e)}", file=sys.stderr)
        return str(e), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        print(f"[DEBUG] Login attempt with username: {username}", file=sys.stderr)
        
        if username == USER_CREDENTIALS["username"] and \
           password == USER_CREDENTIALS["password"]:
            session['logged_in'] = True
            print(f"[DEBUG] Login successful for {username}", file=sys.stderr)
            return jsonify({"status": "success"})
        
        print(f"[DEBUG] Login failed for {username}", file=sys.stderr)
        return jsonify({"status": "error"}), 401
    except Exception as e:
        print(f"[ERROR] Error in login: {str(e)}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/logout')
def logout():
    try:
        session.pop('logged_in', None)
        print("[DEBUG] User logged out", file=sys.stderr)
        return jsonify({"status": "logged out"})
    except Exception as e:
        print(f"[ERROR] Error in logout: {str(e)}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/api/items', methods=['GET'])
def get_items():
    try:
        if not session.get('logged_in'): 
            print("[INFO] User not logged in", file=sys.stderr)
            return jsonify([]), 401
        
        print("[DEBUG] Getting items from database", file=sys.stderr)
        init_db()  # Ensure tables exist
        
        query = request.args.get('q', '')
        date_filter = request.args.get('date', '')
        
        print(f"[DEBUG] Query: '{query}', Date: '{date_filter}'", file=sys.stderr)
        
        items_query = ClipboardItem.query
        if query:
            items_query = items_query.filter(
                db.or_(
                    ClipboardItem.title.contains(query),
                    ClipboardItem.content.contains(query)
                )
            )
        if date_filter:
            items_query = items_query.filter(db.func.date(ClipboardItem.created_at) == date_filter)
            
        items = items_query.order_by(ClipboardItem.created_at.desc()).all()
        print(f"[DEBUG] Found {len(items)} items", file=sys.stderr)
        
        response = [{
            "id": i.id, "title": i.title, "content": i.content, 
            "type": i.data_type, "date": i.created_at.strftime("%Y-%m-%d %H:%M")
        } for i in items]
        
        return jsonify(response)
    except SQLAlchemyError as e:
        print(f"[ERROR] SQLAlchemy error in GET /api/items: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    except Exception as e:
        print(f"[ERROR] Unexpected error in GET /api/items: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": f"Error: {str(e)}"}), 500

@app.route('/api/items', methods=['POST'])
def add_item():
    try:
        if not session.get('logged_in'): 
            print("[INFO] Unauthorized POST attempt", file=sys.stderr)
            return jsonify({}), 401
        
        print("[DEBUG] Adding new clipboard item", file=sys.stderr)
        init_db()  # Ensure tables exist
        
        data = request.json
        print(f"[DEBUG] Item type: {data.get('type')}, Has title: {bool(data.get('title'))}", file=sys.stderr)
        
        new_item = ClipboardItem(
            title=data.get('title'),
            content=data['content'], 
            data_type=data['type']
        )
        db.session.add(new_item)
        db.session.commit()
        print("[DEBUG] Item saved successfully", file=sys.stderr)
        return jsonify({"status": "saved"})
    except SQLAlchemyError as e:
        db.session.rollback()
        print(f"[ERROR] SQLAlchemy error in POST /api/items: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    except Exception as e:
        print(f"[ERROR] Unexpected error in POST /api/items: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    try:
        if not session.get('logged_in'): 
            print("[INFO] Unauthorized DELETE attempt", file=sys.stderr)
            return jsonify({}), 401
        
        print(f"[DEBUG] Deleting item {item_id}", file=sys.stderr)
        init_db()  # Ensure tables exist
        
        item = ClipboardItem.query.get(item_id)
        if not item: 
            print(f"[DEBUG] Item {item_id} not found", file=sys.stderr)
            return jsonify({"status": "not found"}), 404
        db.session.delete(item)
        db.session.commit()
        print(f"[DEBUG] Item {item_id} deleted successfully", file=sys.stderr)
        return jsonify({"status": "deleted"})
    except SQLAlchemyError as e:
        db.session.rollback()
        print(f"[ERROR] SQLAlchemy error in DELETE /api/items/{item_id}: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    except Exception as e:
        print(f"[ERROR] Unexpected error in DELETE /api/items/{item_id}: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": str(e)}), 500