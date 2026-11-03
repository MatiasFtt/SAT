import os
import re
import hmac
from datetime import datetime, timezone
from dotenv import load_dotenv
from flask import Flask, current_app, jsonify, request, session
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()
db = SQLAlchemy()

def utcnow():
    return datetime.now(timezone.utc)

class Client(db.Model):
    __tablename__ = "clients"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    company = db.Column(db.String(160))
    email = db.Column(db.String(180))
    phone = db.Column(db.String(50))
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

class WorkOrder(db.Model):
    __tablename__ = "work_orders"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(32), unique=True, nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id", ondelete="SET NULL"))
    status = db.Column(db.String(30), nullable=False, default="Pendiente")
    priority = db.Column(db.String(20), nullable=False, default="Media")
    assigned_to = db.Column(db.String(160))
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    client = db.relationship("Client", backref="work_orders")

class Technician(db.Model):
    __tablename__ = "technicians"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), unique=True, nullable=False)
    specialty = db.Column(db.String(160))
    phone = db.Column(db.String(50))
    available = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(80), nullable=False)
    entity = db.Column(db.String(80), nullable=False)
    entity_id = db.Column(db.Integer)
    details = db.Column(db.Text)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

class User(db.Model):
    __tablename__ = "app_users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

def log_event(action, entity, entity_id=None, details=None):
    try:
        db.session.add(AuditLog(action=action, entity=entity, entity_id=entity_id, details=details))
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("No se pudo guardar el evento de auditoría")

def next_work_order_code():
    # Serialize PostgreSQL requests so concurrent creates receive distinct codes.
    if db.engine.dialect.name == "postgresql":
        db.session.execute(db.text("SELECT pg_advisory_xact_lock(73190421)"))
    codes = db.session.query(WorkOrder.code).all()
    numbers = [
        int(match.group(1))
        for (code,) in codes
        if (match := re.fullmatch(r"OS-(\d{4,8})", code or ""))
    ]
    return f"OS-{max(numbers, default=-1) + 1:04d}"

def client_json(c):
    return {"id":c.id,"name":c.name,"company":c.company,"email":c.email,"phone":c.phone,
            "created_at":c.created_at.isoformat() if c.created_at else None}

def order_json(o):
    return {"id":o.id,"code":o.code,"title":o.title,"description":o.description,"client_id":o.client_id,
            "client_name":o.client.name if o.client else "—","status":o.status,"priority":o.priority,
            "assigned_to":o.assigned_to,"created_at":o.created_at.isoformat() if o.created_at else None,
            "updated_at":o.updated_at.isoformat() if o.updated_at else None}

