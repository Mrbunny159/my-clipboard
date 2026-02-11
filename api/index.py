import os
from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = os.environ.get("SECRET_KEY", "dev-key-123")

# Database Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get("DATABASE_URL")
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

# Create tables (Run once)
with app.app_context():
    db.create_all()

@app.route('/')
def index():
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
    if not session.get('logged_in'): return jsonify([]), 401
    
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

@app.route('/api/items', methods=['POST'])
def add_item():
    if not session.get('logged_in'): return jsonify({}), 401
    data = request.json
    new_item = ClipboardItem(
        title=data.get('title'),
        content=data['content'], 
        data_type=data['type']
    )
    db.session.add(new_item)
    db.session.commit()
    return jsonify({"status": "saved"})