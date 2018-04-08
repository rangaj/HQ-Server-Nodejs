
const MessageHandler = require('./MessageHandler');
const logger = require("./logger").get("hq");
const config = require("./config");
const cc_id = config.cc_id;
const sig_appid = config.agora_appid;
const Signal = require('./sig_agora');

class ApiSignaling {
    constructor() {
        this.signal = new Signal(sig_appid);
    }


    init() {
        let api = this;
        let session = this.signal.login(cc_id, "_no_need_token");

        session.onLoginSuccess = () => {
            logger.info(`login successful ${sig_appid} ${cc_id}`);
        }

        session.onLoginFailed = () => {
            logger.error(`login failed ${sig_appid} ${cc_id}`);
            //reconnect after 10 seconds
            api.reconnect(10);
        }

        session.onLogout = () => {
            logger.warn(`logout ${sig_appid} ${cc_id}`);
            api.reconnect(10);
        }

        session.onMessageInstantReceive = (account, uid, msg) => {
            logger.info(`cm received msg: ${msg} ${uid} ${account}`);
            let json = JSON.parse(msg);
            let mchannel = "sig";
            let mid = json.hqmsgid || "";
            // let game = server.get(account);
            if (!mid) {
                api.response(account, mid, false, "no msgid presents, refuse to process");
                return;
            }

            let promise = null;

            if (json.type === "publish") {
                promise = MessageHandler.process(mchannel, mid, "publish", {
                    gid: account
                });
            } else if (json.type === "stopAnswer") {
                promise = MessageHandler.process(mchannel, mid, "stop", {
                    gid: account
                });
            } else if (json.type === "reset") {
                promise = MessageHandler.process(mchannel, mid, "reset", {
                    gid: account
                });
            } else if (json.type === "RequestChannelName") {
                let quiz = json.QuestionLanguage === "0" ? "quiz-2" : "quiz-1";
                let lang = 0;
                let encrypt = json.encrypt || null;
                if (!cipher.supported.includes(encrypt)) {
                    encrypt = null;
                    logger.info(`ignore unsupported encrpyt method ${encrypt}`);
                }

                promise = MessageHandler.process(mchannel, mid, "create", {
                    gid: account,
                    quiz: quiz,
                    encrypt: encrypt
                });
            } else if (json.type === "inviteRequest") {
                let data = json.data || {};
                let invitee = data.uid || "";
                promise = MessageHandler.process(mchannel, mid, "invite", {
                    gid: account,
                    invitee: invitee
                });
            }

            if (!promise) {
                api.response(account, mid, false, `unrecognized action ${json.type}`);
                return;
            }

            promise.then(() => {
                api.response(account, mid, true);
            }).catch(e => {
                api.response(account, mid, false, e);
            });
        }

        return session;
    }

    reconnect(sec) {
        let api = this;
        //reconnect after 10 seconds
        setTimeout(() => {
            logger.info(`relogin attempt ${sig_appid} ${cc_id}`);
            api.session = api.init();
        }, sec * 1000);
    }

    response(account, mid, success, err) {
        if (success) {
            logger.info(`${mid} success`);
            this.session.messageInstantSend(account, JSON.stringify({ type: "info", err: null, hqmsgid: mid }));
        } else {
            logger.error(`${mid} err: ${err}`);
            this.session.messageInstantSend(account, JSON.stringify({ type: "info", err: err, hqmsgid: mid }));
        }
    }
}

module.exports = ApiSignaling;