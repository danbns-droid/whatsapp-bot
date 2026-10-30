import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import http from 'http';
import https from 'https';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const STUDIO_PHONE = '972504886580@s.whatsapp.net'; // מספר הוואטסאפ של הסטודיו
const FIREBASE_DB_URL = "https://yulas-studio-default-rtdb.firebaseio.com";

let sock;
let latestQR = null; // משתנה לשמירת ה-QR האחרון כדי להציג בדפדפן

async function restoreSessionFromFirebase() {
    return new Promise((resolve) => {
        https.get(`${FIREBASE_DB_URL}/baileys_session_backup.json`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const sessionData = JSON.parse(data);
                    if (sessionData) {
                        if (!fs.existsSync('./auth_info_baileys')) {
                            fs.mkdirSync('./auth_info_baileys', { recursive: true });
                        }
                        for (let key in sessionData) {
                            fs.writeFileSync(`./auth_info_baileys/${key}`, sessionData[key]);
                        }
                        console.log("Session successfully restored from Firebase!");
                    }
                } catch (e) {
                    console.log("No remote session found or parse error.");
                }
                resolve();
            });
        }).on('error', (err) => {
            console.error("Failed to restore session from Firebase:", err.message);
            resolve();
        });
    });
}

async function backupSessionToFirebase() {
    try {
        if (!fs.existsSync('./auth_info_baileys')) return;
        const files = fs.readdirSync('./auth_info_baileys');
        let sessionData = {};
        for (let file of files) {
            const content = fs.readFileSync(`./auth_info_baileys/${file}`, 'utf8');
            sessionData[file] = content;
        }

        const dataString = JSON.stringify(sessionData);
        const url = new URL(`${FIREBASE_DB_URL}/baileys_session_backup.json`);

        const reqOptions = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(dataString)
            }
        };

        const req = https.request(reqOptions, (res) => {
            if (res.statusCode === 200) {
                console.log("Session successfully backed up to Firebase!");
            }
        });
        req.on('error', (e) => console.error("Backup error:", e.message));
        req.write(dataString);
        req.end();
    } catch (error) {
        console.error("Failed to backup session to Firebase:", error.message);
    }
}

async function connectToWhatsApp() {
    await restoreSessionFromFirebase();
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Yulas Studio Bot", "Chrome", "10.0.0"]
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await backupSessionToFirebase();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr; // שומר את ה-QR כדי להציג בדפדפן
            console.log('New QR code generated. View it at your server URL /qr');
        }

        if (connection === 'open') {
            console.log('WhatsApp connected successfully! 🚀');
            latestQR = null; // מאפס ברגע שמחובר
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });
}

// נתיב אינטרנט חדש לצפייה נוחה ב-QR דרך הדפדפן
app.get('/qr', (req, res) => {
    if (!latestQR) {
        return res.send(`
            <html dir="rtl">
                <body style="font-family: Arial; text-align: center; margin-top: 50px;">
                    <h2>הבוט כבר מחובר או שטרם נוצר קוד QR חדש.</h2>
                    <p>נסה לרענן את העמוד בעוד מספר שניות.</p>
                </body>
            </html>
        `);
    }

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
    
    res.send(`
        <html dir="rtl">
            <body style="font-family: Arial; text-align: center; margin-top: 40px; background-color: #f4f4f9;">
                <h2>סרוק את קוד ה-QR כדי לחבר את הבוט לוואטסאפ של הסטודיו</h2>
                <br>
                <div style="background: white; display: inline-block; padding: 20px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="width: 300px; height: 300px;" />
                </div>
                <p style="margin-top: 20px; color: #666;">העמוד מתרענן אוטומטית כל 10 שניות כדי לספק קוד מעודכן.</p>
                <script>
                    setTimeout(() => { window.location.reload(); }, 10000);
                </script>
            </body>
        </html>
    `);
});

app.post('/send-appointment', async (req, res) => {
    if (!sock) {
        return res.status(500).json({ success: false, error: 'הבוט עדיין מתחבר לוואטסאפ, נסה שוב בעוד רגע' });
    }

    const { phone, name, date, time, serviceName, appointmentId, note } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, error: 'מספר טלפון חסר' });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '972' + formattedPhone.substring(1);
    }
    const clientJid = formattedPhone + '@s.whatsapp.net';

    let clientMessage = `שלום ${name || 'לקוחה יקרה'}, התור שלך נקבע בהצלחה! ✨\n` +
                        `📅 תאריך: ${date || 'לא צוין'}\n` +
                        `⏰ שעה: ${time || 'לא צוין'}\n` +
                        `💅 שירות: ${serviceName || 'לא צוין'}\n` +
                        `📍 כתובת הסטודיו: רחוב החצב 40, זכרון יעקב (מימין בגינה העליונה)\n` +
                        `🔑 קוד ביטול: ${appointmentId || 'לא צוין'}\n`;

    if (note) {
        clientMessage += `💬 הערה: ${note}\n`;
    }
    clientMessage += `מחכים לך בסטודיו! Yulas Studio`;

    let studioMessage = `🚨 *תור חדש נקבע בסטודיו!* 🚨\n\n` +
                        `👤 שם: ${name}\n` +
                        `📞 טלפון: ${phone}\n` +
                        `💅 שירות: ${serviceName}\n` +
                        `📅 תאריך ושעה: ${date} בשעה ${time}\n` +
                        `🔑 קוד תור: ${appointmentId}` +
                        (note ? `\n💬 הערה: ${note}` : '');

    try {
        await sock.sendMessage(clientJid, { text: clientMessage });
        await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });
        
        res.status(200).json({ success: true, message: 'הודעות נשלחו בהצלחה' });
    } catch (error) {
        console.error('Failed to send appointment WhatsApp message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/send-inquiry', async (req, res) => {
    if (!sock) {
        return res.status(500).json({ success: false, error: 'הבוט עדיין מתחבר לוואטסאפ, נסה שוב בעוד רגע' });
    }

    const { phone, name, description } = req.body;

    let studioMessage = `✉️ *פנייה חדשה התקבלה מהאתר!* ✉️\n\n` +
                        `👤 שם: ${name}\n` +
                        `📞 טלפון: ${phone}\n` +
                        `💬 תוכן הפנייה:\n${description}`;

    try {
        await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });
        res.status(200).json({ success: true, message: 'פנייה נשלחה לוואטסאפ של הסטודיו' });
    } catch (error) {
        console.error('Failed to send inquiry WhatsApp message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});
