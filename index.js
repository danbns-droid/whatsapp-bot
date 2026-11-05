import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const STUDIO_PHONE = '972504886580@s.whatsapp.net'; // מספר הוואטסאפ של הסטודיו
const AUTH_DIR = './auth_info_baileys';

// הגדרת Firebase (משתמש באותם נתונים של פרויקט ה-RTDB שלך)
const firebaseConfig = {
    projectId: "yulas-studio", // או מזהה הפרויקט שלך מתוך Firebase Console
    databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com"
};

// אתחול Firebase Firestore
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

let sock;
let latestQR = null;

// ==========================================
// מנגנון לוגים עבור הדשבורד החיצוני
// ==========================================
const sentMessagesLog = [];
const MAX_LOGS = 50;

function logOutgoingMessage(to, text) {
    sentMessagesLog.unshift({
        timestamp: new Date().toISOString(),
        to: typeof to === 'string' ? to.replace('@s.whatsapp.net', '') : to,
        text: typeof text === 'string' ? text : JSON.stringify(text)
    });
    if (sentMessagesLog.length > MAX_LOGS) {
        sentMessagesLog.pop();
    }
}
// ==========================================

// פונקציה חכמה שמשחזרת את קבצי הסשן מ-Firestore לתיקייה המקומית לפני ההתחברות
async function restoreSessionFromFirestore() {
    try {
        const querySnapshot = await getDocs(collection(db, "whatsapp_sessions"));
        if (querySnapshot.empty) {
            console.log("ℹ️ No session found in Firestore.");
            return;
        }

        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        let restoredCount = 0;
        querySnapshot.forEach((docSnap) => {
            const fileName = docSnap.id;
            const fileData = docSnap.data().content;
            if (fileName && fileData) {
                fs.writeFileSync(path.join(AUTH_DIR, fileName), fileData);
                restoredCount++;
            }
        });

        if (restoredCount > 0) {
            console.log(`✅ Successfully restored ${restoredCount} session files from Firestore!`);
        }
    } catch (error) {
        console.error("❌ Failed to restore session from Firestore:", error.message);
    }
}

// פונקציה שמגבה כל קובץ סשן בנפרד ובצורה אטומית ל-Firestore
async function backupSessionToFirestore() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        if (files.length === 0) return;

        for (let file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                // שמירת כל קובץ כמסמך נפרד ב-Firestore תחת השם שלו
                await setDoc(doc(db, "whatsapp_sessions", file), {
                    content: fileContent,
                    updatedAt: new Date().toISOString()
                });
            }
        }
        // שקט כדי לא להציף לוגים מיותרים
    } catch (error) {
        console.error("❌ Failed to backup session to Firestore:", error.message);
    }
}

async function connectToWhatsApp() {
    // שלב 1: שחזור מ-Firestore
    await restoreSessionFromFirestore();
    
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Yulas Studio Bot", "Chrome", "10.0.0"],
        markOnlineOnConnect: true,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await backupSessionToFirestore();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
            console.log('📱 New QR code generated. View it at your server URL /qr');
        }

        if (connection === 'open') {
            console.log('WhatsApp connected successfully! 🚀');
            latestQR = null;
            backupSessionToFirestore();
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });
}

// ==========================================
// נתיב API עבור הדשבורד החיצוני (/api/status)
// ==========================================
app.get('/api/status', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    const isConnected = Boolean(sock && sock.user && !sock.ws?.isClosed);

    res.json({
        status: isConnected ? 'online' : 'offline',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        logs: sentMessagesLog
    });
});

// נתיב אינטרנט לצפייה ב-QR דרך הדפדפן (/qr)
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
                <p style="margin-top: 20px; color: #666;">העמוד מתרענן אוטומטית כל 10 שניות.</p>
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
        logOutgoingMessage(clientJid, clientMessage);

        await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });
        logOutgoingMessage(STUDIO_PHONE, studioMessage);
        
        console.log(`✅ Appointment notification successfully sent to client (${formattedPhone}) and studio.`);

        res.status(200).json({ success: true, message: 'הודעות נשלחו בהצלחה' });
    } catch (error) {
        console.error('❌ Failed to send appointment WhatsApp message:', error);
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
        logOutgoingMessage(STUDIO_PHONE, studioMessage);
        
        console.log(`✅ New website inquiry successfully sent to studio from: ${name} (${phone})`);

        res.status(200).json({ success: true, message: 'פנייה נשלחה לוואטסאפ של הסטודיו' });
    } catch (error) {
        console.error('❌ Failed to send inquiry WhatsApp message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});
