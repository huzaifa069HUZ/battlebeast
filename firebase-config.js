// firebase-config.js — Firebase Admin SDK Initialization
const admin = require('firebase-admin');

let db;

function initializeFirebase() {
    if (db) return db;

    let serviceAccount;

    // Try environment variable first (for Render deployment)
    if (process.env.FIREBASE_CONFIG) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        } catch (e) {
            console.error('❌ Failed to parse FIREBASE_CONFIG env variable:', e.message);
            process.exit(1);
        }
    } else {
        // Fallback to local file (for local development)
        try {
            serviceAccount = require('./active-commerce-5f4a4-firebase-adminsdk-fbsvc-0007bad1a8.json');
        } catch (e) {
            console.error('❌ Firebase service account key not found. Set FIREBASE_CONFIG env var or place the JSON file locally.');
            process.exit(1);
        }
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });

    db = admin.firestore();
    console.log('🔥 Firebase Firestore initialized successfully!');
    return db;
}

function getDb() {
    if (!db) {
        return initializeFirebase();
    }
    return db;
}

module.exports = { initializeFirebase, getDb };