def create_app():
    app=Flask(__name__)
    is_vercel=os.getenv("VERCEL", "").lower() in {"1", "true"}
    secret_key=os.getenv("SECRET_KEY")
    if is_vercel and not secret_key:
        raise RuntimeError("Configura SECRET_KEY en las variables de entorno de Vercel.")
    if is_vercel and not os.getenv("DATABASE_URL"):
        raise RuntimeError("Configura DATABASE_URL de Supabase en las variables de entorno de Vercel.")
    app.secret_key=secret_key or "local-dev-secret-change-before-sharing"
    url=os.getenv("DATABASE_URL","").strip()
    if url.startswith("postgres://"): url=url.replace("postgres://","postgresql+psycopg://",1)
    elif url.startswith("postgresql://"): url=url.replace("postgresql://","postgresql+psycopg://",1)
    app.config["SQLALCHEMY_DATABASE_URI"]=url or "sqlite:///sat_dev.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"]=False
    if url.startswith("postgresql+"):
        app.config["SQLALCHEMY_ENGINE_OPTIONS"]={
            "pool_pre_ping":True,
            "pool_size":1,
            "max_overflow":0,
            "pool_recycle":300,
            "connect_args":{"prepare_threshold":None},
        }
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = is_vercel or os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    db.init_app(app)
    configured_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    allowed_origins = list({configured_origin, "http://localhost:5173", "http://127.0.0.1:5173"})
    CORS(app,resources={r"/api/*":{"origins":allowed_origins}},supports_credentials=True)

    @app.before_request
    def require_login_for_api():
        if not request.path.startswith("/api/") or request.method == "OPTIONS":
            return None
        public_paths = {"/api/health", "/api/auth/me", "/api/auth/login", "/api/auth/register", "/api/auth/logout"}
        if request.path in public_paths:
            return None
        user_id = session.get("user_id")
        if not user_id or not db.session.get(User, user_id):
            session.clear()
            return jsonify(error="Inicia sesión para continuar."), 401

    @app.get("/api/health")
    def health():
        try:
            db.session.execute(db.text("SELECT 1"))
            return jsonify(status="ok",database="connected")
        except Exception as exc:
            db.session.rollback()
            return jsonify(status="error",database="unavailable",detail=str(exc)),503

    @app.get("/api/auth/me")
    def auth_me():
        user = db.session.get(User, session.get("user_id")) if session.get("user_id") else None
        if not user:
            session.clear()
        return jsonify(user={"id": user.id, "username": user.username} if user else None,
                       has_users=User.query.count() > 0)

    @app.post("/api/auth/login")
    def auth_login():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        user = User.query.filter_by(username=username).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify(error="Usuario o contraseña incorrectos."), 401
        session.clear()
        session["user_id"] = user.id
        return jsonify(user={"id": user.id, "username": user.username})

    @app.post("/api/auth/register")
    def auth_register():
        data = request.get_json(silent=True) or {}
        existing_users=User.query.count()
        active_user=db.session.get(User,session.get("user_id")) if session.get("user_id") else None
        if existing_users and not active_user:
            return jsonify(error="Inicia sesión para que un usuario autorizado pueda crear otra cuenta."),403
        if not existing_users and os.getenv("VERCEL", "").lower() in {"1", "true"}:
            supplied=(data.get("bootstrap_token") or "").strip()
            expected=os.getenv("BOOTSTRAP_TOKEN", "")
            if not expected or not hmac.compare_digest(supplied,expected):
                return jsonify(error="Ingresa el código inicial configurado por el administrador."),403
        username = (data.get("username") or "").strip().lower()
        password = data.get("password") or ""
        if len(username) < 3 or len(username) > 50:
            return jsonify(error="El usuario debe tener entre 3 y 50 caracteres."), 400
        if len(password) < 8:
            return jsonify(error="La contraseña debe tener al menos 8 caracteres."), 400
        if User.query.filter_by(username=username).first():
            return jsonify(error="Ese nombre de usuario ya existe."), 409
        user = User(username=username, password_hash=generate_password_hash(password))
        db.session.add(user)
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception("No se pudo crear el usuario")
            return jsonify(error="No se pudo crear el usuario."), 500
        if not session.get("user_id"):
            session["user_id"] = user.id
        return jsonify(user={"id": user.id, "username": user.username}), 201

    @app.post("/api/auth/logout")
    def auth_logout():
        session.clear()
        return jsonify(message="Sesión cerrada.")

    @app.get("/api/dashboard")
    def dashboard():
        clients=db.session.query(func.count(Client.id)).scalar() or 0
        total=db.session.query(func.count(WorkOrder.id)).scalar() or 0
        opened=db.session.query(func.count(WorkOrder.id)).filter(WorkOrder.status!="Completada").scalar() or 0
        rows=db.session.query(WorkOrder.status,func.count(WorkOrder.id)).group_by(WorkOrder.status).all()
        available_technicians=db.session.query(func.count(Technician.id)).filter_by(available=True).scalar() or 0
        return jsonify(total_clients=clients,total_orders=total,open_orders=opened,available_technicians=available_technicians,
                       orders_by_status=[{"status":s,"count":n} for s,n in rows])

    @app.route("/api/technicians",methods=["GET","POST"])
    def technicians_route():
        if request.method=="GET":
            rows=Technician.query.order_by(Technician.name.asc()).all()
            return jsonify([{"id":t.id,"name":t.name,"specialty":t.specialty,"phone":t.phone,
                             "available":t.available,"created_at":t.created_at.isoformat()} for t in rows])
        data=request.get_json(silent=True) or {}
        name=(data.get("name") or "").strip()
        if len(name)<2: return jsonify(error="El nombre del técnico debe tener al menos 2 caracteres."),400
        if Technician.query.filter(func.lower(Technician.name)==name.lower()).first():
            return jsonify(error="Ya existe un técnico con ese nombre."),409
        technician=Technician(name=name,specialty=(data.get("specialty") or "").strip() or None,
                              phone=(data.get("phone") or "").strip() or None)
        db.session.add(technician); db.session.commit()
        log_event("CREATE","technician",technician.id,f"Técnico agregado: {technician.name}")
        return jsonify(id=technician.id,name=technician.name,specialty=technician.specialty,
                       phone=technician.phone,available=technician.available,
                       created_at=technician.created_at.isoformat()),201

    @app.patch("/api/technicians/<int:technician_id>")
    def update_technician(technician_id):
        technician=db.session.get(Technician,technician_id)
        if not technician: return jsonify(error="Técnico no encontrado."),404
        data=request.get_json(silent=True) or {}
        if "available" in data:
            technician.available=bool(data["available"])
        if "specialty" in data:
            technician.specialty=(data["specialty"] or "").strip() or None
        db.session.commit()
        log_event("UPDATE","technician",technician.id,
                  f"Disponibilidad de {technician.name}: {'disponible' if technician.available else 'no disponible'}")
        return jsonify(id=technician.id,name=technician.name,specialty=technician.specialty,
                       phone=technician.phone,available=technician.available,
                       created_at=technician.created_at.isoformat())

    @app.route("/api/clients",methods=["GET","POST"])
    def clients_route():
        if request.method=="GET":
            return jsonify([client_json(c) for c in Client.query.order_by(Client.created_at.desc()).all()])
        data=request.get_json(silent=True) or {}; name=(data.get("name") or "").strip()
        if not name: return jsonify(error="El nombre del cliente es obligatorio."),400
        c=Client(name=name,company=data.get("company"),email=data.get("email"),phone=data.get("phone"))
        db.session.add(c); db.session.commit()
        log_event("CREATE","client",c.id,f"Cliente creado: {c.name}")
        return jsonify(client_json(c)),201

    @app.delete("/api/clients/<int:client_id>")
    def delete_client(client_id):
        c=db.session.get(Client,client_id)
        if not c: return jsonify(error="Cliente no encontrado."),404
        name=c.name
        WorkOrder.query.filter_by(client_id=client_id).update({WorkOrder.client_id: None}, synchronize_session=False)
        db.session.delete(c); db.session.commit()
        log_event("DELETE","client",client_id,f"Cliente eliminado: {name}")
        return jsonify(message="Cliente eliminado.")

    @app.route("/api/work-orders",methods=["GET","POST"])
    def work_orders_route():
        if request.method=="GET":
            return jsonify([order_json(o) for o in WorkOrder.query.order_by(WorkOrder.created_at.desc()).all()])
        data=request.get_json(silent=True) or {}; title=(data.get("title") or "").strip()
        if not title: return jsonify(error="El título es obligatorio."),400
        assigned_to=(data.get("assigned_to") or "").strip() or None
        if assigned_to and not Technician.query.filter_by(name=assigned_to,available=True).first():
            return jsonify(error="El técnico seleccionado no está disponible."),400
        code=next_work_order_code()
        o=WorkOrder(code=code,title=title,description=data.get("description"),client_id=data.get("client_id") or None,
                    status=data.get("status") or "Pendiente",priority=data.get("priority") or "Media",
                    assigned_to=assigned_to)
        db.session.add(o); db.session.commit()
        log_event("CREATE","work_order",o.id,f"Orden creada: {o.code}")
        return jsonify(order_json(o)),201

    @app.patch("/api/work-orders/<int:order_id>")
    def update_work_order(order_id):
        o=db.session.get(WorkOrder,order_id)
        if not o: return jsonify(error="Orden no encontrada."),404
        data=request.get_json(silent=True) or {}; old=o.status
        allowed={"Pendiente","En progreso","En espera","Completada","Cancelada"}
        if "status" in data:
            if data["status"] not in allowed: return jsonify(error="Estado no válido."),400
            o.status=data["status"]
        for field in ("title","description","priority","assigned_to"):
            if field in data: setattr(o,field,data[field])
        o.updated_at=utcnow(); db.session.commit()
        action = "COMPLETE" if old != o.status and o.status == "Completada" else "UPDATE"
        log_event(action,"work_order",o.id,f"Orden {o.code}: {old} → {o.status}")
        return jsonify(order_json(o))

    @app.get("/api/audit")
    def audit_route():
        rows=AuditLog.query.order_by(AuditLog.created_at.desc()).limit(200).all()
        return jsonify([{"id":x.id,"action":x.action,"entity":x.entity,"entity_id":x.entity_id,
                         "details":x.details,"created_at":x.created_at.isoformat()} for x in rows])

    @app.cli.command("init-db")
    def init_db():
        with app.app_context(): db.create_all()
        print("Tablas creadas correctamente en la base configurada.")

    @app.cli.command("seed-demo")
    def seed_demo():
        with app.app_context():
            if Client.query.count()==0:
                c1=Client(name="María González",company="Comercial del Sur",email="maria@example.com",phone="0981 123 456")
                c2=Client(name="Juan Pérez",company="Taller Central",email="juan@example.com",phone="0972 555 222")
                db.session.add_all([c1,c2]); db.session.commit()
                db.session.add_all([
                    WorkOrder(code="OS-DEMO-001",title="Mantenimiento de equipo",client_id=c1.id,status="En progreso",priority="Alta",assigned_to="Técnico 1"),
                    WorkOrder(code="OS-DEMO-002",title="Instalación de software",client_id=c2.id,status="Pendiente",priority="Media",assigned_to="Técnico 2")])
                db.session.commit(); log_event("SEED","system",None,"Datos demo insertados")
        print("Seed de demostración completado.")
    return app

app=create_app()
