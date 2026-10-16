const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

let sock;
let qrCodeData = '';
let connectionStatus = 'DISCONNECTED';

// מספר הטלפון של הסטודיו (לשם ישלחו התראות על פניות חדשות)
// יש לוודא שהמספר בפורמט בינלאומי, לדוגמה: 972501234567@s.whatsapp.net
const STUDIO_PHONE = '972504886580@s.whatsapp.net'; // <-- החלף למספר הטלפון האמיתי של הסטודיו

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
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
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'CONNECTED';
            qrCodeData = '';
            console.log('WhatsApp connected successfully!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

// הצגת סטטוס השרת וקוד ה-QR בדפדפן
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

// 1. נתיב לשליחת אישור תור ללקוחה
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

// הוספת כתובת הסטודיו בתוך הודעת הוואטסאפ
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

// 2. נתיב לשליחת פנייה / צור קשר (גם ללקוחה וגם לסטודיו)
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

    // הודעה ללקוחה
    const clientMessage = `שלום ${name},\n` +
                          `פנייתך התקבלה בהצלחה! 📝\n\n` +
                          `תיאור הפנייה:\n"${description || 'ללא תיאור'}"\n\n` +
                          `ניצור איתך קשר בהקדם. Yulas Studio`;

    // הודעה לסטודיו
    const studioMessage = `📥 פנייה חדשה התקבלה באתר Yulas Studio:\n\n` +
                          `👤 שם: ${name}\n` +
                          `📞 טלפון: ${phone}\n` +
                          `📝 תוכן הפנייה:\n${description || 'ללא תיאור'}`;

    try {
        // שליחת הודעה ללקוחה
        await sock.sendMessage(formattedPhone, { text: clientMessage });
        
        // שליחת עותק לסטודיו
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
