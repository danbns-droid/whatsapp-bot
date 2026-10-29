// ==========================================
// Yulas Studio - Script.js (קוד מלא ומעודכן)
// ==========================================

(function(){
   if (typeof emailjs !== 'undefined') emailjs.init("OOvIWZvexnsy5sDFO");
})();

// כתובת השרת שלך ב-Render
const RENDER_SERVER_URL = 'https://whatsapp-bot-server-mx9l.onrender.com';

const firebaseConfig = {
    apiKey: "AIzaSyDjPBynU-kEAZhXb2yIXiExlGB81p6QN6U",
    authDomain: "yulas-studio.firebaseapp.com",
    databaseURL: "https://yulas-studio-default-rtdb.firebaseio.com",
    projectId: "yulas-studio",
    storageBucket: "yulas-studio.firebasestorage.app",
    messagingSenderId: "97526172718",
    appId: "1:97526172718:web:ddfe735cb30f501c3663bf"
};

firebase.initializeApp(firebaseConfig);
firebase.auth();
const db = firebase.database();

let services = [];
let availableSlots = [];
let appointments = [];
let contactMessages = []; 
let currentCalendarStartDate = new Date();
const daysOfWeek = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const today = new Date().toISOString().split('T')[0];

db.ref('yulas_data').on('value', (snapshot) => {
    const data = snapshot.val() || {};
    services = data.services || [{ name: "מדידות ותיקונים", duration: 30 }, { name: "פגישת עיצוב אישי", duration: 60 }, { name: "איסוף ומדידה סופית", duration: 15 }];
    availableSlots = data.slots || [];
    appointments = data.appointments || [];
    contactMessages = data.contactMessages || []; 
    renderAdmin();
    renderClientCalendar();
});

function autoFormatDate(input) {
    let v = input.value.replace(/\D/g, ''); 
    if (v.length > 2 && v.length <= 4) input.value = v.substring(0, 2) + '/' + v.substring(2);
    else if (v.length > 4) input.value = v.substring(0, 2) + '/' + v.substring(2, 4) + '/' + v.substring(4, 8);
}

function autoFormatTime(input) {
    let v = input.value.replace(/\D/g, ''); 
    if (v.length > 2) input.value = v.substring(0, 2) + ':' + v.substring(2, 4);
}

function uploadData() {
    db.ref('yulas_data').set({ services, slots: availableSlots, appointments, contactMessages });
}

function toggleAdmin() {
    const email = prompt("הכניסי אימייל מנהל:");
    const password = prompt("הכניסי סיסמה:");
    if (!email || !password) return;
    firebase.auth().signInWithEmailAndPassword(email, password)
    .then(() => {
        document.getElementById('client-view').classList.remove('active');
        document.getElementById('admin-view').classList.add('active');
        document.getElementById('toggle-admin-view').style.display = 'none';
        renderAdmin();
    })
    .catch((error) => alert("שגיאה: " + error.message));
}

function exitAdmin() {
    document.getElementById('admin-view').classList.remove('active');
    document.getElementById('client-view').classList.add('active');
    document.getElementById('toggle-admin-view').style.display = 'block';
    renderClientCalendar();
}

function changeWeek(days) {
    currentCalendarStartDate.setDate(currentCalendarStartDate.getDate() + days);
    renderAdmin();
}

function resetToToday() {
    currentCalendarStartDate = new Date();
    renderAdmin();
}

function switchClientMode(mode) {
    document.getElementById('btn-client-booking').classList.toggle('active', mode === 'booking');
    document.getElementById('btn-client-contact').classList.toggle('active', mode === 'contact');
    document.getElementById('client-booking-section').classList.toggle('active', mode === 'booking');
    document.getElementById('client-contact-section').classList.toggle('active', mode === 'contact');
}

function switchSlotView(mode) {
    document.getElementById('btn-slot-tab-list').classList.toggle('active', mode === 'list');
    document.getElementById('btn-slot-tab-calendar').classList.toggle('active', mode === 'calendar');
    document.getElementById('slot-view-list').classList.toggle('active', mode === 'list');
    document.getElementById('slot-view-calendar').classList.toggle('active', mode === 'calendar');
}

