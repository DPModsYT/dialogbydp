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

// 🖼️ AESTHETIC BANNER URL (आप इसे अपनी पसंद की इमेज लिंक से बदल सकते हैं)
const BANNER_URL = "https://w0.peakpx.com/wallpaper/384/866/HD-wallpaper-cyberpunk-anime-aesthetic-neon-city.jpg";

const FILE_PATH = 'database.json';
let fileSha = "";
let localDB = {};

// ==========================================
// 🛡️ ANTI-SLEEP ENGINE (No Sleep 24/7)
// ==========================================
app.get('/', (req, res) => res.send('DPMods Server is Awake & Running!'));
setInterval(() => {
    if (RENDER_EXTERNAL_URL) axios.get(RENDER_EXTERNAL_URL).catch(() => {});
}, 14 * 60 * 1000); // हर 14 मिनट में सर्वर खुद को जगाए रखेगा

// ==========================================
// ⚙️ GITHUB SYNC ENGINE
// ==========================================
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
    
    if (!localDB["_UI_CONFIG_"]) {
        localDB["_UI_CONFIG_"] = {
            title: "DPMods Paid Panel", subtitle: "DPLogin Engine • Date Keys",
            adminUrl: "https://t.me/dpmods", watermark: "Panel Dev : DPMods",
            btn1: "GET KEY", btn2: "LOGIN"
        };
        await syncToGitHub(localDB);
    }
}

async function syncToGitHub(data) {
    try {
        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        const payload = { message: "Auto-update DB by DPMods", content: content };
        if (fileSha) payload.sha = fileSha;
        const res = await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`, payload, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        fileSha = res.data.content.sha;
        localDB = data;
    } catch (e) {}
}

syncFromGitHub();

// ==========================================
// 🚀 API ENDPOINTS
// ==========================================
app.post('/api/request', async (req, res) => {
    const { hwid, model } = req.body;
    if (!hwid) return res.status(400).json({ success: false });

    if (localDB[hwid] && localDB[hwid].status === 'Pending') return res.json({ success: true, message: "Already pending." });

    localDB[hwid] = { model, status: 'Pending', request_time: Date.now(), expiry: 0 };
    await syncToGitHub(localDB);

    const msg = `🔔 *NEW DPMODS REQUEST*\n\n📱 *Model:* ${model}\n🔑 *HWID:* \`${hwid}\`\n\n_Select duration below:_`;
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "1 Day", callback_data: `approve_${hwid}_1` }, { text: "3 Days", callback_data: `approve_${hwid}_3` }],
            [{ text: "7 Days", callback_data: `approve_${hwid}_7` }, { text: "15 Days", callback_data: `approve_${hwid}_15` }],
            [{ text: "Reject / Ban", callback_data: `reject_${hwid}` }]
        ]
    };
    try {
        // ✨ अब इमेज (Photo) के साथ रिक्वेस्ट जाएगी
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { 
            chat_id: ADMIN_CHAT_ID, photo: BANNER_URL, caption: msg, parse_mode: 'Markdown', reply_markup: inlineKeyboard 
        });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/check', async (req, res) => {
    const { hwid } = req.query;
    let user = localDB[hwid] || { status: "LOCKED", expiry: 0 };

    if (user.status === 'Approved' && Date.now() > user.expiry) {
        user.status = 'Expired';
        await syncToGitHub(localDB);
    }
    res.json({ status: user.status, expiry: user.expiry, config: localDB["_UI_CONFIG_"] });
});

// ==========================================
// 🤖 TELEGRAM BOT COMMANDS & ACTIONS
// ==========================================
app.post('/tg-webhook', async (req, res) => {
    
    // 🔘 BUTTON CLICKS HANDLER (Image Caption Edit)
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
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`, {
                    chat_id: ADMIN_CHAT_ID, message_id: messageId,
                    caption: `✅ *APPROVED*\n🔑 \`${hwid}\`\n⏳ Duration: ${days} Days`, parse_mode: 'Markdown'
                });
            }
        } 
        else if (data.startsWith('reject_')) {
            const hwid = data.split('_')[1];
            if(localDB[hwid]) {
                localDB[hwid].status = 'Rejected';
                await syncToGitHub(localDB);
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`, { 
                    chat_id: ADMIN_CHAT_ID, message_id: messageId, 
                    caption: `❌ *REJECTED*\n🔑 \`${hwid}\``, parse_mode: 'Markdown' 
                });
            }
        }
    }

    // 💬 TEXT COMMANDS HANDLER
    if (req.body.message && req.body.message.text) {
        const rawText = req.body.message.text;
        const parts = rawText.split(' ');
        const rawCmd = parts[0]; 
        const cmd = rawCmd.toLowerCase(); 
        const args = rawText.substring(rawCmd.length).trim();

        // 🎨 UI CONTROLLER (Touch to copy logic added)
        if (cmd === '/ui') {
            const conf = localDB["_UI_CONFIG_"];
            const msg = `🎨 *DPMODS UI CONTROLLER*\n\n*Current Settings:*\n🔹 Title: ${conf.title}\n🔹 Subtitle: ${conf.subtitle}\n🔹 Admin URL: ${conf.adminUrl}\n🔹 Watermark: ${conf.watermark}\n🔹 Btn1: ${conf.btn1}\n🔹 Btn2: ${conf.btn2}\n\n*👇 Tap below to copy & edit:*\n\` /settitle ${conf.title} \`\n\` /setsub ${conf.subtitle} \`\n\` /seturl ${conf.adminUrl} \`\n\` /setmark ${conf.watermark} \`\n\` /setbtn1 ${conf.btn1} \`\n\` /setbtn2 ${conf.btn2} \``;
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'Markdown' });
        }
        else if (['/settitle', '/setsub', '/seturl', '/setmark', '/setbtn1', '/setbtn2'].includes(cmd) && args) {
            let key = cmd.replace('/set', '');
            if (key === 'sub') key = 'subtitle';
            if (key === 'url') key = 'adminUrl';
            if (key === 'mark') key = 'watermark';
            
            localDB["_UI_CONFIG_"][key] = args;
            await syncToGitHub(localDB);
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `✅ UI Updated!\n*${key}* is now: \`${args}\``, parse_mode: 'Markdown' });
        }
        
        // 📊 STATS
        else if (cmd === '/dpbot') {
            let total = 0, active = 0, expired = 0, pending = 0;
            for(let key in localDB) {
                if(key === "_UI_CONFIG_") continue;
                total++; let s = localDB[key].status;
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
                axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `🗑️ *DELETED*\nHWID: \`${hwid}\` has been removed.`, parse_mode: 'Markdown' });
            }
        }
        // 🔍 DIRECT HWID SEARCH (Bug Fixed)
        else if (rawCmd.startsWith('/') && rawCmd.length > 10) {
            const hwid = rawCmd.substring(1).toUpperCase(); // Case sensitivity fix
            if (localDB[hwid]) {
                const user = localDB[hwid];
                let dateStr = "Not Approved Yet";
                if (user.expiry > 0) dateStr = new Date(user.expiry).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                const msg = `🔍 *USER INFO*\n\n🔑 HWID: \`${hwid}\`\n📱 Model: ${user.model}\n📌 Status: ${user.status}\n⏰ Expiry: ${dateStr}\n\n*Manage Device:*\n\` /edit ${hwid} 10 \`\n\` /remove ${hwid} \``;
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
