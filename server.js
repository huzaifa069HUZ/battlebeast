// server.js — Battle Beast Gym Backend
// Features: Contact form email, Member CRUD, WhatsApp Bot, Reminder Engine

// --- 1. Import Required Packages ---
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

// --- Custom Modules ---
const { initializeFirebase, getDb } = require('./firebase-config');
const { connectWhatsApp, sendWhatsAppMessage, getConnectionStatus } = require('./whatsapp-bot');
const { checkAndSendReminders, startReminderCron, sendRenewalMessage } = require('./reminder-engine');

// --- 2. Initialize the Application ---
const app = express();
const PORT = process.env.PORT || 3005;

// Admin password from environment variable
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'battlebeast2024';

// Store active admin tokens (in-memory, cleared on restart)
const activeTokens = new Set();

// --- 3. Configure Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// --- 4. Initialize Firebase ---
initializeFirebase();

// --- 5. Start WhatsApp Bot ---
connectWhatsApp();

// --- 6. Start Reminder Cron Job ---
startReminderCron();

// --- 7. Email Transporter (existing contact form) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'huzaifatabish9145@gmail.com',
        pass: process.env.EMAIL_PASS || 'wusb hzli xnzk onuj'
    }
});

// ============================================================
// AUTH MIDDLEWARE — Protects all /api/ routes
// ============================================================
function requireAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !activeTokens.has(token)) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }
    next();
}

