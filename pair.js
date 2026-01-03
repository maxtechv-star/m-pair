import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@metaload/baileys-mod';
import pn from 'awesome-phonenumber';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

async function sendSessionSuccessMessage(meta, sessionCode) {
    try {
        const sessionid = "meta@=" + sessionCode;
        const codeMsg = await meta.sendMessage(meta.user.id, { text: sessionid });
        
        const desc = `*Session generated!*\n- Keep your code safe.\n- Repo: https://github.com/MetaLoad1/META-AI\n\n*© METALOAD*`;
        
        await meta.sendMessage(meta.user.id, {
            text: desc,
            contextInfo: {
                externalAdReply: {
                    title: "Metaload",
                    thumbnailUrl: "https://github.com/Metaload1.png",
                    sourceUrl: "https://www.instagram.com/metaload1",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: codeMsg });
    } catch (error) {
        console.error("Failed to send success message:", error);
    }
}

async function sendSessionErrorMessage(meta, error) {
    try {
        const errorMsg = await meta.sendMessage(meta.user.id, { text: error.message || "Unknown error" });
        
        const desc = `*Session error!*\n- Repo: https://github.com/MetaLoad1/META-AI`;
        
        await meta.sendMessage(meta.user.id, {
            text: desc,
            contextInfo: {
                externalAdReply: {
                    title: "META-AI",
                    thumbnailUrl: "https://github.com/Metaload1.png",
                    sourceUrl: "https://www.instagram.com/metaload1",
                    mediaType: 2,
                    renderLargerThumbnail: true,
                    showAdAttribution: true
                }
            }
        }, { quoted: errorMsg });
    } catch (error) {
        console.error("Failed to send error message:", error);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number without + or spaces.' });
        }
        return;
    }
    
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
            let Metaai = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.ubuntu('Edge'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            Metaai.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    
                    try {
                        const sessionData = fs.readFileSync(dirs + '/creds.json');
                        const sessionBase64 = Buffer.from(sessionData).toString('base64');
                        
                        await sendSessionSuccessMessage(Metaai, sessionBase64);

                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");
                    } catch (error) {
                        console.error("❌ Error sending session:", error);
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!Metaai.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await Metaai.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            Metaai.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;