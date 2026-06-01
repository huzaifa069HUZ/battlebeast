const { proto } = require('@whiskeysockets/baileys/WAProto');
const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Custom Baileys Auth State using Firebase Firestore
 * This prevents QR code logouts on serverless platforms with ephemeral file systems.
 * 
 * @param {Object} db - Firestore database instance
 * @param {string} sessionName - Collection name to store keys (default: 'whatsapp_auth')
 */
const useFirebaseAuthState = async (db, sessionName = 'whatsapp_auth') => {
    const collection = db.collection(sessionName);

    const writeData = async (data, id) => {
        try {
            // Baileys provides BufferJSON to properly serialize buffers/Uint8Arrays
            const json = JSON.stringify(data, BufferJSON.replacer);
            await collection.doc(id).set({ data: json });
        } catch (error) {
            console.error(`Firebase Write Error (${id}):`, error.message);
        }
    };

    const readData = async (id) => {
        try {
            const doc = await collection.doc(id).get();
            if (doc.exists) {
                const json = doc.data().data;
                return JSON.parse(json, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            console.error(`Firebase Read Error (${id}):`, error.message);
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await collection.doc(id).delete();
        } catch (error) {
            // Ignore if doc doesn't exist
        }
    };

    // 1. Fetch existing credentials or initialize new ones
    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                // 2. Fetch keys dynamically from Firestore
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                // 3. Save or delete keys to/from Firestore
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const docId = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, docId));
                            } else {
                                tasks.push(removeData(docId));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

module.exports = { useFirebaseAuthState };