// ============================================================
// EXISTING ROUTE — Contact Form Email
// ============================================================
app.post('/send-message', (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    const mailOptions = {
        from: `"${name}" <${email}>`,
        to: 'huzaifatabish9145@gmail.com',
        subject: `New Contact Form Message from ${name}`,
        text: `You have received a new message from your website contact form.\n\n` +
              `Name: ${name}\n` +
              `Email: ${email}\n` +
              `Message: ${message}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            return res.status(500).json({ error: 'Failed to send message. Please try again later.' });
        }
        console.log('Email sent: ' + info.response);
        res.status(200).json({ success: 'Message sent successfully!' });
    });
});

// ============================================================
// ADMIN AUTH ROUTES
// ============================================================

// POST /api/admin/login — Verify admin password
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Password is required.' });
    }

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password.' });
    }

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.add(token);

    // Auto-expire token after 24 hours
    setTimeout(() => {
        activeTokens.delete(token);
    }, 24 * 60 * 60 * 1000);

    console.log('🔐 Admin logged in successfully.');
    res.json({ success: true, token });
});

// POST /api/admin/logout — Invalidate token
app.post('/api/admin/logout', requireAuth, (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    activeTokens.delete(token);
    res.json({ success: true });
});

// ============================================================
// MEMBER CRUD ROUTES (all protected)
// ============================================================

// GET /api/members — Get all members
app.get('/api/members', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const snapshot = await db.collection('members').orderBy('createdAt', 'desc').get();
        const members = [];

        snapshot.forEach(doc => {
            members.push({ id: doc.id, ...doc.data() });
        });

        // Auto-update statuses
        const today = getTodayIST();
        for (const member of members) {
            const newStatus = calculateStatus(member.endDate, today);
            if (member.status !== newStatus) {
                await db.collection('members').doc(member.id).update({ status: newStatus });
                member.status = newStatus;
            }
        }

        res.json({ success: true, members });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ error: 'Failed to fetch members.' });
    }
});

// POST /api/members — Add a new member
app.post('/api/members', requireAuth, async (req, res) => {
    try {
        const { name, whatsapp, dateJoined, moneyPaid } = req.body;

        // Validation
        if (!name || !whatsapp || !dateJoined || !moneyPaid) {
            return res.status(400).json({ error: 'All fields are required: name, whatsapp, dateJoined, moneyPaid' });
        }

        // Clean the WhatsApp number — ensure it has country code
        let cleanWhatsapp = whatsapp.replace(/[\s\-\(\)\+]/g, '');
        if (cleanWhatsapp.startsWith('0')) {
            cleanWhatsapp = '91' + cleanWhatsapp.substring(1);
        }
        if (cleanWhatsapp.length === 10) {
            cleanWhatsapp = '91' + cleanWhatsapp;
        }

        // Auto-calculate end date based on money paid (₹1000/month = 30 days)
        const monthsPaid = Math.floor(Number(moneyPaid) / 1000);
        const daysToAdd = monthsPaid * 30;
        const joinDate = parseDate(dateJoined);
        const endDate = addDays(joinDate, daysToAdd);
        const endDateStr = getDateString(endDate);

        const today = getTodayIST();
        const status = calculateStatus(endDateStr, today);

        const memberData = {
            name: name.trim(),
            whatsapp: cleanWhatsapp,
            dateJoined,
            moneyPaid: Number(moneyPaid),
            endDate: endDateStr,
            status,
            createdAt: new Date().toISOString(),
            remindersSent: {
                welcome: false,
                threeDayWarning: false,
                oneDayWarning: false,
                expiry: false
            }
        };

        const db = getDb();
        const docRef = await db.collection('members').add(memberData);

        console.log(`➕ New member added: ${name} (${cleanWhatsapp}) — expires ${endDateStr}`);
        res.json({ success: true, id: docRef.id, member: { id: docRef.id, ...memberData } });

    } catch (error) {
        console.error('Error adding member:', error);
        res.status(500).json({ error: 'Failed to add member.' });
    }
});

// PUT /api/members/:id — Update a member
app.put('/api/members/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, whatsapp, dateJoined, moneyPaid } = req.body;

        const updateData = {};

        if (name) updateData.name = name.trim();
        if (whatsapp) {
            let cleanWhatsapp = whatsapp.replace(/[\s\-\(\)\+]/g, '');
            if (cleanWhatsapp.startsWith('0')) cleanWhatsapp = '91' + cleanWhatsapp.substring(1);
            if (cleanWhatsapp.length === 10) cleanWhatsapp = '91' + cleanWhatsapp;
            updateData.whatsapp = cleanWhatsapp;
        }

        // Recalculate end date if dateJoined or moneyPaid changed
        if (dateJoined || moneyPaid) {
            const db = getDb();
            const doc = await db.collection('members').doc(id).get();
            if (!doc.exists) {
                return res.status(404).json({ error: 'Member not found.' });
            }
            const existing = doc.data();
            const newDateJoined = dateJoined || existing.dateJoined;
            const newMoneyPaid = moneyPaid ? Number(moneyPaid) : existing.moneyPaid;

            const monthsPaid = Math.floor(newMoneyPaid / 1000);
            const daysToAdd = monthsPaid * 30;
            const joinDateObj = parseDate(newDateJoined);
            const endDate = addDays(joinDateObj, daysToAdd);
            const endDateStr = getDateString(endDate);

            updateData.dateJoined = newDateJoined;
            updateData.moneyPaid = newMoneyPaid;
            updateData.endDate = endDateStr;
            updateData.status = calculateStatus(endDateStr, getTodayIST());

            // Reset reminders if dates changed so reminders can be re-sent
            updateData.remindersSent = { welcome: false, threeDayWarning: false, oneDayWarning: false, expiry: false };

            // If money paid increased, send renewal message
            if (newMoneyPaid > existing.moneyPaid) {
                const renewedMember = { id, ...existing, ...updateData };
                sendRenewalMessage(renewedMember).catch(err => console.error('Error sending renewal message:', err));
            }
        }

        const db = getDb();
        await db.collection('members').doc(id).update(updateData);

        console.log(`✏️ Member updated: ${id}`);
        res.json({ success: true });

    } catch (error) {
        console.error('Error updating member:', error);
        res.status(500).json({ error: 'Failed to update member.' });
    }
});

// DELETE /api/members/:id — Delete a member
app.delete('/api/members/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const doc = await db.collection('members').doc(id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Member not found.' });
        }

        await db.collection('members').doc(id).delete();
        console.log(`🗑️ Member deleted: ${id} (${doc.data().name})`);
        res.json({ success: true });

    } catch (error) {
        console.error('Error deleting member:', error);
        res.status(500).json({ error: 'Failed to delete member.' });
    }
});

// ============================================================
// STATS & REMINDERS
// ============================================================

// GET /api/stats — Dashboard statistics
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const snapshot = await db.collection('members').get();
        const today = getTodayIST();

        let total = 0, active = 0, expiringSoon = 0, expired = 0;

        snapshot.forEach(doc => {
            const member = doc.data();
            total++;
            const status = calculateStatus(member.endDate, today);
            if (status === 'active') active++;
            else if (status === 'expiring_soon') expiringSoon++;
            else if (status === 'expired') expired++;
        });

        const whatsappStatus = getConnectionStatus();

        res.json({
            success: true,
            stats: { total, active, expiringSoon, expired },
            whatsapp: whatsappStatus
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// GET /api/check-reminders — Manually trigger reminder check (also used by cron-job.org)
app.get('/api/check-reminders', async (req, res) => {
    console.log('🔔 Manual reminder check triggered');
    const result = await checkAndSendReminders();
    res.json(result);
});

// GET /api/whatsapp/status — Check WhatsApp bot connection
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
    const status = getConnectionStatus();
    res.json({ success: true, ...status });
});

// POST /api/whatsapp/connect — Trigger WhatsApp connection
app.post('/api/whatsapp/connect', requireAuth, async (req, res) => {
    try {
        // Disconnect first to ensure a clean slate
        const { disconnectAndClean } = require('./whatsapp-bot');
        await disconnectAndClean();
        
        // Wait a second before reconnecting
        setTimeout(() => {
            connectWhatsApp();
        }, 1000);
        
        res.json({ success: true, message: 'Connection initiated.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/whatsapp/disconnect — Log out and wipe session
app.post('/api/whatsapp/disconnect', requireAuth, async (req, res) => {
    try {
        const { disconnectAndClean } = require('./whatsapp-bot');
        await disconnectAndClean();
        res.json({ success: true, message: 'Disconnected and session cleared.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/whatsapp/test — Send a test message
app.post('/api/whatsapp/test', requireAuth, async (req, res) => {
    const { phoneNumber, message } = req.body;
    if (!phoneNumber || !message) {
        return res.status(400).json({ error: 'phoneNumber and message are required.' });
    }

    let cleanNumber = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;

    const sent = await sendWhatsAppMessage(cleanNumber, message);
    res.json({ success: sent });
});

// ============================================================
// HEALTH CHECK (keeps server awake on Render free tier)
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'Battle Beast Gym Server is running 🏋️',
        whatsapp: getConnectionStatus(),
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function getTodayIST() {
    const now = new Date();
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().split('T')[0];
}

function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calculateStatus(endDateStr, todayStr) {
    const endDate = parseDate(endDateStr);
    const today = parseDate(todayStr);
    const threeDaysFromNow = addDays(today, 3);

    if (endDate < today) return 'expired';
    if (endDate <= threeDaysFromNow) return 'expiring_soon';
    return 'active';
}

// --- 8. Start the Server ---
app.listen(PORT, () => {
    console.log(`\n🏋️ Battle Beast Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/`);
    console.log(`📍 Admin API:    http://localhost:${PORT}/api/\n`);
});
