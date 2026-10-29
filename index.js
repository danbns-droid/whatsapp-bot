import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import http from 'http';
import admin from 'firebase-admin';

// אתחול Firebase Admin לשרת (לניהול הסשן וגיבוי הענן)
// ודא שקובץ ה-JSON של מפתח השירות מוגדר תחת serviceAccountKey.json או משתני סביבה
import fs from 'fs';
if (fs.existsSync('./serviceAccountKey.json')) {
    const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com"
    });
} else {
    admin.initializeApp({
        databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com"
    });
}

const db = admin.database();
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const STUDIO_PHONE = '972504886580@s.whatsapp.net'; // מספר הוואטסאפ של הסטודיו

let sock;

async function restoreSessionFromFirebase() {
    try {
        const snapshot = await db.ref('whatsapp_session').once('value');
        const sessionData = snapshot.val();
        if (sessionData) {
            if (!fs.existsSync('./auth_info_baileys')) {
                fs.mkdirSync('./auth_info_baileys');
            }
            for (let key in sessionData) {
                fs.writeFileSync(`./auth_info_baileys/${key}`, sessionData[key]);
            }
            console.log("Session successfully restored from Firebase!");
        }
    } catch (error) {
        console.error("Failed to restore session from Firebase:", error);
    }
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
        await db.ref('whatsapp_session').set(sessionData);
        console.log("Session successfully backed up to Firebase!");
    } catch (error) {
        console.error("Failed to backup session to Firebase:", error);
    }
}

async function connectToWhatsApp() {
    await restoreSessionFromFirebase();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["Yulas Studio Bot", "Chrome", "10.0.0"]
    });

    sock.udarstven.on('creds.update', async () => {
        await saveCreds();
        await backupSessionToFirebase();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('WhatsApp connected successfully!');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });
}

// נקודת קצה לשליחת אישור תור ללקוחה ועדכון לסטודיו
app.post('/send-appointment', async (req, res) => {
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

// נקודת קצה לשליחת הודעת צור קשר / פנייה לסטודיו
app.post('/send-inquiry', async (req, res) => {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});
