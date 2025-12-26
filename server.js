const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const http = require("http");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- POSTGRES ----------------------

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false,
});

async function ensureProblemColumns() {
    try {
        await pool.query(`
      ALTER TABLE cleanings
        ADD COLUMN IF NOT EXISTS hasproblem boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS problemnote text,
        ADD COLUMN IF NOT EXISTS problemphoto text;
    `);
        console.log("✅ ensured problem columns");
    } catch (e) {
        console.error("❌ ensureProblemColumns error:", e.message);
    }
}
ensureProblemColumns();

async function initDB() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS cleanings (
      id SERIAL PRIMARY KEY,
      cleanerName TEXT,
      block TEXT,
      apartmentNumber TEXT,
      status TEXT,
      notes TEXT,
      cleaningDate TEXT,
      cleaningTime TEXT,
      tenantNotHome BOOLEAN,
      tenantSigned BOOLEAN,
      tenantSignature TEXT,
      cleaningRequest TEXT,
      photos JSONB,
      createdAt TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS shiftEnds (
      id SERIAL PRIMARY KEY,
      cleanerName TEXT,
      endedAt TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ---------------------- KLASÖRLER ----------------------

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ---------------------- MIDDLEWARE ----------------------

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/uploads", express.static(uploadsDir));

app.get("/", (req, res) => res.redirect("/login.html"));

// ---------------------- MULTER (FOTO) ------------------

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const name = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, name + path.extname(file.originalname));
    },
});
const upload = multer({ storage });

const uploadFields = upload.fields([
    { name: "photos", maxCount: 10 },
    { name: "problemPhoto", maxCount: 1 },
]);

// ---------------------- DB TEST ------------------------

app.get("/api/db-test", async (req, res) => {
    try {
        const r = await pool.query("SELECT NOW()");
        res.json({ ok: true, time: r.rows[0] });
    } catch (e) {
        console.error("DB TEST ERROR:", e);
        res.status(500).json({
            ok: false,
            error: e?.message || "unknown db error",
        });
    }
});

// ---------------------- API: KAYIT EKLE ----------------

app.post("/api/cleanings", upload.fields([
    { name: "photos", maxCount: 10 },
    { name: "problemPhoto", maxCount: 1 }
]), async (req, res) => {
    try {
        const {
            cleanerName, block, apartmentNumber, status, notes,
            cleaningDate, cleaningTime, tenantNotHome, tenantSigned,
            tenantSignature, cleaningRequest
        } = req.body;

        const photos = req.files?.photos?.map(file => `/uploads/${file.filename}`) || [];
        const hasProblem = req.body.hasProblem === "true" || req.body.hasProblem === true;
        const problemNote = req.body.problemNote || "";
        const problemFile = req.files?.problemPhoto?.[0];
        const problemPhotoPath = problemFile ? `/uploads/${problemFile.filename}` : null;

        const result = await pool.query(`
      INSERT INTO cleanings
      (cleanername, block, apartmentnumber, status, notes, cleaningdate, cleaningtime,
       tenantnothome, tenantsigned, tenantsignature, cleaningrequest, photos,
       hasproblem, problemnote, problemphoto)
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
      RETURNING *`,
            [
                cleanerName, block, apartmentNumber, status, notes,
                cleaningDate, cleaningTime, tenantNotHome, tenantSigned,
                tenantSignature, cleaningRequest, JSON.stringify(photos),
                hasProblem, problemNote, problemPhotoPath
            ]
        );

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Error in POST /api/cleanings:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------- API: TÜM KAYITLAR --------------

app.get("/api/cleanings", async (req, res) => {
    try {
        const result = await pool.query(`
      SELECT
        id,
        cleanername AS "cleanerName",
        block,
        apartmentnumber AS "apartmentNumber",
        status,
        notes,
        cleaningdate AS "cleaningDate",
        cleaningtime AS "cleaningTime",
        tenantnothome AS "tenantNotHome",
        tenantsigned AS "tenantSigned",
        tenantsignature AS "tenantSignature",
        cleaningrequest AS "cleaningRequest",
        photos,
        hasproblem AS "hasProblem",
        problemnote AS "problemNote",
        problemphoto AS "problemPhoto",
        createdat AS "createdAt"
      FROM cleanings
      ORDER BY id DESC
    `);

        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("Error in GET /api/cleanings:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------------------- API: JOB FINISHED --------------

app.post("/api/job-finished", async (req, res) => {
    try {
        const { cleanerName } = req.body;
        if (!cleanerName) {
            return res.json({ success: false, error: "Cleaner name is required." });
        }

        const r = await pool.query(
            `INSERT INTO shiftEnds (cleanerName) VALUES ($1) RETURNING *`,
            [cleanerName]
        );

        res.json({ success: true, message: "Shift marked as finished.", data: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get("/api/job-finished", async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM shiftEnds ORDER BY endedAt DESC");
        res.json({ success: true, data: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ---------------------- API: ADMIN CLEANINGS --------------
app.get("/api/admin/cleanings", async (req, res) => {
    try {
        const r = await pool.query(`
      SELECT
        id,
        "cleanerName"      AS "cleanerName",
        block,
        "apartmentNumber"  AS "apartmentNumber",
        status,

        "cleaningDate"     AS "cleaningDate",
        "cleaningTime"     AS "cleaningTime",

        "cleaningRequest"  AS "cleaningRequest",
        "tenantNotHome"    AS "tenantNotHome",
        "tenantSigned"     AS "tenantSigned",
        "tenantSignature"  AS "tenantSignature",

        notes,
        photos,
        "createdAt"        AS "createdAt"
      FROM cleanings
      ORDER BY id DESC
    `);

        res.json({ success: true, data: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📩 Mail gönderici fonksiyon
async function sendDailyReport() {
    const today = new Date().toISOString().slice(0, 10);

    const r = await pool.query(`
        SELECT cleanername, COUNT(*) as total
        FROM cleanings
        WHERE cleaningdate = $1
        GROUP BY cleanername
    `, [today]);

    if (r.rows.length === 0) {
        console.log("No cleanings today, mail not sent.");
        return;
    }

    let reportText = `Daily Cleaning Report (${today})\n\n`;
    r.rows.forEach(row => {
        reportText += `${row.cleanername}: ${row.total} flats\n`;
    });

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Aymu Cleaning" <${process.env.SMTP_USER}>`,
        to: process.env.REPORT_EMAIL_TO,
        subject: `Daily Cleaning Report - ${today}`,
        text: reportText
    });

    console.log("Daily report email sent ✔️");
}

// ---------------------- WEBSOCKET SERVER ---------------

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.on("message", (message) => console.log("Received:", message));

    const interval = setInterval(() => {
        try {
            ws.send(JSON.stringify({ type: "update", data: "New data available" }));
        } catch { }
    }, 10000);

    ws.on("close", () => clearInterval(interval));
});

// ---------------------- CRON JOB -----------------------

// Every day at 19:00
cron.schedule("0 19 * * *", async () => {
    console.log("⏰ 19:00 cron triggered");
    try {
        await sendDailyReport();
    } catch (e) {
        console.error("Daily report error:", e);
    }
});

// ---------------------- SERVER START --------------------

initDB()
    .then(() => {
        server.listen(PORT, "0.0.0.0", () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch((e) => {
        console.error("DB INIT ERROR:", e);
        process.exit(1);
    });