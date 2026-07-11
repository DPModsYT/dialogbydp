const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const BOT_TOKEN = process.env.BOT_TOKEN; 
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; 
const GITHUB_REPO = process.env.GITHUB_REPO;   

const FILE_PATH = 'database.json';
let fileSha = "";
let localDB = {};

// GITHUB SYNC ENGINE
async function syncFromGitHub() {
    try {
        const res = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        fileSha = res.data.sha;
        localDB = JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf-8'));
    } catch (e) {
        if (e.response && e.response.status === 404) await syncToGitHub({});
    }
}
async function syncToGitHub(data) {
    try {
        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        const payload = { message: "Auto-update DB by DPMods Panel", content: content };
        if (fileSha) payload.sha = fileSha;
        const res = await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`, payload, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        fileSha = res.data.content.sha;
        localDB = data;
    } catch (e) {}
}
syncFromGitHub();

// API ENDPOINTS
app.post('/api/request', async (req, res) => {
    const { hwid, model } = req.body;
    if (!hwid) return res.status(400).json({ success: false });

    if (localDB[hwid] && localDB[hwid].status === 'Pending') return res.json({ success: true, message: "Already pending." });

    localDB[hwid] = { model, status: 'Pending', request_time: Date.now(), expiry: 0 };
    await syncToGitHub(localDB);

    const msg = `🔔 *NEW DPMODS REQUEST*\n\n📱 *Model:* ${model}\n🔑 *HWID:* \`${hwid}\`\n\nApprove via buttons or type:\n\`/approve ${hwid} <days>\``;
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "1 Day", callback_data: `approve_${hwid}_1` }, { text: "3 Days", callback_data: `approve_${hwid}_3` }],
            [{ text: "7 Days", callback_data: `approve_${hwid}_7` }, { text: "15 Days", callback_data: `approve_${hwid}_15` }],
            [{ text: "Reject / Ban", callback_data: `reject_${hwid}` }]
        ]
    };
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'Markdown', reply_markup: inlineKeyboard });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/check', async (req, res) => {
    const { hwid } = req.query;
    if (!localDB[hwid]) return res.json({ status: "LOCKED" });

    let user = localDB[hwid];
    if (user.status === 'Approved' && Date.now() > user.expiry) {
        user.status = 'Expired';
        await syncToGitHub(localDB);
        return res.json({ status: "Expired" });
    }
    res.json({ status: user.status, expiry: user.expiry });
});

// TELEGRAM WEBHOOK (Advanced Commands)
app.post('/tg-webhook', async (req, res) => {
    if (req.body.callback_query) {
        const query = req.body.callback_query;
        const data = query.data;
        const messageId = query.message.message_id;

        if (data.startsWith('approve_')) {
            const [, hwid, days] = data.split('_');
            if(localDB[hwid]) {
                localDB[hwid].status = 'Approved';
                localDB[hwid].expiry = Date.now() + (parseInt(days) * 24 * 60 * 60 * 1000);
                await syncToGitHub(localDB);
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                    chat_id: ADMIN_CHAT_ID, message_id: messageId,
                    text: `✅ *APPROVED*\n🔑 \`${hwid}\`\n⏳ Duration: ${days} Days`, parse_mode: 'Markdown'
                });
            }
        } 
        else if (data.startsWith('reject_')) {
            const hwid = data.split('_')[1];
            if(localDB[hwid]) {
                localDB[hwid].status = 'Rejected';
                await syncToGitHub(localDB);
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, { chat_id: ADMIN_CHAT_ID, message_id: messageId, text: `❌ *REJECTED*\n🔑 \`${hwid}\``, parse_mode: 'Markdown' });
            }
        }
    }

    if (req.body.message && req.body.message.text) {
        const text = req.body.message.text;
        const parts = text.split(' ');
        const cmd = parts[0]; 

        // 📊 STATS
        if (cmd === '/dpbot') {
            let total = 0, active = 0, expired = 0, pending = 0;
            for(let hwid in localDB) {
                total++; let s = localDB[hwid].status;
                if(s === 'Approved') active++; else if(s === 'Expired') expired++; else if(s === 'Pending') pending++;
            }
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `📊 *DPMODS STATS*\n\n👥 Total Users: ${total}\n✅ Active: ${active}\n⏳ Pending: ${pending}\n❌ Expired: ${expired}`, parse_mode: 'Markdown' });
        }
        // ✏️ EDIT DURATION
        else if (cmd === '/edit' || cmd === '/approve') {
            const hwid = parts[1]; const days = parseInt(parts[2]);
            if (hwid && days && localDB[hwid]) {
                localDB[hwid].status = 'Approved';
                localDB[hwid].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                await syncToGitHub(localDB);
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `✅ *UPDATED*\nHWID: \`${hwid}\` is now approved for ${days} days.`, parse_mode: 'Markdown' });
            }
        }
        // 🗑️ REMOVE/DELETE DEVICE
        else if (cmd === '/remove' || cmd === '/delete') {
            const hwid = parts[1];
            if (hwid && localDB[hwid]) {
                delete localDB[hwid];
                await syncToGitHub(localDB);
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `🗑️ *DELETED*\nHWID: \`${hwid}\` has been removed from database.`, parse_mode: 'Markdown' });
            }
        }
        // 🔍 DIRECT HWID SEARCH (Fix for typing /0805FF...)
        else if (cmd.startsWith('/') && cmd.length > 5) {
            const hwid = cmd.substring(1); 
            if (localDB[hwid]) {
                const user = localDB[hwid];
                const dateStr = user.expiry > 0 ? new Date(user.expiry).toLocaleString() : 'N/A';
                const msg = `🔍 *USER INFO*\n\n🔑 HWID: \`${hwid}\`\n📱 Model: ${user.model}\n📌 Status: ${user.status}\n⏰ Expiry: ${dateStr}\n\n*Manage Device:*\n\`/edit ${hwid} <days>\`\n\`/remove ${hwid}\``;
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'Markdown' });
            } else {
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `⚠️ HWID \`${hwid}\` not found in database.`, parse_mode: 'Markdown' });
            }
        }
    }
    res.sendStatus(200);
});

