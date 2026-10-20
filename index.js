const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove } = require('firebase/database');
const qrcode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

let sock;
let qrCodeData = '';
let connectionStatus = 'DISCONNECTED';

const STUDIO_PHONE = '972504886580@s.whatsapp.net';
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

// 1. אתחול Firebase
const firebaseApp = initializeApp({
    databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com"
});
const db = getDatabase(firebaseApp);

// פונקציות עזר לסנכרון מול Firebase
async function restoreAuthFromFirebase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }
        const snapshot = await get(ref(db, 'baileys_session_backup'));
        if (snapshot.exists()) {
            const files = snapshot.val();
            for (const [filename, contentBase64] of Object.entries(files)) {
                const filePath = path.join(AUTH_DIR, filename.replace(/_/g, '.'));
                fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
            }
            console.log('Session successfully restored from Firebase!');
        }
    } catch (err) {
        console.log('Error restoring session from Firebase:', err.message);
    }
}

async function backupAuthToFirebase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        const backupData = {};
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                const safeKey = file.replace(/\./g, '_');
                backupData[safeKey] = fs.readFileSync(filePath).toString('base64');
            }
        }
        await set(ref(db, 'baileys_session_backup'), backupData);
        console.log('Session successfully backed up to Firebase!');
    } catch (err) {
        console.log('Error backing up session to Firebase:', err.message);
    }
}

// 2. התחברות ל-WhatsApp עם הגנה נגד שגיאה 515
async function connectToWhatsApp() {
    try {
        await restoreAuthFromFirebase();

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Yulas Studio Bot', 'Chrome', '10.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: false, // מונע את שגיאת 515 בשלב החיבור
            getMessage: async (key) => {
                return { conversation: 'Yulas Studio' };
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCodeData = qr;
                connectionStatus = 'QR_READY';
                console.log('New QR code received.');
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
                connectionStatus = 'DISCONNECTED';
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    if (fs.existsSync(AUTH_DIR)) {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    }
                    await remove(ref(db, 'baileys_session_backup'));
                }

                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                connectionStatus = 'CONNECTED';
                qrCodeData = '';
                console.log('WhatsApp connected successfully!');
                await backupAuthToFirebase();
            }
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            await backupAuthToFirebase();
        });

    } catch (err) {
        console.log('Connection error:', err);
        setTimeout(connectToWhatsApp, 5000);
    }
}

connectToWhatsApp();

// 3. הצגת קוד QR בדפדפן
app.get('/', async (req, res) => {
    if (connectionStatus === 'CONNECTED') {
        return res.send('<h2>הבוט מחובר לוואטסאפ בהצלחה! 🟢</h2>');
    }
    if (qrCodeData) {
        try {
            const urlImage = await qrcode.toDataURL(qrCodeData);
            return res.send(`
                <h2>סרוק את קוד ה-QR כדי לחבר את הבוט:</h2>
                <img src="${urlImage}" alt="WhatsApp QR Code"/>
            `);
        } catch (err) {
            return res.status(500).send('שגיאה ביצירת קוד ה-QR');
        }
    }
    res.send('<h2>מייצר קוד QR, רענן את העמוד עוד כמה שניות...</h2>');
});

// 4. אישור תור ללקוחה
app.post('/send-appointment', async (req, res) => {
    const { phone, name, date, time, serviceName, appointmentId } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, error: 'מספר טלפון חסר' });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '972' + formattedPhone.substring(1);
    }
    formattedPhone += '@s.whatsapp.net';

    const message = `שלום ${name}, התור שלך נקבע בהצלחה! ✨\n\n` +
                    `📅 תאריך: ${date}\n` +
                    `⏰ שעה: ${time}\n` +
                    `💅 שירות: ${serviceName || 'לא צוין'}\n` +
                    `📍 כתובת הסטודיו: רחוב החצב 40, זכרון יעקב (מימין בגינה העליונה)\n` +
                    `🔑 קוד ביטול: ${appointmentId || 'לא צוין'}\n\n` +
                    `מחכים לך בסטודיו! Yulas Studio`;

    try {
        await sock.sendMessage(formattedPhone, { text: message });
        res.status(200).json({ success: true, message: 'הודעת תור נשלחה בהצלחה' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. פנייה חדשה / צור קשר
app.post('/send-inquiry', async (req, res) => {
    const { phone, name, description } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, error: 'מספר טלפון חסר' });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '972' + formattedPhone.substring(1);
    }
    formattedPhone += '@s.whatsapp.net';

    const clientMessage = `שלום ${name},\n` +
                          `פנייתך התקבלה בהצלחה! 📝\n\n` +
                          `תיאור הפנייה:\n"${description || 'ללא תיאור'}"\n\n` +
                          `ניצור איתך קשר בהקדם. Yulas Studio`;

    const studioMessage = `📥 פנייה חדשה התקבלה באתר Yulas Studio:\n\n` +
                          `👤 שם: ${name}\n` +
                          `📞 טלפון: ${phone}\n` +
                          `📝 תוכן הפנייה:\n${description || 'ללא תיאור'}`;

    try {
        await sock.sendMessage(formattedPhone, { text: clientMessage });
        await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });

        res.status(200).json({ success: true, message: 'הפנייה נשלחה בהצלחה' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
