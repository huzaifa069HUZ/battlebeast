// reminder-engine.js — Automated Daily Reminder System
const cron = require('node-cron');
const { getDb } = require('./firebase-config');
const { sendWhatsAppMessage, getConnectionStatus, delay, randomDelay } = require('./whatsapp-bot');

// --- Message Templates ---
function getWelcomeMessage(member) {
    return `🏋️ *Welcome to BATTLE BEAST Gym, ${member.name}!* 💪

Your membership is now active ✅
📅 Start: ${formatDate(member.dateJoined)}
📅 Valid until: ${formatDate(member.endDate)}
💰 Paid: ₹${member.moneyPaid}

Stay consistent, stay BEAST! 🔥
📞 Contact: +91 92414 04105`;
}

function getThreeDayWarningMessage(member) {
    return `⚠️ *Hey ${member.name}!*

Your BATTLE BEAST membership expires in *3 days!*
📅 Expiry: ${formatDate(member.endDate)}

Renew now to keep your gains going 💪
Visit the gym or call us:
📞 +91 92414 04105
📍 Bailey Road, Patna`;
}

function getOneDayWarningMessage(member) {
    return `🚨 *URGENT: ${member.name}!*

Your BATTLE BEAST membership expires *TOMORROW!*
📅 Expiry: ${formatDate(member.endDate)}

Please renew today to avoid any interruption in your workouts 💪
📞 +91 92414 04105
📍 Bailey Road, Patna`;
}

function getExpiryMessage(member) {
    return `🔴 *${member.name}*, your BATTLE BEAST membership has expired today.
📅 Expired: ${formatDate(member.endDate)}

Don't let your hard work go to waste!
Renew immediately ➡️ ₹1000/month

📞 +91 92414 04105
See you at the gym! 🏋️💪`;
}

function getRenewalMessage(member) {
    return `🎉 *Thank You for Renewing, ${member.name}!* 💪

Your payment of ₹${member.moneyPaid} has been received.
Your BATTLE BEAST membership has been extended! ✅
📅 New Expiry Date: ${formatDate(member.endDate)}

Keep crushing those goals! 🔥
📞 +91 92414 04105`;
}

async function sendRenewalMessage(member) {
    console.log(`🎉 Sending RENEWAL receipt to ${member.name} (${member.whatsapp})`);
    return await sendWhatsAppMessage(member.whatsapp, getRenewalMessage(member));
}

// --- Core Reminder Logic ---

let isCheckingReminders = false;

/**
 * Check all members and send due reminders.
 * Called by cron job daily at 9 AM IST, or via /api/check-reminders endpoint.
 */
