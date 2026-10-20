const express = require('express');
const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, child } = require('firebase/database');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

let sock;
let qrCodeData = '';
let connectionStatus = 'DISCONNECTED';

const STUDIO_PHONE = '972504886580@s.whatsapp.net';

// 1. אתחול Firebase Web SDK
const firebaseApp = initializeApp({
    databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com"
});
const db = getDatabase(firebaseApp);

// 2. מנגנון שמירת מפתחות ב-Firebase עם הגנה מפני קריסה
async function useFirebaseAuthState() {
    const readData = async (type, id) => {
        try {
            const dbRef = ref(db);
            const snapshot = await get(child(dbRef, `baileys_auth/${type}/${id}`));
            return snapshot.exists() ? snapshot.val() : null;
        } catch (e) {
            return null;
        }
    };

    const writeData = async (type, id, value) => {
        try {
            const itemRef = ref(db, `baileys_auth/${type}/${id}`);
            if (value) {
                await set(itemRef, value);
            } else {
                await remove(itemRef);
            }
        } catch (e) {}
    };

    let creds = null;
    try {
        const credsSnapshot = await get(ref(db, 'baileys_auth/creds'));
        creds = credsSnapshot.exists() ? credsSnapshot.val() : null;
    } catch (e) {}

    if (!creds) {
        const { initAuthCreds } = require('@whiskeysockets/baileys');
        creds = initAuthCreds();
        try {
            await set(ref(db, 'baileys_auth/creds'), creds);
        } catch (e) {}
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(type, id);
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(writeData(category, id, value));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            try {
                await set(ref(db, 'baileys_auth/creds'), creds);
            } catch (e) {}
        }
    };
}

// 3. התחברות ל-WhatsApp עם הגדרות יציבות
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useFirebaseAuthState();

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Yulas Studio Bot', 'Chrome', '10.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCodeData = qr;
                connectionStatus = 'QR_READY';
                console.log('New QR code received.');
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
                connectionStatus = 'DISCONNECTED';
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                connectionStatus = 'CONNECTED';
                qrCodeData = '';
                console.log('WhatsApp connected successfully!');
            }
        });

        sock.ev.on('creds.update', saveCreds);
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

// 5. אישור תור ללקוחה
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