function switchAdminView(mode) {
    document.getElementById('btn-tab-list').classList.toggle('active', mode === 'list');
    document.getElementById('btn-tab-calendar').classList.toggle('active', mode === 'calendar');
    document.getElementById('admin-view-list').classList.toggle('active', mode === 'list');
    document.getElementById('admin-view-calendar').classList.toggle('active', mode === 'calendar');
}

function addService() {
    const name = document.getElementById('new-service-name').value.trim();
    const duration = parseInt(document.getElementById('new-service-duration').value);
    if(!name || !duration) return alert("נא למלא את כל השדות");
    services.push({name, duration});
    uploadData();
}

function deleteService(index) { services.splice(index, 1); uploadData(); }

function addTimeSlot() {
    const rawDate = document.getElementById('open-date').value.trim(); 
    let start = document.getElementById('open-start').value.trim();
    let end = document.getElementById('open-end').value.trim();
    if(!rawDate || !start || !end) return alert("נא למלא את כל השדות");
    
    const parts = rawDate.split('/');
    let year = parts[2];
    
    if (year && year.length === 2) {
        year = "20" + year;
    }

    const date = `${year}-${parts[1]}-${parts[0]}`;
    availableSlots.push({ date, start, end });
    uploadData();
    alert("המועד התווסף!");
}

function deleteSlot(index) { availableSlots.splice(index, 1); uploadData(); }

function getDayNameFromDate(dateString) { return daysOfWeek[new Date(dateString).getDay()]; }
function formatDateToShort(dateString) {
    const parts = dateString.split('-'); 
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateString;
}