app.get('/setup-webhook', async (req, res) => {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_EXTERNAL_URL}/tg-webhook`);
    res.json(response.data);
});

app.listen(process.env.PORT || 3000);
    }
}

async function syncToGitHub(data) {
    try {
        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        const payload = { message: "Auto-update DB by DPMods Panel", content: content };
        if (fileSha) payload.sha = fileSha; // Required for updating existing file

        const res = await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`, payload, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        fileSha = res.data.content.sha;
        localDB = data;
    } catch (e) { console.error("❌ Error saving to GitHub"); }
}

// सर्वर स्टार्ट होते ही GitHub से डेटाबेस डाउनलोड करें
syncFromGitHub();

// ==========================================
// 🚀 API ENDPOINTS
// ==========================================
app.post('/api/request', async (req, res) => {
    const { hwid, model } = req.body;
    if (!hwid) return res.status(400).json({ success: false });

    if (localDB[hwid] && localDB[hwid].status === 'Pending') {
        return res.json({ success: true, message: "Already pending." });
    }

    localDB[hwid] = { model, status: 'Pending', request_time: Date.now(), expiry: 0 };
    await syncToGitHub(localDB); // Save to GitHub

    const msg = `🔔 *NEW DPMODS REQUEST*\n\n📱 *Model:* ${model}\n🔑 *HWID:* \`${hwid}\`\n\nApprove via buttons or type:\n\`/approve ${hwid} <days>\``;
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

app.get('/api/check', async (req, res) => {
    const { hwid } = req.query;
    if (!localDB[hwid]) return res.json({ status: "Unrecognized" });

    let user = localDB[hwid];
    if (user.status === 'Approved' && Date.now() > user.expiry) {
        user.status = 'Expired';
        await syncToGitHub(localDB); // Update expiration on GitHub
        return res.json({ status: "Expired" });
    }
    res.json({ status: user.status, expiry: user.expiry });
});

// ==========================================
// 🤖 TELEGRAM WEBHOOK
// ==========================================
app.post('/tg-webhook', async (req, res) => {
    if (req.body.callback_query) {
        const query = req.body.callback_query;
        const data = query.data;
        const messageId = query.message.message_id;

        if (data.startsWith('approve_')) {
            const [, hwid, days] = data.split('_');
            const expiryTime = Date.now() + (parseInt(days) * 24 * 60 * 60 * 1000);
            
            if(localDB[hwid]) {
                localDB[hwid].status = 'Approved';
                localDB[hwid].expiry = expiryTime;
                await syncToGitHub(localDB);
                
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                    chat_id: ADMIN_CHAT_ID, message_id: messageId,
                    text: `✅ *APPROVED*\n🔑 \`${hwid}\`\n⏳ Duration: ${days} Days`, parse_mode: 'Markdown'
                });
            }
        } 
        else if (data.startsWith('reject_')) {
            const hwid = data.split('_')[1];
            if(localDB[hwid]) {
                localDB[hwid].status = 'Rejected';
                await syncToGitHub(localDB);
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                    chat_id: ADMIN_CHAT_ID, message_id: messageId,
                    text: `❌ *REJECTED*\n🔑 \`${hwid}\``, parse_mode: 'Markdown'
                });
            }
        }
    }

    if (req.body.message && req.body.message.text) {
        const text = req.body.message.text;

        if (text === '/dpbot') {
            let total = 0, active = 0, expired = 0, pending = 0;
            for(let hwid in localDB) {
                total++;
                let s = localDB[hwid].status;
                if(s === 'Approved') active++;
                else if(s === 'Expired') expired++;
                else if(s === 'Pending') pending++;
            }
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID, text: `📊 *DPMODS STATS*\n\n👥 Total Users: ${total}\n✅ Active: ${active}\n⏳ Pending: ${pending}\n❌ Expired: ${expired}`, parse_mode: 'Markdown'
            });
        }
        else if (text.startsWith('/info ')) {
            const hwid = text.split(' ')[1];
            const user = localDB[hwid];
            if (user) {
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
                if (localDB[hwid]) {
                    localDB[hwid].status = 'Approved';
                    localDB[hwid].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                    await syncToGitHub(localDB);
                    axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: ADMIN_CHAT_ID, text: `✅ *CUSTOM APPROVAL*\nHWID: \`${hwid}\` approved for ${days} days.`, parse_mode: 'Markdown'
                    });
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/setup-webhook', async (req, res) => {
    const webhookUrl = `${RENDER_EXTERNAL_URL}/tg-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.listen(process.env.PORT || 3000);
