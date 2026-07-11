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

// 🖼️ AESTHETIC BANNER URL (Converted dl=1 to raw=1 for Telegram compatibility)
const BANNER_URL = "https://www.dropbox.com/scl/fi/hl63h97m9eliwfnkpdw1n/From-Klickpin.com-Explore-Dreamy-self-care-Sunday-ideas-that-help-you-create-a-beautiful-result-without-overspending-for-your-next-inspiration-bo.jpg?rlkey=188a80bbsdyx7a9xl2md37ywq&st=p22qnsbq&raw=1";

const FILE_PATH = 'database.json';
let fileSha = "";
let localDB = {};

// ==========================================
// 🛡️ ANTI-SLEEP ENGINE (No Sleep 24/7)
// ==========================================
app.get('/', (req, res) => res.send('DPMods Server is Awake & Running!'));
setInterval(() => {
    if (RENDER_EXTERNAL_URL) axios.get(RENDER_EXTERNAL_URL).catch(() => {});
}, 14 * 60 * 1000); 

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

        // ✨ Updated Message with Custom Command Hint and Footer Watermark
    const msg = `🔔 <b>NEW DPMODS REQUEST</b>\n\n📱 <b>Model:</b> ${model}\n🔑 <b>HWID:</b> <code>${hwid}</code>\n\n<i>Select duration below or use custom days:</i>\n<code>/approve ${hwid} 100</code>\n\n—\n<i>Panel By DPMods</i>`;
    
    const inlineKeyboard = {
        inline_keyboard: [
            [{ text: "1 Day", callback_data: `approve_${hwid}_1` }, { text: "3 Days", callback_data: `approve_${hwid}_3` }],
            [{ text: "7 Days", callback_data: `approve_${hwid}_7` }, { text: "15 Days", callback_data: `approve_${hwid}_15` }],
            [{ text: "Reject / Ban", callback_data: `reject_${hwid}` }]
        ]
    };

    
    try {
        // Attempt 1: Try sending with the Aesthetic Image
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { 
            chat_id: ADMIN_CHAT_ID, photo: BANNER_URL, caption: msg, parse_mode: 'HTML', reply_markup: inlineKeyboard 
        });
        res.json({ success: true });
    } catch (photoError) {
        // Attempt 2 (Fallback): If Image fails, send Text Only so request is never lost
        try {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { 
                chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'HTML', reply_markup: inlineKeyboard 
            });
            res.json({ success: true });
        } catch (textError) {
            res.json({ success: false }); 
        }
    }
});

app.get('/api/check', async (req, res) => {
    const { hwid } = req.query;
    let user = localDB[hwid] || { status: "LOCKED", expiry: 0 };

    if (user.status === 'Approved' && Date.now() > user.expiry) {
        user.status = 'Expired';
        await syncToGitHub(localDB);
    }
    
    const config = localDB["_UI_CONFIG_"] || {
        title: "DPMods Paid Panel", subtitle: "DPLogin Engine • Date Keys",
        adminUrl: "https://t.me/dpmods", watermark: "Panel Dev : DPMods",
        btn1: "GET KEY", btn2: "LOGIN"
    };

    res.json({ status: user.status, expiry: user.expiry, config: config });
});