function renderAdmin() {
    const today = new Date().toISOString().split('T')[0];

    availableSlots = availableSlots
        .filter(s => s.date >= today)
        .sort((a, b) => new Date(a.date + 'T' + a.start) - new Date(b.date + 'T' + b.start));
    
    appointments = appointments
       .filter(app => app.date >= today)
       .sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time));

    document.querySelector('#services-table tbody').innerHTML = services.map((s, idx) => `
        <tr>
            <td data-label="סוג השירות">${s.name}</td>
            <td data-label="אורך פגישה">${s.duration} דק'</td>
            <td data-label="פעולה"><button class="delete-btn" onclick="deleteService(${idx})">מחק</button></td>
        </tr>
    `).join('');
    
    document.getElementById('client-service').innerHTML = services.map(s => `<option value="${s.duration}">${s.name} (${s.duration} דקות)</option>`).join('');
    
    document.getElementById('slots-table-body').innerHTML = availableSlots.map((slot, idx) => `
        <tr>
            <td data-label="תאריך ויום">יום ${getDayNameFromDate(slot.date)} (${formatDateToShort(slot.date)})</td>
            <td data-label="משעה">${slot.start}</td>
            <td data-label="עד שעה">${slot.end}</td>
            <td data-label="פעולה"><button class="delete-btn" onclick="deleteSlot(${idx})">🗑️</button></td>
        </tr>
    `).join('');
    
    const newMessages = contactMessages.filter(msg => !msg.status || msg.status === 'new');
    const processedMessages = contactMessages.filter(msg => msg.status === 'processed');

    document.getElementById('contact-count').innerText = newMessages.length;

    let contactHTML = '';

    if (newMessages.length > 0) {
        contactHTML += `<tr class="table-group-header"><td colspan="6" style="background: #fff4f2; font-weight: bold; color: #c0392b; text-align: center;">✉️ פניות חדשות שעוד לא טופלו</td></tr>`;
        contactHTML += newMessages.map((msg) => {
            const globalIdx = contactMessages.indexOf(msg);
            return `
                <tr style="background: #fffcfb;">
                    <td data-label="תאריך פנייה">${msg.timestamp}</td>
                    <td data-label="שם הלקוחה"><span style="background:#e74c3c; color:white; padding:3px 6px; border-radius:4px; font-size:11px; margin-left:5px; font-weight:bold;">חדש</span><strong>${msg.name}</strong></td>
                    <td data-label="טלפון">${msg.phone}</td>
                    <td data-label="אימייל">${msg.email || 'לא צוין'}</td>
                    <td data-label="הודעה / בקשה" style="max-width:300px; white-space: pre-wrap;">${msg.message}</td>
                    <td data-label="פעולות ניהול">
                        <button class="delete-btn" style="background-color: var(--success); margin-bottom: 5px; width:100%; display:block; font-weight:bold;" onclick="markContactAsProcessed(${globalIdx})">✓ סמני כטופל</button>
                        <button class="delete-btn" style="background-color: #7f8c8d; width:100%; display:block;" onclick="deleteContactMessage(${globalIdx})">🗑️ מחק סופית</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (processedMessages.length > 0) {
        contactHTML += `<tr class="table-group-header"><td colspan="6" style="background: #f2f9f5; font-weight: bold; color: #27ae60; text-align: center; padding-top: 15px;">✅ פניות ישנות שטופלו</td></tr>`;
        contactHTML += processedMessages.map((msg) => {
            const globalIdx = contactMessages.indexOf(msg);
            return `
                <tr style="background: #fdfdfd; opacity: 0.85;">
                    <td data-label="תאריך פנייה">${msg.timestamp}</td>
                    <td data-label="שם הלקוחה"><span style="background:#2ecc71; color:white; padding:3px 6px; border-radius:4px; font-size:11px; margin-left:5px;">טופל</span><span style="text-decoration: line-through; color: #7f8c8d;">${msg.name}</span></td>
                    <td data-label="טלפון">${msg.phone}</td>
                    <td data-label="אימייל">${msg.email || 'לא צוין'}</td>
                    <td data-label="הודעה / בקשה" style="max-width:300px; white-space: pre-wrap; color: #7f8c8d;">${msg.message}</td>
                    <td data-label="פעולות ניהול">
                        <button class="delete-btn" style="background-color: #c0392b; width:100%; display:block;" onclick="deleteContactMessage(${globalIdx})">🗑️ מחק סופית</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (contactMessages.length === 0) {
        contactHTML = `<tr><td colspan="6" style="text-align:center; color: var(--secondary);">אין הודעות חדשות או ישנות במערכת</td></tr>`;
    }

    document.getElementById('contact-messages-body').innerHTML = contactHTML;

    renderAppointmentsTable(filteredAppointments ? filteredAppointments : appointments);
    renderWeeklySlotsCalendar();
    renderWeeklyCalendar();
}

function markContactAsProcessed(index) {
    if (contactMessages[index]) {
        contactMessages[index].status = 'processed';
        uploadData();
    }
}

function deleteContactMessage(index) {
    if(confirm("האם למחוק את הפנייה הזו לחלוטין ובאופן סופי מהמערכת?")) {
        contactMessages.splice(index, 1);
        uploadData();
    }
}

function renderClientCalendar() {
    const container = document.getElementById('calendar-container');
    if (!container) return;
    container.innerHTML = '';
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const selectElem = document.getElementById('client-service');
    
    if (!selectElem || selectElem.options.length === 0 || selectElem.selectedIndex === -1) {
        container.innerHTML = '<p class="loading-text">אין שירותים זמינים לקביעה כעת.</p>';
        return;
    }
    
    const selectedDuration = parseInt(selectElem.value);
    const serviceName = selectElem.options[selectElem.selectedIndex].text.split(' (')[0];
    
    let calendarMap = {};
    
    availableSlots.filter(s => s.date >= todayStr).forEach(slot => {
        const normalizedDate = slot.date.replace(/\//g, '-');

        if (!calendarMap[normalizedDate]) calendarMap[normalizedDate] = [];
        
        let current = new Date(`${normalizedDate}T${slot.start}`);
        const endLimit = new Date(`${normalizedDate}T${slot.end}`);
        
        while (new Date(current.getTime() + selectedDuration * 60000) <= endLimit) {
            let timeStr = current.toTimeString().substring(0, 5);
            
            const proposedStart = new Date(`${normalizedDate}T${timeStr}`);
            const proposedEnd = new Date(proposedStart.getTime() + selectedDuration * 60000);

            // 1. סינון שעות שכבר עברו היום
            const isPastTime = (normalizedDate === todayStr && proposedStart <= now);

            // 2. בדיקת חפיפה מול תורים קיימים
            const isOverlapping = appointments.some(app => {
                if (app.date !== normalizedDate) return false;
                const appStart = new Date(`${normalizedDate}T${app.time}`);
                const appDuration = app.duration || 30;
                const appEnd = new Date(appStart.getTime() + appDuration * 60000);

                return proposedStart < appEnd && proposedEnd > appStart;
            });

            if (!isPastTime && !isOverlapping) {
                calendarMap[normalizedDate].push(timeStr);
            }
            
            current = new Date(current.getTime() + 15 * 60000);
        }
    });

    let hasSlots = false;
    for (let date in calendarMap) {
        if (calendarMap[date].length > 0) {
            hasSlots = true;
            const dayBucket = document.createElement('div');
            dayBucket.className = 'day-bucket';
            dayBucket.innerHTML = `<div class="day-title">📅 יום ${getDayNameFromDate(date)} (${formatDateToShort(date)})</div>
                <div class="time-slots-grid">${calendarMap[date].map(time => `<button class="time-btn" onclick="bookAppointment('${date}', '${time}', '${serviceName}', ${selectedDuration})">${time}</button>`).join('')}</div>`;
            container.appendChild(dayBucket);
        }
    }
    
    if (!hasSlots) {
        container.innerHTML = '<p class="loading-text">אין כרגע מועדים פנויים ביומן. מוזמנת להשאיר הודעה בלשונית צור קשר!</p>';
    }
}

// פונקציה שנקראת בלחיצה על שעה – פותחת חלון אישור מקדים לפני תפיסת המועד
function bookAppointment(date, time, serviceName, duration) {
    const clientName = document.getElementById('client-name').value.trim();
    const phone = document.getElementById('client-phone').value.trim();
    const clientEmail = document.getElementById('client-email').value.trim();
    const note = document.getElementById('client-notes').value.trim();

    if (!clientName || !phone) {
        alert("אנא מלאי שם מלא ומספר טלפון לפני בחירת שעה.");
        return;
    }

    // יצירת אלמנט המודאל (חלון קופץ) דינאמית
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    modalOverlay.id = 'confirmation-modal';

    modalOverlay.innerHTML = `
        <div class="modal-content">
            <h3>✨ אישור פרטי הפגישה</h3>
            <p style="color: var(--secondary); margin-bottom: 15px; font-size: 14px;">אנא ודאי שהפרטים נכונים לפני אישור סופי:</p>
            <div style="background: var(--light-pink); padding: 12px; border-radius: 8px; font-size: 15px; line-height: 1.6; margin-bottom: 15px;">
                <strong>שם:</strong> ${clientName}<br>
                <strong>טלפון:</strong> ${phone}<br>
                <strong>שירות:</strong> ${serviceName} (${duration} דקות)<br>
                <strong>תאריך:</strong> ${formatDateToShort(date)}<br>
                <strong>שעה:</strong> ${time}
                ${note ? `<br><strong>הערה:</strong> ${note}` : ''}
            </div>
            <p style="font-size: 13px; color: #666; margin-bottom: 20px;">האם לאשר את קביעת התור?</p>
            <div class="modal-buttons">
                <button class="modal-confirm-btn" onclick="confirmAndBookAppointment('${date}', '${time}', '${serviceName}', ${duration})">כן, קבע תור ✓</button>
                <button class="modal-cancel-btn" onclick="closeConfirmationModal()">ביטול ❌</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);
}

// סגירת חלון האישור בלי לתפוס את המועד
function closeConfirmationModal() {
    const modal = document.getElementById('confirmation-modal');
    if (modal) modal.remove();
}

// ביצוע השמירה בפועל רק לאחר אישור הלקוחה במודאל
function confirmAndBookAppointment(date, time, serviceName, duration) {
    closeConfirmationModal();

    const clientName = document.getElementById('client-name').value.trim();
    const phone = document.getElementById('client-phone').value.trim();
    const clientEmail = document.getElementById('client-email').value.trim();
    const note = document.getElementById('client-notes').value.trim();

    const proposedStart = new Date(`${date}T${time}`);
    const proposedEnd = new Date(proposedStart.getTime() + duration * 60000);

    db.ref('yulas_data/appointments').transaction((apps) => {
        apps = apps || [];
        
        // בדיקת חפיפה בזמן אמת מול בסיס הנתונים ברגע הלחיצה על "כן"
        const hasOverlap = apps.some(app => {
            if (app.date !== date) return false;
            const appStart = new Date(`${date}T${app.time}`);
            const appDuration = app.duration || 30;
            const appEnd = new Date(appStart.getTime() + appDuration * 60000);

            return proposedStart < appEnd && proposedEnd > appStart;
        });

        if (hasOverlap) return; // ביטול אם נוצרה חפיפה ברגע האחרון
        
        const randomId = "YULA-" + Math.floor(1000 + Math.random() * 9000);
        const newApp = { id: randomId, date, time, clientName, phone, clientEmail: clientEmail || 'לא צוין', serviceName, duration, note };
        apps.push(newApp);
        return apps;
    }, (error, committed, snapshot) => {
        if (committed) {
            const apps = snapshot.val();
            const lastApp = apps[apps.length - 1];

            fetch(`${RENDER_SERVER_URL}/send-appointment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: lastApp.phone,
                    name: lastApp.clientName,
                    date: formatDateToShort(lastApp.date),
                    time: lastApp.time,
                    serviceName: lastApp.serviceName,
                    appointmentId: lastApp.id,
                    note: lastApp.note
                })
            })
            .then(res => res.json())
            .then(data => console.log('סטטוס שליחת וואטסאפ (תור):', data))
            .catch(err => console.error('שגיאה בשליחת הוואטסאפ (תור):', err));

            document.getElementById('success-title').innerText = "🎉 התור נקבע בהצלחה!";
            document.getElementById('success-message-text').innerHTML = `
                שירות: ${lastApp.serviceName}<br>
                תאריך: ${formatDateToShort(lastApp.date)}<br>
                שעה: ${lastApp.time}<br>
                <br>
                קוד ביטול: <span style="color:red; font-size:18px;">${lastApp.id}</span><br><br>
                <strong>הודעת אישור נשלחה אוטומטית לוואטסאפ של הלקוחה! 📱</strong>
            `;
            
            document.getElementById('success-panel').style.display = 'block';
            document.getElementById('client-name').value = '';
            document.getElementById('client-phone').value = '';
            document.getElementById('client-email').value = '';
            document.getElementById('client-notes').value = '';
        } else {
            alert("מצטערים, התור נתפס או חופף לתור אחר שנרשם ברגע זה. אנא בחרי שעה אחרת.");
        }
    });
}

