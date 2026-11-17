import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getDatabase, ref, get, set } from 'firebase/database';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const STUDIO_PHONE = '972504886580@s.whatsapp.net'; // מספר הוואטסאפ של הסטודיו
const AUTH_DIR = './auth_info_baileys';

// הגדרת Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDjPBynU-kEAZhXb2yIXiExlGB81p6QN6U",
    authDomain: "yulas-studio.firebaseapp.com",
    databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com",
    projectId: "yulas-studio",
    storageBucket: "yulas-studio.firebasestorage.app",
    messagingSenderId: "97526172718",
    appId: "1:97526172718:web:ddfe735cb30f501c3663bf"
};

// אתחול Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);

let sock = null;
let latestQR = null;
let isConnecting = false;
let backupTimeout = null;

// ==========================================
// מנגנון מטמון למניעת "בהמתנה להודעה זו" (Retry & Store)
// ==========================================
const retryCacheMap = new Map();
const msgRetryCounterCache = {
    get: (key) => retryCacheMap.get(key),
    set: (key, value) => retryCacheMap.set(key, value),
    del: (key) => retryCacheMap.delete(key),
    flushAll: () => retryCacheMap.clear()
};

// שמירת הודעות שנשלחו בזיכרון כדי לאפשר הצפנה מחדש במקרה של בקשת Retry מהלקוח
const sentMessageStore = new Map();
const MAX_STORED_MESSAGES = 200;

function saveMessageToStore(msgObj, textContent) {
    if (msgObj?.key?.id) {
        sentMessageStore.set(msgObj.key.id, { conversation: textContent });
        if (sentMessageStore.size > MAX_STORED_MESSAGES) {
            const firstKey = sentMessageStore.keys().next().value;
            sentMessageStore.delete(firstKey);
        }
    }
}

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

// שחזור סשן דחוס מ-Firestore
async function restoreSessionFromFirestore() {
    try {
        const docRef = doc(db, "whatsapp_sessions", "main_session");
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            console.log("ℹ️ No session found in Firestore.");
            return;
        }

        const data = docSnap.data();
        let sessionFiles = {};

        if (data.compressedData) {
            const buffer = Buffer.from(data.compressedData, 'base64');
            const decompressed = zlib.gunzipSync(buffer).toString('utf8');
            sessionFiles = JSON.parse(decompressed);
        } else if (data.files) {
            sessionFiles = data.files;
        }

        const fileNames = Object.keys(sessionFiles);
        if (fileNames.length === 0) return;

        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        for (const fileName of fileNames) {
            fs.writeFileSync(path.join(AUTH_DIR, fileName), sessionFiles[fileName]);
        }

        console.log(`✅ Successfully restored ${fileNames.length} session files from Firestore (Compressed)!`);
    } catch (error) {
        console.error("❌ Failed to restore session from Firestore:", error.message);
    }
}

// איחוד כתיבות לסשן
function triggerDebouncedBackup() {
    if (backupTimeout) clearTimeout(backupTimeout);
    backupTimeout = setTimeout(() => {
        backupSessionToFirestore();
    }, 2000);
}

