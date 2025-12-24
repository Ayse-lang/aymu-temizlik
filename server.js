const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws"); // Ensure 'ws' module is installed via npm

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- KLASÖRLER ----------------------

// uploads klasörü yoksa oluþtur
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// ---------------------- MIDDLEWARE ----------------------

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// static dosyalar (public + uploads)
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/uploads", express.static(uploadsDir));

// root açýlýnca login sayfasýna at
app.get("/", (req, res) => {
    res.redirect("/login.html");
});

// ---------------------- MULTER (FOTO) ------------------

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const name = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, name + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// ---------------------- VERÝLER ------------------------

let cleanings = [];   // temizlik kayýtlarý
let shiftEnds = [];   // "job finished" kayýtlarý

// ---------------------- API: KAYIT EKLE ----------------

app.post("/api/cleanings", upload.array("photos", 5), (req, res) => {
    try {
        const {
            cleanerName,
            block,
            apartmentNumber,
            status,
            notes,
            cleaningDate,
            cleaningTime,
            tenantName,
            tenantNotHome,
            tenantSigned,
            tenantSignature
        } = req.body;

        const photos = (req.files || []).map(f => "/uploads/" + f.filename);

        const record = {
            id: cleanings.length + 1,
            cleanerName,
            block,
            apartmentNumber,
            status,
            notes: notes || "",
            cleaningDate,
            cleaningTime,
            tenantName: tenantName || "",
            tenantNotHome: tenantNotHome === "true",
            tenantSigned: tenantSigned === "true",
            tenantSignature: tenantSignature || "",
            photos,
            createdAt: new Date().toISOString()
        };

        cleanings.push(record);

        res.json({ success: true, data: record });

    } catch (err) {
        console.error("CLEANING ERROR:", err);
        res.json({ success: false, error: err.message });
    }
});

// ---------------------- API: TÜM KAYITLAR --------------

app.get("/api/cleanings", (req, res) => {
    res.json({ success: true, data: cleanings });
});

// ---------------------- API: JOB FINISHED --------------

app.post("/api/job-finished", (req, res) => {
    const { cleanerName } = req.body;

    if (!cleanerName) {
        return res.json({ success: false, error: "Cleaner name is required." });
    }

    const entry = {
        id: shiftEnds.length + 1,
        cleanerName,
        endedAt: new Date().toISOString()
    };

    shiftEnds.push(entry);

    res.json({ success: true, message: "Shift marked as finished.", data: entry });
});

app.get("/api/job-finished", (req, res) => {
    res.json({ success: true, data: shiftEnds });
});

// ---------------------- API: ADMIN RAPOR ----------------

// admin paneli için hepsini tek endpointte gönderiyoruz
app.get("/api/admin/cleanings", (req, res) => {
    res.json({
        success: true,
        data: {
            cleanings,
            shiftEnds
        }
    });
});

// ---------------------- WEBSOCKET SERVER ---------------

// Modify WebSocket server to use the existing HTTP server
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
    console.log("Client connected");
    ws.on("message", message => {
        console.log("Received:", message);
    });

    // Example: Broadcast updates every 10 seconds
    setInterval(() => {
        ws.send(JSON.stringify({ type: "update", data: "New data available" }));
    }, 10000);
});

// ---------------------- SERVER START --------------------

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});