function submitContactForm() {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const message = document.getElementById('contact-message').value.trim();

    if (!name || !phone || !message) {
        return alert("אנא מלאי שם, טלפון ותוכן הודעה.");
    }

    const now = new Date();
    const timestampStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const newContactMessage = { 
        name, 
        phone, 
        email: email || 'לא צוין', 
        message, 
        timestamp: timestampStr, 
        status: 'new' 
    };
    
    contactMessages.push(newContactMessage);
    uploadData();

    fetch(`${RENDER_SERVER_URL}/send-inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            phone: phone,
            name: name,
            description: message
        })
    })
    .then(res => res.json())
    .then(data => console.log('סטטוס שליחת וואטסאפ (פנייה):', data))
    .catch(err => console.error('שגיאה בשליחת הוואטסאפ (פנייה):', err));

    document.getElementById('success-title').innerText = "✉️ ההודעה נשלחה בהצלחה!";
    document.getElementById('success-message-text').innerHTML = `
        תודה לך, <strong>${name}</strong>.<br>
        פנייתך התקבלה בהצלחה והועברה לטיפול הסטודיו. הודעת אישור נשלחה לוואטסאפ שלך.
    `;
    document.getElementById('success-panel').style.display = 'block';

    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-message').value = '';
}

function closeSuccessPanel() { document.getElementById('success-panel').style.display = 'none'; }

function adminCancelAppointment(index) { appointments.splice(index, 1); uploadData(); }

function clientCancelAppointment() {
    const code = document.getElementById('cancel-code-input').value.trim().toUpperCase();
    const index = appointments.findIndex(app => app.id === code);
    if (index === -1) return alert("קוד לא נמצא.");
    appointments.splice(index, 1);
    uploadData();
    alert("בוטל בהצלחה!");
}

function renderWeeklyCalendar() {
    const container = document.getElementById('weekly-calendar-container');
    if (!container) return;
    container.innerHTML = '';
    
    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date(currentCalendarStartDate);
    
    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + i);
        const dateStr = day.toISOString().split('T')[0];
        
        if (dateStr < today) continue; 
        
        const dayCol = document.createElement('div');
        dayCol.className = 'calendar-day-col';
        dayCol.innerHTML = `<h4>${daysOfWeek[day.getDay()]}<br>${formatDateToShort(dateStr)}</h4>`;
        
        appointments.filter(app => app.date === dateStr).forEach(app => {
            dayCol.innerHTML += `<div class="calendar-appointment-card"><strong>${app.time}</strong><br>${app.clientName}</div>`;
        });
        container.appendChild(dayCol);
    }
}

function renderWeeklySlotsCalendar() {
    const container = document.getElementById('weekly-slots-container');
    if (!container) return;
    container.innerHTML = '';
    
    const today = new Date().toISOString().split('T')[0];
    const weekStart = new Date(currentCalendarStartDate);
    
    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + i);
        const dateStr = day.toISOString().split('T')[0];
        
        if (dateStr < today) continue;
        
        const dayCol = document.createElement('div');
        dayCol.className = 'calendar-day-col';
        dayCol.innerHTML = `<h4>${daysOfWeek[day.getDay()]}<br>${formatDateToShort(dateStr)}</h4>`;
        
        availableSlots.filter(s => s.date === dateStr).forEach(s => {
            dayCol.innerHTML += `<div class="calendar-slot-card">${s.start}-${s.end}</div>`;
        });
        container.appendChild(dayCol);
    }
}

let filteredAppointments = null;
function filterAppointmentsByDate() {
    const rawDate = document.getElementById('appointment-filter-date').value.trim();
    const parts = rawDate.split('/');

    if (parts.length !== 3) {
        alert("פורמט לא תקין. נקלט: " + rawDate);
        return;
    }

    const day = parts[0].padStart(2,'0');
    const month = parts[1].padStart(2,'0');
    let year = parts[2];

    if (year && year.length === 2) {
        year = "20" + year;
    }

    const selectedDate = `${year}-${month}-${day}`;

    filteredAppointments = appointments.filter(app => app.date === selectedDate);
    renderAppointmentsTable(filteredAppointments);

    if (filteredAppointments.length === 0) {
        alert("לא נמצאו פגישות לתאריך " + rawDate);
    }
}

function showAllAppointments() {
    filteredAppointments = null;
    renderAppointmentsTable(appointments);
}

function renderAppointmentsTable(data) {
    document.getElementById('appointments-table-body').innerHTML =
        data.map((app) => `
        <tr>
            <td data-label="קוד תור">${app.id}</td>
            <td data-label="תאריך ושעה">${formatDateToShort(app.date)}<br>${app.time}</td>
            <td data-label="שם הלקוח">${app.clientName}</td>
            <td data-label="טלפון / מייל">${app.phone}<br>${app.clientEmail && app.clientEmail !== 'לא צוין' ? app.clientEmail : ''}</td>
            <td data-label="שירות (הערה)">${app.serviceName}</td>
            <td data-label="אורך">${app.duration || ''} דק'</td>
            <td data-label="ניהול פגישה">
                <button class="delete-btn" onclick="adminCancelAppointment(${appointments.indexOf(app)})">❌</button>
            </td>
        </tr>
    `).join('');
}