// ==========================================
// 🤖 TELEGRAM BOT COMMANDS & ACTIONS
// ==========================================
app.post('/tg-webhook', async (req, res) => {
    try {
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
                    
                    // Fallback handled for both caption and text edit
                    try {
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`, {
                            chat_id: ADMIN_CHAT_ID, message_id: messageId,
                            caption: `✅ <b>APPROVED</b>\n🔑 <code>${hwid}</code>\n⏳ Duration: ${days} Days`, parse_mode: 'HTML'
                        });
                    } catch (e) {
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                            chat_id: ADMIN_CHAT_ID, message_id: messageId,
                            text: `✅ <b>APPROVED</b>\n🔑 <code>${hwid}</code>\n⏳ Duration: ${days} Days`, parse_mode: 'HTML'
                        });
                    }
                }
            } 
            else if (data.startsWith('reject_')) {
                const hwid = data.split('_')[1];
                if(localDB[hwid]) {
                    localDB[hwid].status = 'Rejected';
                    await syncToGitHub(localDB);
                    
                    try {
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`, { 
                            chat_id: ADMIN_CHAT_ID, message_id: messageId, 
                            caption: `❌ <b>REJECTED</b>\n🔑 <code>${hwid}</code>`, parse_mode: 'HTML' 
                        });
                    } catch (e) {
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, { 
                            chat_id: ADMIN_CHAT_ID, message_id: messageId, 
                            text: `❌ <b>REJECTED</b>\n🔑 <code>${hwid}</code>`, parse_mode: 'HTML' 
                        });
                    }
                }
            }
        }

        if (req.body.message && req.body.message.text) {
            const rawText = req.body.message.text.trim();
            const match = rawText.match(/^(\S+)(?:\s+(.*))?$/);
            if (!match) return res.sendStatus(200);

            const rawCmd = match[1]; 
            const cmd = rawCmd.split('@')[0].toLowerCase(); 
            const args = match[2] ? match[2].trim() : "";

            const conf = localDB["_UI_CONFIG_"] || {
                title: "DPMods Paid Panel", subtitle: "DPLogin Engine • Date Keys",
                adminUrl: "https://t.me/dpmods", watermark: "Panel Dev : DPMods",
                btn1: "GET KEY", btn2: "LOGIN"
            };

            const knownCommands = ['/ui', '/dpbot', '/settitle', '/setsub', '/seturl', '/setmark', '/setbtn1', '/setbtn2', '/edit', '/approve', '/remove', '/delete'];

            if (cmd === '/ui') {
                const msg = `🎨 <b>DPMODS UI CONTROLLER</b>\n\n<b>Current Settings:</b>\n🔹 Title: ${conf.title}\n🔹 Subtitle: ${conf.subtitle}\n🔹 Admin URL: ${conf.adminUrl}\n🔹 Watermark: ${conf.watermark}\n🔹 Btn1: ${conf.btn1}\n🔹 Btn2: ${conf.btn2}\n\n<b>👇 Tap below to copy & edit:</b>\n<code>/settitle ${conf.title}</code>\n<code>/setsub ${conf.subtitle}</code>\n<code>/seturl ${conf.adminUrl}</code>\n<code>/setmark ${conf.watermark}</code>\n<code>/setbtn1 ${conf.btn1}</code>\n<code>/setbtn2 ${conf.btn2}</code>`;
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'HTML' });
            }
            else if (['/settitle', '/setsub', '/seturl', '/setmark', '/setbtn1', '/setbtn2'].includes(cmd)) {
                if (!args) {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `⚠️ Please provide text!\nExample: <code>${cmd} DPMods Pro</code>`, parse_mode: 'HTML' });
                    return res.sendStatus(200);
                }

                let key = cmd.replace('/set', '');
                if (key === 'sub') key = 'subtitle';
                if (key === 'url') key = 'adminUrl';
                if (key === 'mark') key = 'watermark';
                
                if(!localDB["_UI_CONFIG_"]) localDB["_UI_CONFIG_"] = conf;
                localDB["_UI_CONFIG_"][key] = args;
                await syncToGitHub(localDB);
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `✅ UI Updated!\n<b>${key}</b> is now: <code>${args}</code>`, parse_mode: 'HTML' });
            }
            else if (cmd === '/dpbot') {
                let total = 0, active = 0, expired = 0, pending = 0;
                for(let key in localDB) {
                    if(key === "_UI_CONFIG_") continue;
                    total++; let s = localDB[key].status;
                    if(s === 'Approved') active++; else if(s === 'Expired') expired++; else if(s === 'Pending') pending++;
                }
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `📊 <b>DPMODS STATS</b>\n\n👥 Total Users: ${total}\n✅ Active: ${active}\n⏳ Pending: ${pending}\n❌ Expired: ${expired}`, parse_mode: 'HTML' });
            }
            else if (cmd === '/edit' || cmd === '/approve') {
                const parts = args.split(' ');
                const hwid = parts[0]; 
                const days = parseInt(parts[1]);
                if (hwid && days && localDB[hwid]) {
                    localDB[hwid].status = 'Approved';
                    localDB[hwid].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                    await syncToGitHub(localDB);
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `✅ <b>UPDATED</b>\nHWID: <code>${hwid}</code> is now approved for ${days} days.`, parse_mode: 'HTML' });
                } else {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `⚠️ Use format: <code>${cmd} HWID DAYS</code>`, parse_mode: 'HTML' });
                }
            }
            else if (cmd === '/remove' || cmd === '/delete') {
                const hwid = args.split(' ')[0];
                if (hwid && localDB[hwid]) {
                    delete localDB[hwid];
                    await syncToGitHub(localDB);
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `🗑️ <b>DELETED</b>\nHWID: <code>${hwid}</code> has been removed.`, parse_mode: 'HTML' });
                } else {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `⚠️ Device not found.`, parse_mode: 'HTML' });
                }
            }
            else if (cmd.startsWith('/') && !knownCommands.includes(cmd)) {
                const hwid = rawCmd.substring(1).toUpperCase(); 
                if (localDB[hwid]) {
                    const user = localDB[hwid];
                    let dateStr = "Not Approved Yet";
                    if (user.expiry > 0) dateStr = new Date(user.expiry).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                    const msg = `🔍 <b>USER INFO</b>\n\n🔑 HWID: <code>${hwid}</code>\n📱 Model: ${user.model}\n📌 Status: ${user.status}\n⏰ Expiry: ${dateStr}\n\n<b>Manage Device:</b>\n<code>/edit ${hwid} 10</code>\n<code>/remove ${hwid}</code>`;
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'HTML' });
                } else {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: ADMIN_CHAT_ID, text: `⚠️ HWID <code>${hwid}</code> not found in database.`, parse_mode: 'HTML' });
                }
            }
        }
    } catch (error) {
        console.error("Webhook Error: ", error);
    }
    res.sendStatus(200);
});

app.get('/setup-webhook', async (req, res) => {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_EXTERNAL_URL}/tg-webhook`);
    res.json(response.data);
});

app.listen(process.env.PORT || 3000);
