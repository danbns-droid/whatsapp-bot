const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());
app.use(cors());

let sock;
let qrCodeData = '';
let isConnected = false;
const PORT = process.env.PORT || 3000;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

   sock = makeWASocket({
        auth: state,
        browser: ["Chrome (Linux)", "", ""],
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            console.log('נוצר קוד QR חדש לסריקה!');
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('החיבור נותק, מנסה להתחבר מחדש...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = '';
            console.log('התחברת בהצלחה לוואטסאפ!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// דף בית שמציג את סטטוס החיבור או את קוד ה-QR לסריקה
app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h2>הבוט מחובר לוואטסאפ בהצלחה! 🟢</h2>');
    } else if (qrCodeData) {
        res.send(`<h2>סרוק את קוד ה-QR כדי להתחבר לוואטסאפ:</h2><img src="${qrCodeData}" alt="QR Code"/>`);
    } else {
        res.send('<h2>מייצר קוד QR, רענן את העמוד עוד כמה שניות...</h2>');
    }
});

app.post('/send-appointment', async (req, res) => {
    const { phone, name, date, time } = req.body;

    if (!phone || !date || !time) {
        return res.status(400).json({ success: false, message: 'חסרים נתונים' });
    }

    try {
        let formattedPhone = phone.replace(/\D/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '972' + formattedPhone.substring(1);
        }
        const jid = `${formattedPhone}@s.whatsapp.net`;

        const message = `הי ${name || 'לקוח יקר'}, אישור קבלת תור!\n📅 בתאריך: ${date}\n⏰ בשעה: ${time}\nמחכים לראותך!`;

        await sock.sendMessage(jid, { text: message });

        res.json({ success: true, message: 'הודעת וואטסאפ נשלחה בהצלחה' });
    } catch (error) {
        console.error('שגיאה בשליחת הודעה:', error);
        res.status(500).json({ success: false, message: 'שגיאה פנימית בשליחת ההודעה' });
    }
});

app.listen(PORT, () => {
    console.log(`השרת רץ על פורט ${PORT}`);
    connectToWhatsApp();
});
