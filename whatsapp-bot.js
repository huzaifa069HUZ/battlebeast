// whatsapp-bot.js — Baileys WhatsApp Bot Connection & Messaging
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const readline = require('readline');

let sock = null;
let isConnected = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// State for Admin UI
let currentQR = null;
let currentPairingCode = null;
let connectionError = null;

// Auth info directory — stores WhatsApp session
const AUTH_DIR = path.join(__dirname, 'auth_info');

// Phone number for pairing (set via environment variable or here)
// Format: country code + number, no + sign. e.g. "919876543210"
const PAIRING_PHONE = process.env.WA_PHONE_NUMBER || '';

/**
 * Initialize and connect the WhatsApp bot.
 * Uses pairing code method — you'll get a code to enter in WhatsApp.
 */
async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();

        console.log(`📱 Using Baileys version: ${version.join('.')}`);

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Battle Beast Gym', 'Chrome', '120.0.0'],
            version,
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQR = qr;
                currentPairingCode = null;
                connectionError = null;
            }

            // If we get a QR code, try pairing code method instead
            if (qr && !sock.authState.creds.registered) {
                if (PAIRING_PHONE) {
                    try {
                        const code = await sock.requestPairingCode(PAIRING_PHONE);
                        currentPairingCode = code;
                        currentQR = null;
                        console.log('\n📱 ====================================');
                        console.log(`📱 PAIRING CODE: ${code}`);
                        console.log('📱 Open WhatsApp → Settings → Linked Devices');
                        console.log('📱 → Link a Device → Link with phone number');
                        console.log(`📱 Enter this code: ${code}`);
                        console.log('📱 ====================================\n');
                    } catch (pairErr) {
                        console.log('⚠️ Pairing code failed, showing QR instead...');
                        showQR(qr);
                    }
                } else {
                    showQR(qr);
                    console.log('\n💡 TIP: Set WA_PHONE_NUMBER env var (e.g. 919876543210) to use pairing code instead of QR.');
                }
            }

            if (connection === 'close') {
                isConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`⚠️ WhatsApp disconnected. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    connectionError = 'Logged out. Please click "Disconnect & Reset" and pair again.';
                } else if (connectionRetries >= MAX_RETRIES) {
                    connectionError = 'Max connection attempts reached. Server requires restart or reset.';
                }

                if (shouldReconnect && connectionRetries < MAX_RETRIES) {
                    connectionRetries++;
                    const delayMs = Math.min(connectionRetries * 5000, 30000);
                    console.log(`🔄 Reconnecting in ${delayMs / 1000}s... (attempt ${connectionRetries}/${MAX_RETRIES})`);
                    setTimeout(connectWhatsApp, delayMs);
                } else if (!shouldReconnect) {
                    console.log('🚪 Logged out from WhatsApp. Please restart server and re-pair.');
                } else {
                    console.log('❌ Max reconnection attempts reached. Restart the server to try again.');
                }
            } else if (connection === 'open') {
                isConnected = true;
                connectionRetries = 0;
                currentQR = null;
                currentPairingCode = null;
                connectionError = null;
                console.log('✅ WhatsApp Bot Connected Successfully!');
            }
        });

        // Save credentials whenever they update (critical for maintaining session)
        sock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error('❌ Failed to connect WhatsApp:', error.message);
        connectionError = error.message;
        if (connectionRetries < MAX_RETRIES) {
            connectionRetries++;
            setTimeout(connectWhatsApp, 10000);
        }
    }
}

/**
 * Display QR code in terminal
 */
function showQR(qr) {
    try {
        const qrcodeTerminal = require('qrcode-terminal');
        console.log('\n📱 ====================================');
        console.log('📱 SCAN THIS QR CODE WITH WHATSAPP');
        console.log('📱 Settings → Linked Devices → Link a Device');
        console.log('📱 ====================================\n');
        qrcodeTerminal.generate(qr, { small: true });
    } catch (e) {
        console.log('\n📱 QR CODE STRING (use a QR scanner):');
        console.log(qr);
    }
}

/**
 * Send a WhatsApp message to a phone number.
 * @param {string} phoneNumber - Phone number WITH country code, e.g. "919876543210"
 * @param {string} messageText - The message to send
 * @returns {Promise<boolean>} - true if sent successfully
 */
async function sendWhatsAppMessage(phoneNumber, messageText) {
    if (!sock || !isConnected) {
        console.error('❌ WhatsApp not connected. Cannot send message.');
        return false;
    }

    try {
        const jid = `${phoneNumber}@s.whatsapp.net`;

        // Simulate typing delay (anti-ban measure)
        try {
            await sock.presenceSubscribe(jid);
            await delay(randomDelay(1000, 3000));
            await sock.sendPresenceUpdate('composing', jid);
            await delay(randomDelay(2000, 4000));
        } catch (presenceErr) {
            // Presence updates may fail silently
        }

        // Send the message
        await sock.sendMessage(jid, { text: messageText });

        // Clear typing indicator
        try { await sock.sendPresenceUpdate('paused', jid); } catch (e) { /* ignore */ }

        console.log(`✅ Message sent to ${phoneNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send message to ${phoneNumber}:`, error.message);
        return false;
    }
}

/**
 * Check if the WhatsApp bot is currently connected.
 */
function getConnectionStatus() {
    return {
        connected: isConnected,
        retries: connectionRetries,
        qr: currentQR,
        pairingCode: currentPairingCode,
        error: connectionError
    };
}

/**
 * Log out and delete the session.
 */
async function disconnectAndClean() {
    const fs = require('fs');
    try {
        if (sock) {
            await sock.logout();
        }
    } catch (e) {
        console.error('Logout error:', e.message);
    }
    
    sock = null;
    isConnected = false;
    currentQR = null;
    currentPairingCode = null;
    connectionError = null;
    connectionRetries = 0;

    if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    console.log('🧹 WhatsApp session cleared successfully.');
}

// --- Utility functions ---
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    connectWhatsApp,
    sendWhatsAppMessage,
    getConnectionStatus,
    disconnectAndClean,
    delay,
    randomDelay
};