// גיבוי דחוס ב-Gzip למסמך יחיד ב-Firestore
async function backupSessionToFirestore() {
    try {
        if (!fs.existsSync(AUTH_DIR)) return;
        const files = fs.readdirSync(AUTH_DIR);
        if (files.length === 0) return;

        const sessionFiles = {};
        for (const file of files) {
            const filePath = path.join(AUTH_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                sessionFiles[file] = fs.readFileSync(filePath, 'utf8');
            }
        }

        const jsonString = JSON.stringify(sessionFiles);
        const compressedBase64 = zlib.gzipSync(jsonString).toString('base64');

        await setDoc(doc(db, "whatsapp_sessions", "main_session"), {
            compressedData: compressedBase64,
            fileCount: files.length,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ Failed to backup session to Firestore:", error.message);
    }
}

// ==========================================
// מנגנון תזכורות אוטומטיות (08:00 - 09:00 בבוקר)
// ==========================================
function formatDateToShort(dateString) {
    const parts = dateString.split('-'); 
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateString;
}

async function checkAndSendReminders() {
    if (!sock || !sock.user || sock.ws?.isClosed) return;

    try {
        const now = new Date();
        const israelTimeStr = now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" });
        const israelDate = new Date(israelTimeStr);
        const hours = israelDate.getHours();

        // רץ אך ורק בין השעות 08:00 ל-09:00 בבוקר
        if (hours !== 8) return;

        // חישוב תאריך מחר (YYYY-MM-DD) לפי שעון ישראל
        const tomorrow = new Date(israelDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const appointmentsRef = ref(rtdb, 'yulas_data/appointments');
        const snapshot = await get(appointmentsRef);
        
        if (!snapshot.exists()) return;
        const appointments = snapshot.val();

        if (!Array.isArray(appointments)) return;

        let updated = false;

        for (let i = 0; i < appointments.length; i++) {
            const app = appointments[i];
            
            if (app && app.date === tomorrowStr && !app.reminderSent && app.time) {
                const appDateTime = new Date(`${app.date}T${app.time}:00`);
                const diffHours = (appDateTime - now) / (1000 * 60 * 60);

                // שליחה אך ורק אם הזמן לפגישה הוא 24 שעות ומעלה
                if (diffHours >= 24) {
                    let phone = app.phone.replace(/\D/g, '');
                    if (phone.startsWith('0')) {
                        phone = '972' + phone.substring(1);
                    }
                    const clientJid = phone + '@s.whatsapp.net';

                    const reminderText = `שלום ${app.clientName || 'לקוחה יקרה'}, מזכירים לך באהבה על התור שלך מחר (${formatDateToShort(app.date)}) בשעה ${app.time} לשירות ${app.serviceName || 'בסטודיו'}.\n📍 כתובת: רחוב החצב 40, זכרון יעקב (מימין בגינה העליונה).\nמחכים לך! Yulas Studio ✨`;

                    const sentMsg = await sock.sendMessage(clientJid, { text: reminderText });
                    saveMessageToStore(sentMsg, reminderText);
                    logOutgoingMessage(clientJid, reminderText);
                    console.log(`✅ Reminder successfully sent to client: ${app.clientName} (${phone}) for tomorrow (${tomorrowStr}).`);

                    appointments[i].reminderSent = true;
                    updated = true;
                } else {
                    console.log(`⏳ Skipped reminder for ${app.clientName}: Appointment is in less than 24 hours (${diffHours.toFixed(1)} hours left).`);
                }
            }
        }

        if (updated) {
            await set(ref(rtdb, 'yulas_data/appointments'), appointments);
        }

    } catch (error) {
        console.error("❌ Error in checkAndSendReminders:", error.message);
    }
}

setInterval(checkAndSendReminders, 10 * 60 * 1000);
// ==========================================

async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        if (sock) {
            try {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                sock.ws.close();
            } catch (e) {}
            sock = null;
        }

        await restoreSessionFromFirestore();
        
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            connectTimeoutMs: 60000,
            msgRetryCounterCache,
            getMessage: async (key) => {
                return sentMessageStore.get(key.id) || undefined;
            }
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            triggerDebouncedBackup();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                latestQR = qr;
                console.log('📱 New QR code generated. View it at your server URL /qr');
            }

            if (connection === 'open') {
                isConnecting = false;
                console.log('WhatsApp connected successfully! 🚀');
                latestQR = null;
                triggerDebouncedBackup();
            } else if (connection === 'close') {
                isConnecting = false;
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, 3000);
                }
            }
        });
    } catch (error) {
        isConnecting = false;
        console.error('❌ Error in connectToWhatsApp:', error);
        setTimeout(() => {
            connectToWhatsApp();
        }, 5000);
    }
}

// ==========================================
// נתיבי API
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
        const sentClientMsg = await sock.sendMessage(clientJid, { text: clientMessage });
        saveMessageToStore(sentClientMsg, clientMessage);
        logOutgoingMessage(clientJid, clientMessage);

        const sentStudioMsg = await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });
        saveMessageToStore(sentStudioMsg, studioMessage);
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
        const sentStudioMsg = await sock.sendMessage(STUDIO_PHONE, { text: studioMessage });
        saveMessageToStore(sentStudioMsg, studioMessage);
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