async function checkAndSendReminders() {
    if (isCheckingReminders) {
        console.log('⚠️ Reminder check is already in progress. Skipping duplicate request.');
        return { success: false, reason: 'Reminder check already in progress', sent: 0 };
    }
    isCheckingReminders = true;

    try {
        const botStatus = getConnectionStatus();
        if (!botStatus.connected) {
            console.log('⚠️ WhatsApp bot not connected. Skipping reminder check.');
            isCheckingReminders = false;
            return { success: false, reason: 'WhatsApp not connected', sent: 0 };
        }

    const db = getDb();
    const today = getTodayIST();
    const threeDaysFromNow = getDateString(addDays(parseDate(today), 3));
    const oneDayFromNow = getDateString(addDays(parseDate(today), 1));

    console.log(`\n🔔 ===== REMINDER CHECK: ${today} =====`);
    console.log(`📅 Today: ${today}`);
    console.log(`📅 1 day from now: ${oneDayFromNow}`);
    console.log(`📅 3 days from now: ${threeDaysFromNow}`);

    let totalSent = 0;
    const results = { welcome: [], threeDayWarning: [], oneDayWarning: [], expiry: [], statusUpdates: [] };

        const membersSnapshot = await db.collection('members').get();

        if (membersSnapshot.empty) {
            console.log('📭 No members found in database.');
            return { success: true, sent: 0, results };
        }

        for (const doc of membersSnapshot.docs) {
            const member = { id: doc.id, ...doc.data() };
            const reminders = member.remindersSent || {};

            // 1. WELCOME — joined today, welcome not yet sent
            if (member.dateJoined === today && !reminders.welcome) {
                console.log(`🟢 Sending WELCOME to ${member.name} (${member.whatsapp})`);
                const sent = await sendWhatsAppMessage(member.whatsapp, getWelcomeMessage(member));
                if (sent) {
                    await db.collection('members').doc(doc.id).update({
                        'remindersSent.welcome': true
                    });
                    results.welcome.push(member.name);
                    totalSent++;
                }
                // Anti-ban: wait 5-15 seconds between messages
                await delay(randomDelay(5000, 15000));
            }

            // 2. THREE-DAY WARNING — endDate is 3 days from now, warning not yet sent
            if (member.endDate === threeDaysFromNow && !reminders.threeDayWarning) {
                console.log(`🟡 Sending 3-DAY WARNING to ${member.name} (${member.whatsapp})`);
                const sent = await sendWhatsAppMessage(member.whatsapp, getThreeDayWarningMessage(member));
                if (sent) {
                    await db.collection('members').doc(doc.id).update({
                        'remindersSent.threeDayWarning': true
                    });
                    results.threeDayWarning.push(member.name);
                    totalSent++;
                }
                await delay(randomDelay(5000, 15000));
            }

            // 2.5 ONE-DAY WARNING — endDate is tomorrow, warning not yet sent
            if (member.endDate === oneDayFromNow && !reminders.oneDayWarning) {
                console.log(`🚨 Sending 1-DAY WARNING to ${member.name} (${member.whatsapp})`);
                const sent = await sendWhatsAppMessage(member.whatsapp, getOneDayWarningMessage(member));
                if (sent) {
                    await db.collection('members').doc(doc.id).update({
                        'remindersSent.oneDayWarning': true
                    });
                    results.oneDayWarning.push(member.name);
                    totalSent++;
                }
                await delay(randomDelay(5000, 15000));
            }

            // 3. EXPIRY — endDate is today, expiry message not yet sent
            if (member.endDate === today && !reminders.expiry) {
                console.log(`🔴 Sending EXPIRY notice to ${member.name} (${member.whatsapp})`);
                const sent = await sendWhatsAppMessage(member.whatsapp, getExpiryMessage(member));
                if (sent) {
                    await db.collection('members').doc(doc.id).update({
                        'remindersSent.expiry': true,
                        'status': 'expired'
                    });
                    results.expiry.push(member.name);
                    totalSent++;
                }
                await delay(randomDelay(5000, 15000));
            }

            // 4. AUTO-UPDATE STATUS (no message, just status change)
            if (member.status !== 'expired' && isDatePast(member.endDate, today)) {
                await db.collection('members').doc(doc.id).update({ status: 'expired' });
                results.statusUpdates.push(member.name);
            } else if (member.status !== 'expiring_soon' && member.endDate === threeDaysFromNow) {
                await db.collection('members').doc(doc.id).update({ status: 'expiring_soon' });
            }
        }

        console.log(`\n✅ Reminder check complete. Messages sent: ${totalSent}`);
        console.log(`   Welcome: ${results.welcome.length}, 3-Day Warnings: ${results.threeDayWarning.length}, 1-Day Warnings: ${results.oneDayWarning.length}, Expiry: ${results.expiry.length}`);
        console.log(`   Status updates: ${results.statusUpdates.length}\n`);

        return { success: true, sent: totalSent, results };

    } catch (error) {
        console.error('❌ Reminder check failed:', error.message);
        return { success: false, reason: error.message, sent: totalSent || 0 };
    } finally {
        isCheckingReminders = false;
    }
}

/**
 * Start the cron job to run daily at 9:00 AM IST (3:30 UTC).
 */
function startReminderCron() {
    // 9:00 AM IST = 3:30 AM UTC
    cron.schedule('30 3 * * *', async () => {
        console.log('\n⏰ CRON JOB TRIGGERED — Running daily reminder check...');
        await checkAndSendReminders();
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('⏰ Reminder cron job scheduled — runs daily at 9:00 AM IST');
}

// --- Date Utility Functions ---

function getTodayIST() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
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

function formatDate(dateStr) {
    const date = parseDate(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function isDatePast(dateStr, todayStr) {
    return parseDate(dateStr) < parseDate(todayStr);
}

module.exports = {
    checkAndSendReminders,
    startReminderCron,
    sendRenewalMessage
};
