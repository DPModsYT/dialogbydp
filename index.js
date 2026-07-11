const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// ये Variables हम Render Dashboard से लेंगे (कोड में यहाँ कुछ नहीं बदलना है)
const BOT_TOKEN = process.env.BOT_TOKEN; 
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const FIREBASE_CONFIG_BASE64 = process.env.FIREBASE_CONFIG_BASE64;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// Firebase Setup
const serviceAccount = JSON.parse(Buffer.from(FIREBASE_CONFIG_BASE64, 'base64').toString('utf-8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// API: Request Approval (App -> Server)
app.post('/api/request', async (req, res) => {
    const { hwid, model } = req.body;
    if (!hwid) return res.status(400).json({ success: false });

    const docRef = db.collection('users').doc(hwid);
    const doc = await docRef.get();

    if (doc.exists && doc.data().status === 'Pending') {
        return res.json({ success: true, message: "Already pending." });
    }

    await docRef.set({ model, status: 'Pending', request_time: Date.now(), expiry: 0 });

    const msg = `🔔 *NEW REQUEST*\n\n📱 *Model:* ${model}\n🔑 *HWID:* \`${hwid}\`\n\nApprove via buttons or type:\n\`/approve ${hwid} <days>\``;
    
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "1 Day", callback_data: `approve_${hwid}_1` }, { text: "3 Days", callback_data: `approve_${hwid}_3` }],
            [{ text: "7 Days", callback_data: `approve_${hwid}_7` }, { text: "15 Days", callback_data: `approve_${hwid}_15` }],
            [{ text: "Reject / Ban", callback_data: `reject_${hwid}` }]
        ]
    };

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'Markdown', reply_markup: inlineKeyboard
        });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// API: Live Check (App -> Server)
app.get('/api/check', async (req, res) => {
    const { hwid } = req.query;
    const docRef = db.collection('users').doc(hwid);
    const doc = await docRef.get();

    if (!doc.exists) return res.json({ status: "Unrecognized" });

    let data = doc.data();
    
    if (data.status === 'Approved' && Date.now() > data.expiry) {
        await docRef.update({ status: 'Expired' });
        return res.json({ status: "Expired" });
    }

    res.json({ status: data.status, expiry: data.expiry });
});

// Webhook: Telegram to Server
app.post('/tg-webhook', async (req, res) => {
    if (req.body.callback_query) {
        const query = req.body.callback_query;
        const data = query.data;
        const messageId = query.message.message_id;

        if (data.startsWith('approve_')) {
            const [, hwid, days] = data.split('_');
            const expiryTime = Date.now() + (parseInt(days) * 24 * 60 * 60 * 1000);
            
            await db.collection('users').doc(hwid).update({ status: 'Approved', expiry: expiryTime });
            
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: ADMIN_CHAT_ID, message_id: messageId,
                text: `✅ *APPROVED*\n🔑 \`${hwid}\`\n⏳ Duration: ${days} Days`, parse_mode: 'Markdown'
            });
        } 
        else if (data.startsWith('reject_')) {
            const hwid = data.split('_')[1];
            await db.collection('users').doc(hwid).update({ status: 'Rejected' });
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: ADMIN_CHAT_ID, message_id: messageId,
                text: `❌ *REJECTED*\n🔑 \`${hwid}\``, parse_mode: 'Markdown'
            });
        }
    }

    if (req.body.message && req.body.message.text) {
        const text = req.body.message.text;

        if (text === '/dpbot') {
            const snapshot = await db.collection('users').get();
            let total = snapshot.size, active = 0, expired = 0, pending = 0;
            snapshot.forEach(doc => {
                let s = doc.data().status;
                if(s === 'Approved') active++;
                else if(s === 'Expired') expired++;
                else if(s === 'Pending') pending++;
            });
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID, text: `📊 *DPMODS STATS*\n\n👥 Total Users: ${total}\n✅ Active: ${active}\n⏳ Pending: ${pending}\n❌ Expired: ${expired}`, parse_mode: 'Markdown'
            });
        }
        else if (text.startsWith('/info ')) {
            const hwid = text.split(' ')[1];
            const doc = await db.collection('users').doc(hwid).get();
            if (doc.exists) {
                const user = doc.data();
                const dateStr = user.expiry > 0 ? new Date(user.expiry).toLocaleString() : 'N/A';
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: ADMIN_CHAT_ID, text: `🔍 *USER INFO*\n\n🔑 HWID: \`${hwid}\`\n📱 Model: ${user.model}\n📌 Status: ${user.status}\n⏰ Expiry: ${dateStr}`, parse_mode: 'Markdown'
                });
            }
        }
        else if (text.startsWith('/approve ')) {
            const parts = text.split(' ');
            if (parts.length === 3) {
                const hwid = parts[1];
                const days = parseInt(parts[2]);
                const doc = await db.collection('users').doc(hwid).get();
                if (doc.exists) {
                    await db.collection('users').doc(hwid).update({ 
                        status: 'Approved', expiry: Date.now() + (days * 24 * 60 * 60 * 1000) 
                    });
                    axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: ADMIN_CHAT_ID, text: `✅ *CUSTOM APPROVAL*\nHWID: \`${hwid}\` approved for ${days} days.`, parse_mode: 'Markdown'
                    });
                }
            }
        }
    }
    res.sendStatus(200);
});

// Setup Webhook URL
app.get('/setup-webhook', async (req, res) => {
    const webhookUrl = `${RENDER_EXTERNAL_URL}/tg-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.listen(process.env.PORT || 3000);
