const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const http = require("http");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- POSTGRES ----------------------

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false,
});


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

app.post("/api/cleanings", upload.array("photos", 5), async (req, res) => {
    try {
        const {
            cleanerName,
            block,
            apartmentNumber,
            status,
            notes,
            cleaningDate,
            cleaningTime,
            tenantNotHome,
            tenantSigned,
            tenantSignature,
            cleaningRequest,
        } = req.body;

        const photos = (req.files || []).map((f) => "/uploads/" + f.filename);

        const result = await pool.query(
            `
      INSERT INTO cleanings
      (cleanerName, block, apartmentNumber, status, notes, cleaningDate, cleaningTime,
       tenantNotHome, tenantSigned, tenantSignature, cleaningRequest, photos)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      RETURNING *
      `,
            [
                cleanerName || "",
                block || "",
                apartmentNumber || "",
                status || "",
                notes || "",
                cleaningDate || "",
                cleaningTime || "",
                tenantNotHome === "true",
                tenantSigned === "true",
                tenantSignature || "",
                cleaningRequest || "requested",
                JSON.stringify(photos),
            ]
        );

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("CLEANING ERROR:", err);
        res.json({ success: false, error: err.message });
    }
});

// ---------------------- API: TÜM KAYITLAR --------------

app.get("/api/cleanings", async (req, res) => {
    try {
        const r = await pool.query("SELECT * FROM cleanings ORDER BY createdAt DESC");
        res.json({ success: true, data: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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

// ---------------------- API: ADMIN RAPOR ----------------

app.get("/api/admin/cleanings", async (req, res) => {
    try {
        const c = await pool.query("SELECT * FROM cleanings ORDER BY createdAt DESC");
        const s = await pool.query("SELECT * FROM shiftEnds ORDER BY endedAt DESC");

        res.json({
            success: true,
            data: {
                cleanings: c.rows,
                shiftEnds: s.rows,
            },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

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

// ---------------------- SERVER START --------------------

// ---------------------- SERVER START --------------------

server.listen(PORT, "0.0.0.0", () => {
    console.log(Server running on port ${ PORT });
});