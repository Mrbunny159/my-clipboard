import os
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = os.environ.get("SECRET_KEY", "dev-key-123")

# Database Configuration
database_url = os.environ.get("DATABASE_URL")
if database_url:
    # Fix postgresql:// to postgresql+psycopg2://
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = "sqlite:///clipboard.db"

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Login Credentials
USER_CREDENTIALS = {"username": "sufi", "password": "sufiroot"}

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
            db.create_all()
    except Exception as e:
        print(f"Database init error: {e}")

@app.route('/')
def index():
    init_db()  # Initialize database on first request
    return render_template('index.html', login_required=not session.get('logged_in'))

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    if data.get('username') == USER_CREDENTIALS["username"] and \
       data.get('password') == USER_CREDENTIALS["password"]:
        session['logged_in'] = True
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 401

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return jsonify({"status": "logged out"})

@app.route('/api/items', methods=['GET'])
def get_items():
    try:
        if not session.get('logged_in'): 
            return jsonify([]), 401
        
        init_db()  # Ensure tables exist
        
        query = request.args.get('q', '')
        date_filter = request.args.get('date', '')
        
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
        return jsonify([{
            "id": i.id, "title": i.title, "content": i.content, 
            "type": i.data_type, "date": i.created_at.strftime("%Y-%m-%d %H:%M")
        } for i in items])
    except SQLAlchemyError as e:
        print(f"Database error: {e}")
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/items', methods=['POST'])
def add_item():
    try:
        if not session.get('logged_in'): 
            return jsonify({}), 401
        
        init_db()  # Ensure tables exist
        
        data = request.json
        new_item = ClipboardItem(
            title=data.get('title'),
            content=data['content'], 
            data_type=data['type']
        )
        db.session.add(new_item)
        db.session.commit()
        return jsonify({"status": "saved"})
    except SQLAlchemyError as e:
        db.session.rollback()
        print(f"Database error: {e}")
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    try:
        if not session.get('logged_in'): 
            return jsonify({}), 401
        
        init_db()  # Ensure tables exist
        
        item = ClipboardItem.query.get(item_id)
        if not item: 
            return jsonify({"status": "not found"}), 404
        db.session.delete(item)
        db.session.commit()
        return jsonify({"status": "deleted"})
    except SQLAlchemyError as e:
        db.session.rollback()
        print(f"Database error: {e}")
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500