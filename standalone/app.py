#!/usr/bin/env python3
"""Dependency-free local School Management System for VS Code."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("SCHOOL_DB", ROOT / "school.db"))
PORT = int(os.environ.get("PORT", "8000"))
SESSIONS: dict[str, int] = {}
INITIAL_EMAIL = "oliverchibala@gmail.com"
INITIAL_PASSWORD = "0l1v3r"

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','headteacher','registrar','teacher')),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS classes (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, grade TEXT NOT NULL, stream TEXT NOT NULL DEFAULT 'A',
 year INTEGER NOT NULL, UNIQUE(name,year)
);
CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS students (
 id INTEGER PRIMARY KEY, admission TEXT NOT NULL UNIQUE, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
 guardian TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', class_id INTEGER REFERENCES classes(id),
 status TEXT NOT NULL DEFAULT 'active', admitted TEXT NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE IF NOT EXISTS attendance (
 student_id INTEGER NOT NULL REFERENCES students(id), day TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')),
 PRIMARY KEY(student_id,day)
);
CREATE TABLE IF NOT EXISTS marks (
 id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), subject_id INTEGER NOT NULL REFERENCES subjects(id),
 assessment TEXT NOT NULL, term TEXT NOT NULL, year INTEGER NOT NULL, score REAL NOT NULL CHECK(score>=0),
 maximum REAL NOT NULL CHECK(maximum>0 AND score<=maximum), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS invoices (
 id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), description TEXT NOT NULL,
 term TEXT NOT NULL, year INTEGER NOT NULL, amount REAL NOT NULL CHECK(amount>0), due_date TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount REAL NOT NULL CHECK(amount>0),
 method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    try:
        _, salt, expected = stored.split("$")
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def initialize() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(SCHEMA)
        db.execute(
            "INSERT OR IGNORE INTO users(name,email,password,role) VALUES(?,?,?,'admin')",
            ("School Administrator", INITIAL_EMAIL, hash_password(INITIAL_PASSWORD)),
        )


class Handler(BaseHTTPRequestHandler):
    server_version = "SchoolManagementSystem/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.log_date_time_string()} {fmt % args}")

    def send_json(self, payload: object, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        if size > 200_000:
            raise ValueError("Request is too large.")
        raw = self.rfile.read(size) if size else b"{}"
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object.")
        return data

    def actor(self) -> sqlite3.Row | None:
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        uid = SESSIONS.get(token)
        if uid is None:
            return None
        with connect() as db:
            return db.execute("SELECT * FROM users WHERE id=? AND active=1", (uid,)).fetchone()

    def authorized(self, roles: tuple[str, ...] = ()) -> sqlite3.Row | None:
        user = self.actor()
        if not user:
            self.send_json({"error": "Sign in to continue."}, 401)
            return None
        if roles and user["role"] not in roles:
            self.send_json({"error": "Your account cannot perform this action."}, 403)
            return None
        return user

    def do_GET(self) -> None:
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        if path == "/" or path == "/index.html":
            content = (ROOT / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if path == "/api/health":
            self.send_json({"status": "ok", "database": "connected"})
            return
        if path == "/api/auth/me":
            user = self.authorized()
            if user:
                self.send_json({"user": self.public_user(user)})
            return
        user = self.authorized()
        if not user:
            return
        try:
            with connect() as db:
                if path == "/api/dashboard/summary":
                    today = date.today().isoformat()
                    attend = db.execute("SELECT COUNT(*) recorded,SUM(status='present') present,SUM(status='absent') absent FROM attendance WHERE day=?", (today,)).fetchone()
                    fees = db.execute("SELECT COALESCE(SUM(balance),0) FROM (SELECT i.amount-COALESCE(SUM(p.amount),0) balance FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id GROUP BY i.id)").fetchone()[0]
                    self.send_json({"students": db.execute("SELECT COUNT(*) FROM students WHERE status='active'").fetchone()[0], "staff": db.execute("SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0], "classes": db.execute("SELECT COUNT(*) FROM classes").fetchone()[0], "attendance": {"recorded": attend["recorded"] or 0, "present": attend["present"] or 0, "absent": attend["absent"] or 0}, "feesOutstanding": fees})
                elif path == "/api/students":
                    status = query.get("status", ["active"])[0]
                    search = query.get("q", [""])[0].strip()
                    sql = "SELECT s.*,c.name class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE (?='all' OR s.status=?) AND (?='' OR s.admission LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR c.name LIKE ?) ORDER BY s.id DESC LIMIT 500"
                    like = f"%{search}%"
                    rows = db.execute(sql, (status, status, search, like, like, like, like)).fetchall()
                    self.send_json({"students": [self.student(r) for r in rows]})
                elif path == "/api/staff":
                    self.send_json({"staff": [self.public_user(r) | {"isActive": bool(r["active"])} for r in db.execute("SELECT * FROM users ORDER BY name")]})
                elif path == "/api/classes":
                    rows = db.execute("SELECT c.*,COUNT(s.id) student_count FROM classes c LEFT JOIN students s ON s.class_id=c.id AND s.status='active' GROUP BY c.id ORDER BY c.year DESC,c.grade,c.stream").fetchall()
                    self.send_json({"classes": [dict(id=r["id"], name=r["name"], gradeLevel=r["grade"], stream=r["stream"], academicYear=r["year"], studentCount=r["student_count"]) for r in rows]})
                elif path == "/api/subjects":
                    self.send_json({"subjects": [dict(id=r["id"], code=r["code"], name=r["name"], isActive=bool(r["active"])) for r in db.execute("SELECT * FROM subjects WHERE active=1 ORDER BY name")]})
                elif path == "/api/attendance":
                    day = query.get("date", [date.today().isoformat()])[0]
                    class_id = query.get("classId", [""])[0]
                    rows = db.execute("SELECT s.id studentId,s.admission admissionNumber,s.first_name firstName,s.last_name lastName,c.name className,a.status FROM students s LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN attendance a ON a.student_id=s.id AND a.day=? WHERE s.status='active' AND (?='' OR s.class_id=?) ORDER BY c.name,s.last_name,s.first_name", (day, class_id, class_id)).fetchall()
                    self.send_json({"date": day, "records": [dict(r) for r in rows]})
                elif path == "/api/marks":
                    rows = db.execute("SELECT m.*,s.first_name firstName,s.last_name lastName,sub.name subjectName FROM marks m JOIN students s ON s.id=m.student_id JOIN subjects sub ON sub.id=m.subject_id ORDER BY m.year DESC,m.term,sub.name,s.last_name").fetchall()
                    self.send_json({"marks": [dict(id=r["id"], studentId=r["student_id"], firstName=r["firstName"], lastName=r["lastName"], subjectName=r["subjectName"], assessmentName=r["assessment"], term=r["term"], academicYear=r["year"], score=r["score"], maximumScore=r["maximum"], percentage=round(100*r["score"]/r["maximum"],1)) for r in rows]})
                elif path == "/api/fees":
                    rows = db.execute("SELECT i.*,s.admission,s.first_name,s.last_name,COALESCE(SUM(p.amount),0) paid FROM invoices i JOIN students s ON s.id=i.student_id LEFT JOIN payments p ON p.invoice_id=i.id GROUP BY i.id ORDER BY i.id DESC").fetchall()
                    self.send_json({"invoices": [self.invoice(r) for r in rows]})
                elif path == "/api/announcements":
                    rows = db.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()
                    self.send_json({"announcements": [dict(id=r["id"], title=r["title"], body=r["body"], published=bool(r["published"]), createdAt=r["created_at"]) for r in rows]})
                elif path == "/api/events":
                    rows = db.execute("SELECT * FROM events ORDER BY starts_at").fetchall()
                    self.send_json({"events": [dict(id=r["id"], title=r["title"], description=r["description"], startsAt=r["starts_at"], endsAt=r["ends_at"]) for r in rows]})
                elif path.startswith("/api/reports/students/"):
                    sid = path.rsplit("/", 1)[-1]
                    student = db.execute("SELECT s.*,c.name class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?", (sid,)).fetchone()
                    if not student:
                        self.send_json({"error": "Learner not found."}, 404); return
                    year = int(query.get("year", [str(date.today().year)])[0]); term = query.get("term", [""])[0]
                    marks = db.execute("SELECT m.*,sub.name subject FROM marks m JOIN subjects sub ON sub.id=m.subject_id WHERE m.student_id=? AND m.year=? AND (?='' OR m.term=?) ORDER BY sub.name,m.assessment", (sid, year, term, term)).fetchall()
                    att = db.execute("SELECT COUNT(*) recorded,SUM(status='present') present,SUM(status='absent') absent,SUM(status='late') late FROM attendance WHERE student_id=? AND substr(day,1,4)=?", (sid, str(year))).fetchone()
                    self.send_json({"student": self.student(student), "term": term or None, "academicYear": year, "marks": [dict(subjectName=r["subject"], assessmentName=r["assessment"], score=r["score"], maximumScore=r["maximum"], percentage=round(100*r["score"]/r["maximum"],1)) for r in marks], "attendance": {k: att[k] or 0 for k in ("recorded","present","absent","late")}})
                else:
                    self.send_json({"error": "Page not found."}, 404)
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"error": str(exc)}, 400)

    @staticmethod
    def student(r: sqlite3.Row) -> dict:
        return dict(id=r["id"], admissionNumber=r["admission"], firstName=r["first_name"], lastName=r["last_name"], guardianName=r["guardian"], guardianPhone=r["phone"], classId=r["class_id"], className=r["class_name"], status=r["status"], admissionDate=r["admitted"])

    @staticmethod
    def public_user(r: sqlite3.Row) -> dict:
        return dict(id=r["id"], fullName=r["name"], email=r["email"], role=r["role"])

    @staticmethod
    def invoice(r: sqlite3.Row) -> dict:
        balance = round(r["amount"] - r["paid"], 2)
        return dict(id=r["id"], studentId=r["student_id"], admissionNumber=r["admission"], firstName=r["first_name"], lastName=r["last_name"], description=r["description"], term=r["term"], academicYear=r["year"], amount=r["amount"], dueDate=r["due_date"], amountPaid=r["paid"], balance=balance, status="paid" if balance <= 0 else "partial" if r["paid"] else "unpaid")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if path == "/api/auth/login":
                with connect() as db:
                    user = db.execute("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", (str(data.get("email", "")),)).fetchone()
                if not user or not password_matches(str(data.get("password", "")), user["password"]):
                    self.send_json({"error": "Email or password is incorrect."}, 401); return
                token = secrets.token_urlsafe(32); SESSIONS[token] = user["id"]
                self.send_json({"token": token, "user": self.public_user(user)}); return
            user = self.authorized()
            if not user: return
            with connect() as db:
                if path == "/api/auth/change-password":
                    current = str(data.get("currentPassword", "")); new = str(data.get("newPassword", ""))
                    row = db.execute("SELECT password FROM users WHERE id=?", (user["id"],)).fetchone()
                    if not password_matches(current, row["password"]): raise ValueError("Current password is incorrect.")
                    if len(new) < 14 or not any(c.isupper() for c in new) or not any(c.islower() for c in new) or not any(c.isdigit() for c in new):
                        raise ValueError("Use 14 or more characters with uppercase and lowercase letters and a number.")
                    db.execute("UPDATE users SET password=? WHERE id=?", (hash_password(new), user["id"]))
                    self.send_json({"ok": True})
                elif path == "/api/students":
                    self.require_role(user, ("admin", "registrar"))
                    cur = db.execute("INSERT INTO students(admission,first_name,last_name,guardian,phone,class_id) VALUES(?,?,?,?,?,?)", (self.required(data,"admissionNumber",40), self.required(data,"firstName",100), self.required(data,"lastName",100), str(data.get("guardianName", ""))[:160], str(data.get("guardianPhone", ""))[:40], data.get("classId") or None))
                    self.send_json({"id": cur.lastrowid}, 201)
                elif path == "/api/staff":
                    self.require_role(user, ("admin",))
                    password = self.required(data,"password",200)
                    if len(password) < 10: raise ValueError("Use a password with at least 10 characters.")
                    role = data.get("role", "teacher")
                    if role not in ("admin","headteacher","registrar","teacher"): raise ValueError("Choose a valid staff role.")
                    cur = db.execute("INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)", (self.required(data,"fullName",160),self.required(data,"email",254).lower(),hash_password(password),role))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/classes":
                    self.require_role(user,("admin","headteacher","registrar"))
                    cur=db.execute("INSERT INTO classes(name,grade,stream,year) VALUES(?,?,?,?)",(self.required(data,"name",80),self.required(data,"gradeLevel",30),str(data.get("stream") or "A")[:30],int(data["academicYear"])))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/subjects":
                    self.require_role(user,("admin","headteacher"))
                    cur=db.execute("INSERT INTO subjects(code,name) VALUES(?,?)",(self.required(data,"code",30),self.required(data,"name",100)))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/attendance":
                    self.require_role(user,("admin","headteacher","registrar","teacher"))
                    day=self.required(data,"date",10); date.fromisoformat(day)
                    records=data.get("records",[])
                    if not records or len(records)>500: raise ValueError("Select at least one learner.")
                    for row in records:
                        if row.get("status") not in ("present","absent","late","excused"): raise ValueError("Choose a valid attendance status.")
                        db.execute("INSERT INTO attendance(student_id,day,status) VALUES(?,?,?) ON CONFLICT(student_id,day) DO UPDATE SET status=excluded.status",(int(row["studentId"]),day,row["status"]))
                    self.send_json({"saved":len(records)})
                elif path == "/api/marks":
                    self.require_role(user,("admin","headteacher","teacher"))
                    score, maximum = float(data["score"]), float(data["maximumScore"])
                    if score<0 or maximum<=0 or score>maximum: raise ValueError("Score must be between zero and the maximum.")
                    cur=db.execute("INSERT INTO marks(student_id,subject_id,assessment,term,year,score,maximum) VALUES(?,?,?,?,?,?,?)",(int(data["studentId"]),int(data["subjectId"]),self.required(data,"assessmentName",100),self.required(data,"term",30),int(data["academicYear"]),score,maximum))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/fees":
                    self.require_role(user,("admin","headteacher","registrar"))
                    cur=db.execute("INSERT INTO invoices(student_id,description,term,year,amount,due_date) VALUES(?,?,?,?,?,?)",(int(data["studentId"]),self.required(data,"description",180),self.required(data,"term",30),int(data["academicYear"]),float(data["amount"]),str(data.get("dueDate", ""))[:10]))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/announcements":
                    self.require_role(user,("admin","headteacher","registrar"))
                    cur=db.execute("INSERT INTO announcements(title,body) VALUES(?,?)",(self.required(data,"title",180),self.required(data,"body",10000)))
                    self.send_json({"id":cur.lastrowid},201)
                elif path == "/api/events":
                    self.require_role(user,("admin","headteacher","registrar"))
                    cur=db.execute("INSERT INTO events(title,description,starts_at,ends_at) VALUES(?,?,?,?)",(self.required(data,"title",180),str(data.get("description", ""))[:5000],self.required(data,"startsAt",40),str(data.get("endsAt", ""))[:40]))
                    self.send_json({"id":cur.lastrowid},201)
                elif path.startswith("/api/fees/") and path.endswith("/payments"):
                    self.require_role(user,("admin","headteacher","registrar"))
                    db.execute("BEGIN IMMEDIATE")
                    invoice_id=int(path.split("/")[3]); amount=float(data["amount"]); method=data.get("method","cash")
                    if amount<=0 or method not in ("cash","bank transfer","mobile money","card"): raise ValueError("Enter a valid payment amount and method.")
                    inv=db.execute("SELECT amount FROM invoices WHERE id=?",(invoice_id,)).fetchone()
                    paid=db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=?",(invoice_id,)).fetchone()[0]
                    if not inv: self.send_json({"error":"Invoice not found."},404); return
                    if amount>inv["amount"]-paid+0.0001: raise ValueError("Payment is greater than the remaining balance.")
                    cur=db.execute("INSERT INTO payments(invoice_id,amount,method,reference) VALUES(?,?,?,?)",(invoice_id,amount,method,str(data.get("reference",""))[:100]))
                    self.send_json({"id":cur.lastrowid},201)
                else:
                    self.send_json({"error":"Page not found."},404)
        except PermissionError as exc:
            self.send_json({"error": str(exc)}, 403)
        except (ValueError, KeyError, TypeError, sqlite3.Error) as exc:
            message = "That record already exists." if isinstance(exc, sqlite3.IntegrityError) and "UNIQUE" in str(exc) else str(exc)
            self.send_json({"error":message or "Check the information and try again."},400)

    def do_PATCH(self) -> None:
        path=urlparse(self.path).path
        user=self.authorized()
        if not user: return
        try:
            data=self.read_json()
            with connect() as db:
                if path.startswith("/api/staff/"):
                    self.require_role(user,("admin",)); uid=int(path.rsplit("/",1)[-1]); active=int(bool(data.get("isActive")))
                    if uid==user["id"] and not active: raise ValueError("You cannot deactivate your own account.")
                    db.execute("UPDATE users SET active=? WHERE id=?",(active,uid)); self.send_json({"ok":True})
                elif path.startswith("/api/announcements/"):
                    self.require_role(user,("admin","headteacher","registrar")); aid=int(path.rsplit("/",1)[-1])
                    cur=db.execute("UPDATE announcements SET published=? WHERE id=?",(int(bool(data.get("published"))),aid))
                    if cur.rowcount==0: self.send_json({"error":"Announcement not found."},404)
                    else: self.send_json({"ok":True})
                elif path.startswith("/api/students/"):
                    self.require_role(user,("admin","registrar")); sid=int(path.rsplit("/",1)[-1])
                    allowed={"admissionNumber":"admission","firstName":"first_name","lastName":"last_name","guardianName":"guardian","guardianPhone":"phone","classId":"class_id"}
                    fields=[(col,data[key]) for key,col in allowed.items() if key in data]
                    if not fields: raise ValueError("No learner details to update.")
                    db.execute("UPDATE students SET "+", ".join(f"{col}=?" for col,_ in fields)+" WHERE id=?",[v for _,v in fields]+[sid]); self.send_json({"ok":True})
                else: self.send_json({"error":"Page not found."},404)
        except PermissionError as exc: self.send_json({"error":str(exc)},403)
        except (ValueError,TypeError,sqlite3.Error) as exc: self.send_json({"error":str(exc)},400)

    def do_DELETE(self) -> None:
        path=urlparse(self.path).path
        if not path.startswith("/api/students/"):
            self.send_json({"error":"Page not found."},404); return
        user=self.authorized(("admin","registrar"))
        if not user: return
        try:
            sid=int(path.rsplit("/",1)[-1])
            with connect() as db: db.execute("UPDATE students SET status='archived' WHERE id=?",(sid,))
            self.send_json({"ok":True})
        except (ValueError,sqlite3.Error) as exc: self.send_json({"error":str(exc)},400)

    @staticmethod
    def required(data: dict, key: str, limit: int) -> str:
        value=str(data.get(key," ")).strip()
        if not value or value==" ": raise ValueError(f"{key} is required.")
        return value[:limit]

    def require_role(self, user: sqlite3.Row, roles: tuple[str,...]) -> None:
        if user["role"] not in roles: raise PermissionError("Your account cannot perform this action.")


def main() -> None:
    initialize()
    if "--check" in sys.argv:
        print(f"Database ready: {DB_PATH}")
        return
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("School Management System is ready.")
    print(f"Website: http://127.0.0.1:{PORT}")
    print(f"First sign-in: {INITIAL_EMAIL} / {INITIAL_PASSWORD}")
    print("Keep this terminal open while using the website. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping School Management System.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
