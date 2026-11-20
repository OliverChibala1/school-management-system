import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, allowRoles, type AuthRequest } from './auth.js';
import { canViewDashboardFees } from './dashboard.js';
import { teacherScopeId } from './teacherAccess.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const staffOnly = allowRoles('admin', 'headteacher', 'registrar', 'teacher');
const staffAndParents = allowRoles('admin', 'headteacher', 'registrar', 'teacher', 'parent');
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '200kb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  try {
    const result = await pool.query('SELECT id, full_name, email, password_hash, role FROM app_users WHERE LOWER(email)=LOWER($1) AND is_active=TRUE', [parsed.data.email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) return res.status(500).json({ error: 'Server authentication is not configured securely.' });
    const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'] });
    await pool.query('UPDATE app_users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    await pool.query('INSERT INTO audit_logs(actor_id, action, entity_type, entity_id) VALUES($1,$2,$3,$4)', [user.id, 'LOGIN', 'app_user', user.id]);
    res.json({ token, user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Unable to sign in right now.' }); }
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }));

const defaultSettings = {
  schoolName: 'School Management System',
  schoolShortName: 'SMS',
  theme: 'forest',
  mode: 'light',
  accentColor: '#21644f',
  logoUrl: ''
} as const;

app.post('/api/auth/parent/register', async (req, res) => {
  const schema = z.object({
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(200),
    phone: z.string().trim().min(3).max(40),
    relationship: z.string().trim().min(2).max(40).default('Parent')
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid parent name, email, phone, and password to open the parent portal.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Server authentication is not configured securely.' });
    }
    const parent = await client.query(
      'SELECT id FROM parents WHERE LOWER(email)=LOWER($1) AND LOWER(full_name)=LOWER($2) AND phone=$3',
      [parsed.data.email, parsed.data.fullName, parsed.data.phone]
    );
    if (!parent.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Ask the school to add your parent contact details before creating a portal account.' });
    }
    const existing = await client.query('SELECT id FROM app_users WHERE LOWER(email)=LOWER($1)', [parsed.data.email]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account already uses this email. Please sign in or contact the school.' });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await client.query(
      `INSERT INTO app_users(full_name, email, password_hash, role, is_active)
       VALUES($1, $2, $3, 'parent', TRUE)
       RETURNING id, full_name AS "fullName", email, role`,
      [parsed.data.fullName, parsed.data.email, passwordHash]
    );

    await client.query('COMMIT');

    const token = jwt.sign({ sub: user.rows[0].id, role: user.rows[0].role }, secret, { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'] });
    res.status(201).json({ token, user: { id: user.rows[0].id, fullName: user.rows[0].fullName, email: user.rows[0].email, role: user.rows[0].role } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not create the parent portal account.' });
  } finally {
    client.release();
  }
});

app.get('/api/settings', requireAuth, staffOnly, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT school_name AS "schoolName",
             school_short_name AS "schoolShortName",
             theme,
             mode,
             accent_color AS "accentColor",
             logo_url AS "logoUrl"
      FROM system_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (!result.rowCount) return res.json(defaultSettings);
    return res.json({ ...defaultSettings, ...result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load school settings.' });
  }
});

app.put('/api/settings', requireAuth, allowRoles('admin', 'headteacher', 'registrar'), async (req: AuthRequest, res) => {
  const schema = z.object({
    schoolName: z.string().trim().min(2).max(120).optional(),
    schoolShortName: z.string().trim().min(2).max(40).optional(),
    theme: z.enum(['forest', 'ocean', 'royal', 'terracotta', 'lagoon', 'midnight']).optional(),
    mode: z.enum(['light', 'dark']).optional(),
    accentColor: z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    logoUrl: z.string().trim().max(500).optional().nullable()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'One or more theme or school settings are invalid.' });

  try {
    const current = await pool.query('SELECT id FROM system_settings LIMIT 1');
    const values = {
      schoolName: parsed.data.schoolName ?? defaultSettings.schoolName,
      schoolShortName: parsed.data.schoolShortName ?? defaultSettings.schoolShortName,
      theme: parsed.data.theme ?? defaultSettings.theme,
      mode: parsed.data.mode ?? defaultSettings.mode,
      accentColor: parsed.data.accentColor ?? defaultSettings.accentColor,
      logoUrl: parsed.data.logoUrl ?? null
    };

    if (current.rowCount) {
      const result = await pool.query(`
        UPDATE system_settings
        SET school_name=$1,
            school_short_name=$2,
            theme=$3,
            mode=$4,
            accent_color=$5,
            logo_url=$6,
            updated_by=$7,
            updated_at=NOW()
        WHERE id=$8
        RETURNING school_name AS "schoolName",
                  school_short_name AS "schoolShortName",
                  theme,
                  mode,
                  accent_color AS "accentColor",
                  logo_url AS "logoUrl"
      `, [values.schoolName, values.schoolShortName, values.theme, values.mode, values.accentColor, values.logoUrl, req.user!.id, current.rows[0].id]);
      return res.json({ ...defaultSettings, ...result.rows[0] });
    }

    const result = await pool.query(`
      INSERT INTO system_settings(school_name, school_short_name, theme, mode, accent_color, logo_url, updated_by)
      VALUES($1, $2, $3, $4, $5, $6, $7)
      RETURNING school_name AS "schoolName",
                school_short_name AS "schoolShortName",
                theme,
                mode,
                accent_color AS "accentColor",
                logo_url AS "logoUrl"
    `, [values.schoolName, values.schoolShortName, values.theme, values.mode, values.accentColor, values.logoUrl, req.user!.id]);
    return res.json({ ...defaultSettings, ...result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not save school settings.' });
  }
});

app.get('/api/portal/summary', requireAuth, allowRoles('parent'), async (req: AuthRequest, res) => {
  try {
    const parentResult = await pool.query(
      'SELECT id, full_name AS "fullName", email, phone, relationship FROM parents WHERE LOWER(email)=LOWER($1)',
      [req.user!.email]
    );

    if (!parentResult.rowCount) {
      return res.status(403).json({ error: 'This parent account is not linked to a student profile.' });
    }

    const parent = parentResult.rows[0];
    const children = await pool.query(`
      SELECT s.id,
             s.admission_number AS "admissionNumber",
             s.first_name AS "firstName",
             s.last_name AS "lastName",
             s.date_of_birth AS "dateOfBirth",
             s.gender,
             c.name AS "className",
             s.status,
             COALESCE((SELECT ROUND(AVG(m.score / NULLIF(m.maximum_score, 0) * 100)::numeric, 1) FROM marks m WHERE m.student_id=s.id), 0) AS "averageScore",
             COALESCE((SELECT COUNT(*) FROM attendance_records ar WHERE ar.student_id=s.id AND ar.status='present' AND ar.attendance_date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS "presentDays",
             COALESCE((SELECT COUNT(*) FROM attendance_records ar WHERE ar.student_id=s.id AND ar.status='absent' AND ar.attendance_date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS "absentDays",
             COALESCE((SELECT COUNT(*) FROM attendance_records ar WHERE ar.student_id=s.id AND ar.status='late' AND ar.attendance_date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS "lateDays",
             COALESCE((SELECT SUM(balance) FROM (
               SELECT i.amount - COALESCE(SUM(p.amount), 0) AS balance
               FROM fee_invoices i
               LEFT JOIN fee_payments p ON p.invoice_id=i.id
               WHERE i.student_id=s.id
               GROUP BY i.id
             ) invoice_balances), 0) AS "feeBalance"
      FROM student_parents sp
      JOIN students s ON s.id = sp.student_id
      LEFT JOIN school_classes c ON c.id = s.class_id
      WHERE sp.parent_id = $1
      ORDER BY s.last_name, s.first_name
    `, [parent.id]);

    const announcements = await pool.query('SELECT id, title, body, published_at AS "publishedAt" FROM announcements WHERE published = TRUE ORDER BY published_at DESC LIMIT 6');
    const upcomingEvents = await pool.query('SELECT id, title, description, starts_at AS "startsAt" FROM school_events WHERE starts_at >= NOW() ORDER BY starts_at LIMIT 6');

    return res.json({
      parent,
      children: children.rows,
      announcements: announcements.rows,
      upcomingEvents: upcomingEvents.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load your parent portal summary.' });
  }
});

app.get('/api/dashboard/summary', requireAuth, staffOnly, async (req: AuthRequest, res) => {
  try {
    const teacherId = teacherScopeId(req.user!.role, req.user!.id);
    const [students, staff, classes, guardians, today, nextEvent, fees] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM students s WHERE s.status='active' AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$1))", [teacherId]),
      pool.query("SELECT COUNT(*)::int AS count FROM app_users WHERE is_active=TRUE AND role::text NOT IN ('parent','student')"),
      pool.query('SELECT COUNT(*)::int AS count FROM school_classes c WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=c.id AND cs.teacher_id=$1))', [teacherId]),
      pool.query("SELECT COUNT(DISTINCT sp.parent_id)::int AS count FROM student_parents sp JOIN students s ON s.id=sp.student_id WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$1))", [teacherId]),
      pool.query("SELECT COUNT(*) FILTER (WHERE ar.status='present')::int AS present, COUNT(*) FILTER (WHERE ar.status='absent')::int AS absent, COUNT(*)::int AS recorded FROM attendance_records ar JOIN students s ON s.id=ar.student_id WHERE ar.attendance_date=CURRENT_DATE AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$1))", [teacherId]),
      pool.query('SELECT id,title,starts_at AS "startsAt" FROM school_events WHERE starts_at >= NOW() ORDER BY starts_at LIMIT 1'),
      canViewDashboardFees(req.user!.role)
        ? pool.query('SELECT COALESCE(SUM(balance),0) AS outstanding FROM (SELECT i.amount-COALESCE(SUM(p.amount),0) AS balance FROM fee_invoices i LEFT JOIN fee_payments p ON p.invoice_id=i.id GROUP BY i.id) totals')
        : Promise.resolve({ rows: [{ outstanding: null }] })
    ]);
    res.json({
      students: students.rows[0].count,
      staff: staff.rows[0].count,
      classes: classes.rows[0].count,
      guardians: guardians.rows[0].count,
      attendance: today.rows[0],
      nextEvent: nextEvent.rows[0] || null,
      feesOutstanding: fees.rows[0].outstanding
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load dashboard summary.' }); }
});

const studentSchema = z.object({
  admissionNumber: z.string().trim().min(1).max(40), firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100), otherNames: z.string().trim().max(100).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(), gender: z.string().trim().max(30).optional().nullable(),
  guardianName: z.string().trim().max(160).optional().nullable(), guardianPhone: z.string().trim().max(40).optional().nullable(),
  guardianEmail: z.union([z.string().email().max(254), z.literal('')]).optional().nullable(), classId: z.string().uuid().optional().nullable()
});
const studentFields = `s.id, s.admission_number AS "admissionNumber", s.first_name AS "firstName", s.last_name AS "lastName", s.other_names AS "otherNames", s.date_of_birth AS "dateOfBirth", s.gender, s.guardian_name AS "guardianName", s.guardian_phone AS "guardianPhone", s.guardian_email AS "guardianEmail", s.class_id AS "classId", c.name AS "className", s.admission_date AS "admissionDate", s.status, s.created_at AS "createdAt"`;

app.get('/api/students', requireAuth, staffOnly, async (req: AuthRequest, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const status = String(req.query.status || 'active');
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const teacherId = teacherScopeId(req.user!.role, req.user!.id);
  try {
    const result = await pool.query(`SELECT ${studentFields} FROM students s LEFT JOIN school_classes c ON c.id=s.class_id WHERE ($1='' OR s.status::text=$1) AND ($2='' OR s.admission_number ILIKE '%'||$2||'%' OR s.first_name ILIKE '%'||$2||'%' OR s.last_name ILIKE '%'||$2||'%') AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$5)) ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`, [status === 'all' ? '' : status, q, limit, offset, teacherId]);
    res.json({ students: result.rows, limit, offset });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load students.' }); }
});

app.post('/api/students', requireAuth, allowRoles('admin', 'registrar'), async (req: AuthRequest, res) => {
  const parsed = studentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the student details and try again.', details: parsed.error.flatten().fieldErrors });
  const s = parsed.data;
  try {
    const result = await pool.query(`INSERT INTO students(admission_number, first_name, last_name, other_names, date_of_birth, gender, guardian_name, guardian_phone, guardian_email, class_id, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, admission_number AS "admissionNumber", first_name AS "firstName", last_name AS "lastName", status, admission_date AS "admissionDate"`, [s.admissionNumber, s.firstName, s.lastName, s.otherNames || null, s.dateOfBirth || null, s.gender || null, s.guardianName || null, s.guardianPhone || null, s.guardianEmail || null, s.classId || null, req.user!.id]);
    await pool.query('INSERT INTO audit_logs(actor_id, action, entity_type, entity_id) VALUES($1,$2,$3,$4)', [req.user!.id, 'CREATE', 'student', result.rows[0].id]);
    res.status(201).json({ student: result.rows[0] });
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'That admission number is already in use.' });
    if (err.code === '23503') return res.status(400).json({ error: 'The selected class does not exist.' });
    console.error(err); res.status(500).json({ error: 'Could not create student.' });
  }
});

app.get('/api/students/:id', requireAuth, staffOnly, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`SELECT ${studentFields} FROM students s LEFT JOIN school_classes c ON c.id=s.class_id WHERE s.id=$1 AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$2))`, [req.params.id, teacherScopeId(req.user!.role, req.user!.id)]);
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found.' });
    res.json({ student: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load student.' }); }
});

app.patch('/api/students/:id', requireAuth, allowRoles('admin', 'registrar'), async (req: AuthRequest, res) => {
  const parsed = studentSchema.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(req.body || {}).length === 0) return res.status(400).json({ error: 'Provide valid student fields to update.' });
  const mapping: Record<string, string> = { admissionNumber: 'admission_number', firstName: 'first_name', lastName: 'last_name', otherNames: 'other_names', dateOfBirth: 'date_of_birth', gender: 'gender', guardianName: 'guardian_name', guardianPhone: 'guardian_phone', guardianEmail: 'guardian_email', classId: 'class_id' };
  const entries = Object.entries(parsed.data).filter(([key]) => mapping[key]);
  if (!entries.length) return res.status(400).json({ error: 'No editable fields provided.' });
  try {
    const values: unknown[] = entries.map(([, value]) => value || null);
    const setSql = entries.map(([key], i) => `${mapping[key]}=$${i + 1}`).join(', ');
    values.push(req.params.id);
    const result = await pool.query(`UPDATE students SET ${setSql}, updated_at=NOW() WHERE id=$${values.length} AND status <> 'archived' RETURNING id, admission_number AS "admissionNumber", first_name AS "firstName", last_name AS "lastName", status`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found or archived.' });
    await pool.query('INSERT INTO audit_logs(actor_id, action, entity_type, entity_id) VALUES($1,$2,$3,$4)', [req.user!.id, 'UPDATE', 'student', req.params.id]);
    res.json({ student: result.rows[0] });
  } catch (err: any) { if (err.code === '23505') return res.status(409).json({ error: 'That admission number is already in use.' }); console.error(err); res.status(500).json({ error: 'Could not update student.' }); }
});

app.delete('/api/students/:id', requireAuth, allowRoles('admin', 'registrar'), async (req: AuthRequest, res) => {
  try {
    const result = await pool.query("UPDATE students SET status='archived', updated_at=NOW() WHERE id=$1 AND status <> 'archived' RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found or already archived.' });
    await pool.query('INSERT INTO audit_logs(actor_id, action, entity_type, entity_id) VALUES($1,$2,$3,$4)', [req.user!.id, 'ARCHIVE', 'student', req.params.id]);
    res.json({ message: 'Student archived.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not archive student.' }); }
});

// Staff administration. Passwords are hashed before they reach the database.
app.get('/api/staff', requireAuth, allowRoles('admin','headteacher'), async (_req, res) => {
  try { const r = await pool.query("SELECT id, full_name AS \"fullName\", email, role, is_active AS \"isActive\", created_at AS \"createdAt\" FROM app_users WHERE role::text NOT IN ('parent','student') ORDER BY full_name"); res.json({ staff: r.rows }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not load staff.' }); }
});

const schoolRoles = ['admin', 'headteacher', 'registrar', 'teacher'];

async function teacherCanAccessParent(teacherId: string, parentUserId: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1
    FROM app_users parent_user
    JOIN parents p ON LOWER(p.email)=LOWER(parent_user.email)
    JOIN student_parents sp ON sp.parent_id=p.id
    JOIN students s ON s.id=sp.student_id
    JOIN class_subjects cs ON cs.class_id=s.class_id
    WHERE parent_user.id=$1 AND parent_user.role='parent' AND cs.teacher_id=$2
    LIMIT 1
  `, [parentUserId, teacherId]);
  return Boolean(result.rowCount);
}

app.get('/api/messages/contacts', requireAuth, async (req: AuthRequest, res) => {
  const allowedRoles = req.user?.role === 'parent' ? schoolRoles : [...schoolRoles, 'parent'];
  try {
    const result = await pool.query(`
      SELECT u.id,
             u.full_name AS "fullName",
             u.email,
             u.role,
             latest.body AS "lastMessage",
             latest.created_at AS "lastMessageAt",
             (SELECT COUNT(*)::int
              FROM direct_messages unread
              WHERE unread.sender_id=u.id
                AND unread.recipient_id=$1
                AND unread.read_at IS NULL) AS "unreadCount"
      FROM app_users u
      LEFT JOIN LATERAL (
        SELECT body, created_at
        FROM direct_messages m
        WHERE (m.sender_id=u.id AND m.recipient_id=$1)
           OR (m.sender_id=$1 AND m.recipient_id=u.id)
        ORDER BY created_at DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE u.id<>$1
        AND u.is_active=TRUE
        AND u.role::text=ANY($2::text[])
        AND (u.role::text<>'parent' OR $3::text<>'teacher' OR EXISTS (
          SELECT 1 FROM parents p
          JOIN student_parents sp ON sp.parent_id=p.id
          JOIN students s ON s.id=sp.student_id
          JOIN class_subjects cs ON cs.class_id=s.class_id
          WHERE LOWER(p.email)=LOWER(u.email) AND cs.teacher_id=$1
        ))
      ORDER BY latest.created_at DESC NULLS LAST, u.full_name
    `, [req.user!.id, allowedRoles, req.user!.role]);
    res.json({ contacts: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load message contacts.' });
  }
});

app.get('/api/messages/:contactId', requireAuth, async (req: AuthRequest, res) => {
  const contactId = z.string().uuid().safeParse(req.params.contactId);
  if (!contactId.success) return res.status(400).json({ error: 'Choose a valid contact.' });
  try {
    const contact = await pool.query(
      'SELECT id, full_name AS "fullName", role FROM app_users WHERE id=$1 AND is_active=TRUE',
      [contactId.data]
    );
    if (!contact.rowCount) return res.status(404).json({ error: 'Contact not found.' });
    const permitted = req.user?.role === 'parent'
      ? schoolRoles.includes(contact.rows[0].role)
      : [...schoolRoles, 'parent'].includes(contact.rows[0].role);
    if (!permitted) return res.status(403).json({ error: 'You cannot message this account.' });
    if (req.user?.role === 'teacher' && contact.rows[0].role === 'parent' && !(await teacherCanAccessParent(req.user.id, contactId.data))) return res.status(403).json({ error: 'You can only message guardians linked to your assigned classes.' });

    await pool.query(
      'UPDATE direct_messages SET read_at=NOW() WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL',
      [contactId.data, req.user!.id]
    );
    const messages = await pool.query(`
      SELECT id,
             sender_id AS "senderId",
             recipient_id AS "recipientId",
             body,
             created_at AS "createdAt",
             read_at AS "readAt"
      FROM direct_messages
      WHERE (sender_id=$1 AND recipient_id=$2)
         OR (sender_id=$2 AND recipient_id=$1)
      ORDER BY created_at DESC
      LIMIT 200
    `, [req.user!.id, contactId.data]);
    res.json({ contact: contact.rows[0], messages: messages.rows.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load this conversation.' });
  }
});

app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  const parsed = z.object({
    recipientId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a contact and enter a message of up to 4,000 characters.' });

  try {
    const recipient = await pool.query(
      'SELECT id, role FROM app_users WHERE id=$1 AND is_active=TRUE',
      [parsed.data.recipientId]
    );
    if (!recipient.rowCount) return res.status(404).json({ error: 'Contact not found.' });
    const permitted = req.user?.role === 'parent'
      ? schoolRoles.includes(recipient.rows[0].role)
      : [...schoolRoles, 'parent'].includes(recipient.rows[0].role);
    if (!permitted) return res.status(403).json({ error: 'You cannot message this account.' });
    if (req.user?.role === 'teacher' && recipient.rows[0].role === 'parent' && !(await teacherCanAccessParent(req.user.id, parsed.data.recipientId))) return res.status(403).json({ error: 'You can only message guardians linked to your assigned classes.' });

    const result = await pool.query(`
      INSERT INTO direct_messages(sender_id, recipient_id, body)
      VALUES($1, $2, $3)
      RETURNING id, sender_id AS "senderId", recipient_id AS "recipientId", body, created_at AS "createdAt", read_at AS "readAt"
    `, [req.user!.id, parsed.data.recipientId, parsed.data.body]);
    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send this message.' });
  }
});

app.post('/api/staff', requireAuth, allowRoles('admin'), async (req: AuthRequest, res) => {
  const p = z.object({ fullName: z.string().trim().min(2).max(160), email: z.string().email().max(254), role: z.enum(['admin','headteacher','registrar','teacher']), password: z.string().min(10).max(200) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a name, valid email, role, and password of at least 10 characters.' });
  try { const hash = await bcrypt.hash(p.data.password, 12); const r = await pool.query('INSERT INTO app_users(full_name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,full_name AS "fullName",email,role,is_active AS "isActive"', [p.data.fullName,p.data.email,hash,p.data.role]); res.status(201).json({ staff: r.rows[0] }); }
  catch (err: any) { if (err.code === '23505') return res.status(409).json({ error: 'That email is already in use.' }); console.error(err); res.status(500).json({ error: 'Could not create staff account.' }); }
});
app.patch('/api/staff/:id', requireAuth, allowRoles('admin'), async (req, res) => {
  const p = z.object({ isActive: z.boolean() }).safeParse(req.body); if (!p.success) return res.status(400).json({ error: 'Choose whether the account should be active.' });
  if (req.params.id === (req as AuthRequest).user?.id && !p.data.isActive) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  try { const r = await pool.query('UPDATE app_users SET is_active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,full_name AS "fullName",email,role,is_active AS "isActive"', [p.data.isActive,req.params.id]); if (!r.rowCount) return res.status(404).json({ error: 'Staff account not found.' }); res.json({ staff:r.rows[0] }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not update staff account.' }); }
});

// Parent contacts can be linked to multiple learners and are stored independently.
app.get('/api/parents', requireAuth, allowRoles('admin', 'headteacher', 'registrar'), async (_req, res) => {
  try {
    const result = await pool.query(`SELECT p.id,p.full_name AS "fullName",p.phone,p.email,p.relationship,COALESCE(json_agg(json_build_object('id',s.id,'name',s.first_name||' '||s.last_name,'admissionNumber',s.admission_number)) FILTER (WHERE s.id IS NOT NULL),'[]') AS children FROM parents p LEFT JOIN student_parents sp ON sp.parent_id=p.id LEFT JOIN students s ON s.id=sp.student_id GROUP BY p.id ORDER BY p.full_name`);
    res.json({ parents: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load parent records.' }); }
});
app.post('/api/parents', requireAuth, allowRoles('admin','headteacher','registrar'), async (req, res) => {
  const parsed = z.object({ fullName:z.string().trim().min(2).max(160), phone:z.string().trim().min(3).max(40), email:z.union([z.string().email().max(254),z.literal('')]).optional(), relationship:z.string().trim().min(2).max(40), studentIds:z.array(z.string().uuid()).min(1).max(20), password:z.string().min(8).max(200).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a parent name, phone, relationship, and link at least one learner.' });
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const parent=await client.query('INSERT INTO parents(full_name,phone,email,relationship) VALUES($1,$2,$3,$4) ON CONFLICT (email) WHERE email IS NOT NULL DO UPDATE SET full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, relationship=EXCLUDED.relationship RETURNING id,full_name AS "fullName",phone,email,relationship',[parsed.data.fullName,parsed.data.phone,parsed.data.email||null,parsed.data.relationship]);
    for (const studentId of parsed.data.studentIds) await client.query('INSERT INTO student_parents(student_id,parent_id) VALUES($1,$2) ON CONFLICT (student_id,parent_id) DO NOTHING',[studentId,parent.rows[0].id]);
    if (parsed.data.email && parsed.data.password) {
      const hash = await bcrypt.hash(parsed.data.password, 12);
      await client.query(
        `INSERT INTO app_users(full_name, email, password_hash, role, is_active)
         VALUES($1, $2, $3, 'parent', TRUE)
         ON CONFLICT (email) DO NOTHING`,
        [parsed.data.fullName, parsed.data.email, hash]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ parent:parent.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(400).json({ error:'Could not save parent. Check that the selected learner records exist.' }); } finally { client.release(); }
});

app.get('/api/classes', requireAuth, staffOnly, async (req: AuthRequest,res) => { try { const r=await pool.query(`SELECT c.id,c.name,c.grade_level AS "gradeLevel",c.stream,c.academic_year AS "academicYear",COUNT(s.id)::int AS "studentCount" FROM school_classes c LEFT JOIN students s ON s.class_id=c.id AND s.status='active' WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=c.id AND cs.teacher_id=$1)) GROUP BY c.id ORDER BY c.academic_year DESC,c.grade_level,c.stream`, [teacherScopeId(req.user!.role, req.user!.id)]); res.json({classes:r.rows}); } catch(e){console.error(e);res.status(500).json({error:'Could not load classes.'});} });
app.post('/api/classes', requireAuth, allowRoles('admin','headteacher','registrar'), async (req,res) => { const p=z.object({name:z.string().trim().min(1).max(80),gradeLevel:z.string().trim().min(1).max(30),stream:z.string().trim().min(1).max(30).default('A'),academicYear:z.number().int().min(2000).max(2200)}).safeParse(req.body); if(!p.success)return res.status(400).json({error:'Enter class name, grade, stream and academic year.'}); try{const r=await pool.query('INSERT INTO school_classes(name,grade_level,stream,academic_year) VALUES($1,$2,$3,$4) RETURNING id,name,grade_level AS "gradeLevel",stream,academic_year AS "academicYear"',[p.data.name,p.data.gradeLevel,p.data.stream,p.data.academicYear]);res.status(201).json({class:r.rows[0]});}catch(e:any){if(e.code==='23505')return res.status(409).json({error:'This class already exists for that year.'});console.error(e);res.status(500).json({error:'Could not create class.'});} });
app.get('/api/subjects', requireAuth, staffOnly, async (req: AuthRequest,res) => {try{const r=await pool.query('SELECT s.id,s.code,s.name,s.is_active AS "isActive" FROM subjects s WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.subject_id=s.id AND cs.teacher_id=$1)) ORDER BY s.name', [teacherScopeId(req.user!.role, req.user!.id)]);res.json({subjects:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load subjects.'});}});
app.post('/api/subjects', requireAuth, allowRoles('admin','headteacher'), async(req,res)=>{const p=z.object({code:z.string().trim().min(1).max(30),name:z.string().trim().min(1).max(100)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter a subject code and name.'});try{const r=await pool.query('INSERT INTO subjects(code,name) VALUES($1,$2) RETURNING id,code,name,is_active AS "isActive"',[p.data.code,p.data.name]);res.status(201).json({subject:r.rows[0]});}catch(e:any){if(e.code==='23505')return res.status(409).json({error:'That subject code is already in use.'});console.error(e);res.status(500).json({error:'Could not create subject.'});}});

app.get('/api/assignments', requireAuth, allowRoles('admin','headteacher'), async (_req,res)=>{try{const r=await pool.query(`SELECT cs.class_id AS "classId",c.name AS "className",cs.subject_id AS "subjectId",s.name AS "subjectName",cs.teacher_id AS "teacherId",u.full_name AS "teacherName" FROM class_subjects cs JOIN school_classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id LEFT JOIN app_users u ON u.id=cs.teacher_id WHERE cs.teacher_id IS NOT NULL ORDER BY c.academic_year DESC,c.name,s.name`);res.json({assignments:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load teacher assignments.'});}});
app.post('/api/assignments', requireAuth, allowRoles('admin','headteacher'), async(req,res)=>{const p=z.object({classId:z.string().uuid(),subjectId:z.string().uuid(),teacherId:z.string().uuid()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Select a class, subject, and teacher.'});try{const teacher=await pool.query("SELECT id FROM app_users WHERE id=$1 AND role='teacher' AND is_active=TRUE",[p.data.teacherId]);if(!teacher.rowCount)return res.status(400).json({error:'Select an active teacher account.'});const r=await pool.query(`INSERT INTO class_subjects(class_id,subject_id,teacher_id) VALUES($1,$2,$3) ON CONFLICT(class_id,subject_id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id RETURNING class_id AS "classId",subject_id AS "subjectId",teacher_id AS "teacherId"`,[p.data.classId,p.data.subjectId,p.data.teacherId]);res.status(201).json({assignment:r.rows[0]});}catch(e:any){if(e.code==='23503')return res.status(400).json({error:'Select an existing class, subject, and teacher.'});console.error(e);res.status(500).json({error:'Could not save teacher assignment.'});}});

app.get('/api/attendance', requireAuth, staffOnly, async(req: AuthRequest,res)=>{const date=String(req.query.date||new Date().toISOString().slice(0,10));const classId=String(req.query.classId||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'Use a valid date.'});try{const r=await pool.query(`SELECT s.id AS "studentId",s.admission_number AS "admissionNumber",s.first_name AS "firstName",s.last_name AS "lastName",c.name AS "className",a.status,a.note FROM students s LEFT JOIN school_classes c ON c.id=s.class_id LEFT JOIN attendance_records a ON a.student_id=s.id AND a.attendance_date=$1::date WHERE s.status='active' AND (NULLIF($2,'') IS NULL OR s.class_id=NULLIF($2,'')::uuid) AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$3)) ORDER BY c.name,s.last_name,s.first_name`,[date,classId,teacherScopeId(req.user!.role, req.user!.id)]);res.json({date,records:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load attendance register.'});}});
app.post('/api/attendance', requireAuth, allowRoles('admin','headteacher','registrar','teacher'), async(req:AuthRequest,res)=>{const p=z.object({date:z.string().date(),records:z.array(z.object({studentId:z.string().uuid(),status:z.enum(['present','absent','late','excused']),note:z.string().max(300).optional().default('')})).min(1).max(500)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Attendance entries are incomplete or invalid.'});if(new Set(p.data.records.map(record=>record.studentId)).size!==p.data.records.length)return res.status(400).json({error:'Each learner may appear only once in an attendance register.'});const teacherId=teacherScopeId(req.user!.role,req.user!.id);const client=await pool.connect();try{await client.query('BEGIN');if(teacherId){const assigned=await client.query(`SELECT COUNT(DISTINCT s.id)::int AS count FROM students s WHERE s.id=ANY($1::uuid[]) AND EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$2)`,[p.data.records.map(record=>record.studentId),teacherId]);if(assigned.rows[0].count!==p.data.records.length){await client.query('ROLLBACK');return res.status(403).json({error:'Attendance can only be recorded for learners in your assigned classes.'});}}for(const x of p.data.records)await client.query(`INSERT INTO attendance_records(student_id,attendance_date,status,note,recorded_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(student_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,recorded_by=EXCLUDED.recorded_by`,[x.studentId,p.data.date,x.status,x.note||null,req.user!.id]);await client.query('COMMIT');res.json({saved:p.data.records.length});}catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not save attendance.'});}finally{client.release();}});

app.get('/api/marks',requireAuth,staffOnly,async(req:AuthRequest,res)=>{try{const studentId=String(req.query.studentId||'');const teacherId=teacherScopeId(req.user!.role,req.user!.id);const r=await pool.query(`SELECT m.id,m.student_id AS "studentId",s.first_name AS "firstName",s.last_name AS "lastName",sub.name AS "subjectName",m.assessment_name AS "assessmentName",m.term,m.academic_year AS "academicYear",m.score,m.maximum_score AS "maximumScore",ROUND(m.score/m.maximum_score*100,1) AS percentage FROM marks m JOIN students s ON s.id=m.student_id JOIN subjects sub ON sub.id=m.subject_id WHERE ($1='' OR m.student_id=$1::uuid) AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.subject_id=m.subject_id AND cs.teacher_id=$2)) ORDER BY m.academic_year DESC,m.term,sub.name,s.last_name`,[studentId,teacherId]);res.json({marks:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load academic results.'});}});
app.post('/api/marks',requireAuth,allowRoles('admin','headteacher','teacher'),async(req:AuthRequest,res)=>{const p=z.object({studentId:z.string().uuid(),subjectId:z.string().uuid(),assessmentName:z.string().trim().min(1).max(100),term:z.string().trim().min(1).max(30),academicYear:z.number().int().min(2000).max(2200),score:z.number().min(0),maximumScore:z.number().positive()}).refine(x=>x.score<=x.maximumScore).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter valid result details. Score cannot exceed the maximum.'});try{if(req.user!.role==='teacher'){const assigned=await pool.query('SELECT 1 FROM students s JOIN class_subjects cs ON cs.class_id=s.class_id WHERE s.id=$1 AND cs.subject_id=$2 AND cs.teacher_id=$3',[p.data.studentId,p.data.subjectId,req.user!.id]);if(!assigned.rowCount)return res.status(403).json({error:'Marks can only be entered for your assigned classes and subjects.'});}const r=await pool.query('INSERT INTO marks(student_id,subject_id,assessment_name,term,academic_year,score,maximum_score,entered_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[p.data.studentId,p.data.subjectId,p.data.assessmentName,p.data.term,p.data.academicYear,p.data.score,p.data.maximumScore,req.user!.id]);res.status(201).json({id:r.rows[0].id});}catch(e){console.error(e);res.status(500).json({error:'Could not save result.'});}});

app.get('/api/events',requireAuth,staffAndParents,async(_req,res)=>{try{const r=await pool.query('SELECT id,title,description,starts_at AS "startsAt",ends_at AS "endsAt" FROM school_events ORDER BY starts_at');res.json({events:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load calendar.'});}});
app.post('/api/events',requireAuth,allowRoles('admin','headteacher','registrar'),async(req:AuthRequest,res)=>{const p=z.object({title:z.string().trim().min(1).max(180),description:z.string().max(5000).optional().default(''),startsAt:z.string().datetime(),endsAt:z.string().datetime().optional().nullable()}).refine(x=>!x.endsAt||x.endsAt>=x.startsAt).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter a valid event title and date range.'});try{const r=await pool.query('INSERT INTO school_events(title,description,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,title,description,starts_at AS "startsAt",ends_at AS "endsAt"',[p.data.title,p.data.description,p.data.startsAt,p.data.endsAt||null,req.user!.id]);res.status(201).json({event:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Could not create calendar event.'});}});

app.get('/api/fees',requireAuth,allowRoles('admin','headteacher','registrar'),async(req,res)=>{const studentId=String(req.query.studentId||'');try{const r=await pool.query(`SELECT i.id,i.student_id AS "studentId",s.admission_number AS "admissionNumber",s.first_name AS "firstName",s.last_name AS "lastName",i.description,i.term,i.academic_year AS "academicYear",i.amount,i.due_date AS "dueDate",COALESCE(SUM(p.amount),0) AS "amountPaid",i.amount-COALESCE(SUM(p.amount),0) AS balance,CASE WHEN COALESCE(SUM(p.amount),0)>=i.amount THEN 'paid' WHEN COALESCE(SUM(p.amount),0)>0 THEN 'partial' ELSE 'unpaid' END AS status FROM fee_invoices i JOIN students s ON s.id=i.student_id LEFT JOIN fee_payments p ON p.invoice_id=i.id WHERE ($1='' OR i.student_id=$1::uuid) GROUP BY i.id,s.id ORDER BY i.created_at DESC`,[studentId]);res.json({invoices:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load fee records.'});}});
app.post('/api/fees',requireAuth,allowRoles('admin','headteacher','registrar'),async(req:AuthRequest,res)=>{const p=z.object({studentId:z.string().uuid(),description:z.string().trim().min(1).max(180),term:z.string().trim().min(1).max(30),academicYear:z.number().int().min(2000).max(2200),amount:z.number().positive().max(100000000),dueDate:z.string().date().optional().nullable()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter valid fee details and a positive amount.'});try{const r=await pool.query('INSERT INTO fee_invoices(student_id,description,term,academic_year,amount,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[p.data.studentId,p.data.description,p.data.term,p.data.academicYear,p.data.amount,p.data.dueDate||null,req.user!.id]);res.status(201).json({id:r.rows[0].id});}catch(e){console.error(e);res.status(500).json({error:'Could not create fee invoice.'});}});
app.post('/api/fees/:id/payments',requireAuth,allowRoles('admin','headteacher','registrar'),async(req:AuthRequest,res)=>{const p=z.object({amount:z.number().positive().max(100000000),method:z.enum(['cash','bank transfer','mobile money','card']),reference:z.string().max(100).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter a positive payment amount and a valid payment method.'});const c=await pool.connect();try{await c.query('BEGIN');const inv=await c.query('SELECT id FROM fee_invoices WHERE id=$1 FOR UPDATE',[req.params.id]);if(!inv.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Fee invoice not found.'});}const balance=await c.query('SELECT i.amount-COALESCE(SUM(p.amount),0) AS balance FROM fee_invoices i LEFT JOIN fee_payments p ON p.invoice_id=i.id WHERE i.id=$1 GROUP BY i.id',[req.params.id]);if(Number(balance.rows[0].balance)+0.0001<p.data.amount){await c.query('ROLLBACK');return res.status(400).json({error:'Payment is greater than the remaining balance.'});}const r=await c.query('INSERT INTO fee_payments(invoice_id,amount,method,reference,received_by) VALUES($1,$2,$3,$4,$5) RETURNING id,received_at AS "receivedAt"',[req.params.id,p.data.amount,p.data.method,p.data.reference||null,req.user!.id]);await c.query('COMMIT');res.status(201).json({payment:r.rows[0]});}catch(e){await c.query('ROLLBACK');console.error(e);res.status(500).json({error:'Could not record payment.'});}finally{c.release();}});

app.get('/api/announcements',requireAuth,staffAndParents,async(req:AuthRequest,res)=>{try{const parentView=req.user!.role==='parent';const r=await pool.query('SELECT a.id,a.title,a.body,a.published,a.published_at AS "publishedAt",a.created_at AS "createdAt",u.full_name AS "createdBy" FROM announcements a LEFT JOIN app_users u ON u.id=a.created_by WHERE ($1::boolean=FALSE OR a.published=TRUE) ORDER BY a.created_at DESC',[parentView]);res.json({announcements:r.rows});}catch(e){console.error(e);res.status(500).json({error:'Could not load announcements.'});}});
app.post('/api/announcements',requireAuth,allowRoles('admin','headteacher','registrar'),async(req:AuthRequest,res)=>{const p=z.object({title:z.string().trim().min(1).max(180),body:z.string().trim().min(1).max(10000),published:z.boolean().default(false)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Enter an announcement title and message.'});try{const r=await pool.query('INSERT INTO announcements(title,body,published,published_at,created_by) VALUES($1,$2,$3,CASE WHEN $3 THEN NOW() END,$4) RETURNING id,title,body,published,published_at AS "publishedAt"',[p.data.title,p.data.body,p.data.published,req.user!.id]);res.status(201).json({announcement:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Could not create announcement.'});}});
app.patch('/api/announcements/:id',requireAuth,allowRoles('admin','headteacher','registrar'),async(req,res)=>{const p=z.object({published:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Choose whether to publish this announcement.'});try{const r=await pool.query('UPDATE announcements SET published=$1,published_at=CASE WHEN $1 THEN COALESCE(published_at,NOW()) ELSE NULL END WHERE id=$2 RETURNING id,title,body,published,published_at AS "publishedAt"',[p.data.published,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Announcement not found.'});res.json({announcement:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Could not update announcement.'});}});

app.get('/api/reports/students/:id',requireAuth,staffOnly,async(req:AuthRequest,res)=>{const term=String(req.query.term||'').slice(0,30);const year=Number(req.query.year||new Date().getFullYear());if(!Number.isInteger(year)||year<2000||year>2200)return res.status(400).json({error:'Enter a valid academic year.'});try{const teacherId=teacherScopeId(req.user!.role,req.user!.id);const student=await pool.query(`SELECT s.id,s.admission_number AS "admissionNumber",s.first_name AS "firstName",s.last_name AS "lastName",s.class_id AS "classId",c.name AS "className" FROM students s LEFT JOIN school_classes c ON c.id=s.class_id WHERE s.id=$1 AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=s.class_id AND cs.teacher_id=$2))`,[req.params.id,teacherId]);if(!student.rowCount)return res.status(404).json({error:'Student not found.'});const [marks,attendance]=await Promise.all([pool.query(`SELECT sub.name AS "subjectName",m.assessment_name AS "assessmentName",m.score,m.maximum_score AS "maximumScore",ROUND(m.score/m.maximum_score*100,1) AS percentage FROM marks m JOIN subjects sub ON sub.id=m.subject_id WHERE m.student_id=$1 AND m.academic_year=$2 AND ($3='' OR m.term=$3) AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=$5 AND cs.subject_id=m.subject_id AND cs.teacher_id=$4)) ORDER BY sub.name,m.assessment_name`,[req.params.id,year,term,teacherId,student.rows[0].classId]),pool.query(`SELECT COUNT(*)::int AS recorded,COUNT(*) FILTER(WHERE status='present')::int AS present,COUNT(*) FILTER(WHERE status='absent')::int AS absent,COUNT(*) FILTER(WHERE status='late')::int AS late FROM attendance_records WHERE student_id=$1 AND EXTRACT(YEAR FROM attendance_date)=$2`,[req.params.id,year])]);delete student.rows[0].classId;res.json({student:student.rows[0],term:term||null,academicYear:year,marks:marks.rows,attendance:attendance.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'Could not prepare student report.'});}});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err); res.status(500).json({ error: 'Unexpected server error.' });
});
async function startServer() {
  // Apply the additive parent-register migration automatically for existing databases.
  await pool.query(`
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'parent';
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'student';
    CREATE TABLE IF NOT EXISTS system_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_name VARCHAR(120) NOT NULL DEFAULT 'School Management System',
      school_short_name VARCHAR(40) NOT NULL DEFAULT 'SMS',
      theme VARCHAR(30) NOT NULL DEFAULT 'forest',
      mode VARCHAR(20) NOT NULL DEFAULT 'light',
      accent_color VARCHAR(20) NOT NULL DEFAULT '#21644f',
      logo_url TEXT,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS parents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      email VARCHAR(254),
      relationship VARCHAR(40) NOT NULL DEFAULT 'Parent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS parents_email_idx ON parents(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS student_parents (
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      PRIMARY KEY (student_id, parent_id)
    );
    CREATE INDEX IF NOT EXISTS student_parents_parent_idx ON student_parents(parent_id);
    CREATE TABLE IF NOT EXISTS direct_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      body VARCHAR(4000) NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (sender_id <> recipient_id)
    );
    CREATE INDEX IF NOT EXISTS direct_messages_thread_idx ON direct_messages(sender_id, recipient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS direct_messages_recipient_unread_idx ON direct_messages(recipient_id, read_at) WHERE read_at IS NULL;
  `);
  app.listen(port, () => console.log(`School Management System API listening on http://localhost:${port}`));
}

startServer().catch((err) => {
  console.error('Could not initialise the school database. Confirm PostgreSQL is running and the schema is installed.', err);
  process.exitCode = 1;
});
