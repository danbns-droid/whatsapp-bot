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

// פונקציות עזר לסנכרון מול Firebase תחת yulas_data
async function restoreAuthFromFirebase() {
    try {
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }
        const snapshot = await get(ref(db, 'yulas_data/baileys_session_backup'));
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
        await set(ref(db, 'yulas_data/baileys_session_backup'), backupData);
        console.log('Session successfully backed up to Firebase!');
    } catch (err) {
        console.log('Error backing up session to Firebase:', err.message);
    }
}

// 2. פונקציית בדיקת תזכורות יומית שרצה כל 30 דקות
let lastReminderDate = '';

async function checkAndSendDailyReminders() {
    if (connectionStatus !== 'CONNECTED' || !sock) return;

    const now = new Date();
    const israelDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
    const israelTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }); // HH:MM:SS
    const [hour] = israelTimeStr.split(':');
    const currentHour = parseInt(hour, 10);

    // בדיקה החל מהשעה 08:00 בבוקר וכל עוד לא נשלחו תזכורות עבור היום הנוכחי
    if (currentHour >= 8 && lastReminderDate !== israelDateStr) {
        lastReminderDate = israelDateStr;
        console.log(`Running daily reminder check for date: ${israelDateStr}`);

        try {
            const appointmentsRef = ref(db, 'yulas_data/appointments');
            const snapshot = await get(appointmentsRef);
            
            if (!snapshot.exists()) return;

            const appointments = snapshot.val();
            for (const key in appointments) {
                const appt = appointments[key];
                
                // בדיקה אם התור הוא להיום והאם טרם נשלחה אליו תזכורת
                if (appt && appt.date === israelDateStr && !appt.reminderSent) {
                    let phone = appt.phone;
                    if (!phone) continue;

                    let formattedPhone = phone.replace(/\D/g, '');
                    if (formattedPhone.startsWith('0')) {
                        formattedPhone = '972' + formattedPhone.substring(1);
                    }
                    formattedPhone += '@s.whatsapp.net';

                    const reminderMessage = `שלום ${appt.name || 'לקוחה יקרה'},\n` +
                                            `זוהי תזכורת לתור שנקבע להיום בשעה: ${appt.time} ✨\n` +
                                            `📅 תאריך: ${appt.date}\n` +
                                            `📍 כתובת הסטודיו: רחוב החצב 40, זכרון יעקב (מימין בגינה העליונה)\n` +
                                            `🔑 קוד ביטול: ${appt.appointmentId || 'לא צוין'}\n` +
                                            `מחכים לך בסטודיו! Yulas Studio`;

                    try {
                        await sock.sendMessage(formattedPhone, { text: reminderMessage });
                        console.log(`Daily reminder sent successfully to ${formattedPhone}`);
                        
                        // סימון ב-Firebase שהתזכורת נשלחה
                        await set(ref(db, `yulas_data/appointments/${key}/reminderSent`), true);
                    } catch (err) {
                        console.log(`Failed to send reminder to ${formattedPhone}:`, err.message);
                    }
                }
            }
        } catch (err) {
            console.log('Error checking appointments for reminders:', err.message);
        }
    }
}

// הפעלת הבדיקה כל 30 דקות
setInterval(checkAndSendDailyReminders, 30 * 60 * 1000);

// 3. התחברות ל-WhatsApp
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
            markOnlineOnConnect: false,
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
                    await remove(ref(db, 'yulas_data/baileys_session_backup'));
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

// 4. הצגת קוד QR בדפדפן
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

// 5. אישור תור ללקוחה (כולל תמיכה בהערה)
app.post('/send-appointment', async (req, res) => {
    const { phone, name, date, time, serviceName, appointmentId, note } = req.body;
    
    if (!phone) {
        return res.status(400).json({ success: false, error: 'מספר טלפון חסר' });
    }

    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '972' + formattedPhone.substring(1);
    }
    formattedPhone += '@s.whatsapp.net';

    let message = `שלום ${name}, התור שלך נקבע בהצלחה! ✨\n` +
                  `📅 תאריך: ${date}\n` +
                  `⏰ שעה: ${time}\n` +
                  `💅 שירות: ${serviceName || 'לא צוין'}\n` +
                  `📍 כתובת הסטודיו: רחוב החצב 40, זכרון יעקב (מימין בגינה העליונה)\n` +
                  `🔑 קוד ביטול: ${appointmentId || 'לא צוין'}\n`;

    if (note) {
        message += `💬 הערה: ${note}\n`;
    }

    message += `מחכים לך בסטודיו! Yulas Studio`;

    try {
        await sock.sendMessage(formattedPhone, { text: message });
        res.status(200).json({ success: true, message: 'הודעת תור נשלחה בהצלחה' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. פנייה חדשה / צור קשר
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
                          `פנייתך התקבלה בהצלחה! 📝\n` +
                          `תיאור הפנייה: "${description || 'ללא תיאור'}"\n` +
                          `ניצור איתך קשר בהקדם. Yulas Studio`;

    const studioMessage = `📥 פנייה חדשה התקבלה באתר Yulas Studio:\n` +
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
