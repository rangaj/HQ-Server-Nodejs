const logger = require("./logger").get("hq");
const config = require("./config");
const cc_id = config.cc_id;
const socks_host = config.socks_proxy_host;
const socks_port = config.socks_proxy_port;
const QuizFactory = require("./QuizFactory");
const request = require("request");
const Agent = require('socks5-http-client/lib/Agent');
const sig_appid = config.agora_appid;
let cipher = null;
try {
    cipher = require("./Encrypt");
} catch (e) {
    cipher = require("./FakeEncrypt");
}

let HQ = {};

function parseResult(err, resultText) {
    if (err) {
        logger.error(`request failed: ${err}`);
    } else {
        let result = JSON.parse(resultText);
        logger.info(`request: ${resultText}`);
        if (result.code === 200) {
            return result;
        }
    }
    return null;
}

function proxy(options){
    if(socks_host){
        logger.info(`using proxy`);
        options.agentClass = Agent;
        options.socksHost = socks_host;
        options.socksPort = socks_port;
    }
    return options;
}

HQ.GameMaker = function () {
    let server = this;
    this.__games = [];
    this.sig = null;


    /*------------------------------------------------
    |   class : Game
    \*----------------------------------------------*/
    HQ.Game = function (gid, name, quizSet, encrypt) {
        let game = this;
        this.gid = gid || `${parseInt(Math.random() * 1000000)}`;
        this.name = name;
        this.quizSet = quizSet || [];
        this.sequence = 0;
        this.open = false;
        this.live = false;
        this.answers = {};
        this.gameovers = {};
        this.players = {};
        this.sig_session = null;
        this.timeout = 20;
        this.encrypt = encrypt || null;
        this.inviting = null;

        if (quizSet.length === 0) {
            logger.warn(`game ${gid} has an empty quiz set`);
        }

        this.reset = _ => {
            game.sequence = 0;
            game.open = false;
            game.live = false;
            game.answers = {};
            game.gameovers = {};
        };

        this.setLive = live => {
            game.live = live;
        }

        this.hasNext = function () {
            return game.sequence < game.quizSet.length;
        };

        this.nextQuiz = function () {
            return game.quizSet[game.sequence];
        };

        this.publish = function () {
            return new Promise((resolve, reject) => {
                if (game.open) {
                    reject("quiz_going_on");
                    return;
                }
                if (!game.hasNext()) {
                    reject("no_more_quiz");
                    return;
                }
                game.publishNextQuiz().then(result => {
                    resolve(result);
                });
            });
        }

        this.canplay = function (uid) {
            if (game.sequence === 0) {
                return { result: true };
            }
            if (!game.players[uid]) {
                logger.info(`not a player ${uid}`);
                return { result: false, err: `not a player ${uid}` };
            } else {
                if (game.gameovers[uid]) {
                    logger.info(`${uid} is already game over`);
                    return { result: false, err: `${uid} is already game over` };
                } else {
                    return { result: true };
                }
            }
        };

        this.closeQuiz = function () {
            logger.info(`quiz closed for ${game.gid}`);
            game.open = false;
            game.summaryResult(game.sequence++);
        };

        this.publishNextQuiz = function () {
            game.open = true;
            return new Promise((resolve, reject) => {
                let quiz = Object.assign({}, game.nextQuiz());
                let encrypted_quiz = null;
                delete quiz.answer;
                quiz.total = game.quizSet.length;
                quiz.timeout = game.timeout;
                game.answers[quiz.id] = {};
                if (cipher.supported.includes(game.encrypt)) {
                    encrypted_quiz = cipher.encrypt("v1", JSON.stringify(quiz), game.gid);
                }
                let raw_quiz = { type: "quiz", data: quiz };
                encrypted_quiz = encrypted_quiz ? { type: "quiz", data: encrypted_quiz, encrypt: game.encrypt } : { type: "quiz", data: quiz, encrypt: "null" };
                raw_quiz = JSON.stringify(raw_quiz);
                encrypted_quiz = JSON.stringify(encrypted_quiz);
                var options = {
                    uri: `http://hq-im.agoraio.cn:8000/signaling/v1/${sig_appid}/sendChannelMessage`,
                    method: 'POST',
                    json: { "m": encrypted_quiz, "channel": game.gid }
                };
                proxy(options);
                logger.info(`sending quiz ${quiz} to ${game.gid}`)
                logger.info(`sending quiz ${encrypted_quiz} to ${game.gid}`)
                request(options, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        resolve(raw_quiz);
                    } else {
                        reject(error);
                    }
                });
            });
        };

        this.relive = function (uid) {
            logger.info(`player ${uid} try to revive himself...`)
            let canplay = game.canplay(uid);
            logger.info(`can player ${uid} play? ${canplay.result}`);
            if (canplay.result) {
                logger.info(`player ${uid} revive not needed`)
            } else {
                logger.info(`god bless ${uid}....now your life has returned`);
                game.gameovers[uid] = undefined;
                game.players[uid] = true;
            }
        };

        this.answerCommited = function (uid) {
            return game.answers[game.sequence][uid] !== undefined;
        };

        this.commitanswer = function (uid, result) {
            let question = game.quizSet[game.sequence];
            let resultSize = question.options.length;
            let answer = parseInt(result);

            if (answer >= resultSize || answer < 0) {
                logger.error("invalid answer");
                return;
            }

            let correct_answer = question.answer;
            if (answer !== correct_answer) {
                game.gameovers[uid] = true;
            }

            logger.info(`anwser collected from ${uid}, ${answer}`);
            game.answers[game.sequence][uid] = answer;
            if (game.sequence === 0) {
                game.players[uid] = true;
            }
        };


        this.summaryResult = function (sequence) {
            return new Promise((resolve, reject) => {
                let results = game.answers[sequence] || {};
                let quiz = game.quizSet[sequence];
                let options = quiz.options;
                let answer = game.quizSet[sequence].answer;
                let rightUids = [];
                let wrongUids = [];
                let resultSpread = {};

                for (let i = 0; i < options.length; i++) {
                    resultSpread[i] = 0;
                }

                Object.keys(results).forEach(uid => {
                    let commited = results[uid];
                    if (commited === answer) {
                        rightUids.push(uid);
                    } else {
                        wrongUids.push(uid);
                    }
                    (resultSpread[commited] !== undefined) && resultSpread[commited]++;
                });
                if (sequence === game.quizSet.length - 1) {
                    logger.info("=========================FINAL ROUND==========================");
                } else {
                    logger.info(`=========================QUIZ ${sequence + 1}==========================`)
                }
                logger.info(`right: ${rightUids.length} in total,  {${JSON.stringify(rightUids)}}`);
                logger.info(`wrong: ${wrongUids.length} in total, {${JSON.stringify(wrongUids)}}`);
                logger.info(`total: ${Object.keys(results).length} in total, {${JSON.stringify(rightUids)}`);
                logger.info(`spread: ${JSON.stringify(resultSpread)}`);
                let data = JSON.stringify({
                    type: "result",
                    data: {
                        correct: rightUids.length,
                        total: Object.keys(results).length,
                        sid: sequence,
                        result: answer,
                        spread: resultSpread
                    }
                });
                server.sig.messageInstantSend(game.gid, data);
                if(sequence === game.quizSet.length - 1){
                    game.listWinner(rightUids);
                }
                let request_options = {
                    uri: `http://hq-im.agoraio.cn:8000/signaling/v1/${sig_appid}/sendChannelMessage`,
                    method: 'POST',
                    json: { "m": data, "channel": game.gid }
                };
                proxy(request_options);
                request(request_options, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        resolve();
                    } else {
                        reject(error);
                    }
                });
            });
        };

        this.listWinner = (winners) => {
            server.sig.messageInstantSend(game.gid, JSON.stringify({
                type: "ListOfWinners",
                data: {
                    num: winners.length,
                    playerName: winners
                }
            }));
        };

        this.inviteRequest = (invitee) => {
            let game = this;
            logger.info(`try to inivite ${invitee}`);
            return new Promise((resolve, reject) => {
                game.inviteEnd().then(() => {
                    let invite_msg = {
                        type: "inviteRequest",
                        data: {
                            uid: invitee
                        }
                    }
                    let request_options = {
                        uri: `http://hq-im.agoraio.cn:8000/signaling/v1/${sig_appid}/sendMessageTo`,
                        method: 'POST',
                        json: { "m": JSON.stringify(invite_msg), "uid": invitee }
                    };
                    proxy(request_options);
                    request(request_options, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            game.inviting = invitee;
                            resolve();
                        } else {
                            reject(error);
                        }
                    });
                });
            });
        };

        this.inviteEnd = () => {
            let game = this;
            logger.info(`try to end inivite ${game.inviting}`);
            if(!game.inviting){
                logger.info(`no inviting exists`);
                return Promise.resolve();
            } else {
                return new Promise((resolve, reject) => {
                    let invite_msg = {
                        type: "inviteEnd",
                        data: {
                            uid: game.inviting
                        }
                    }
                    let request_options = {
                        uri: `http://hq-im.agoraio.cn:8000/signaling/v1/${sig_appid}/sendMessageTo`,
                        method: 'POST',
                        json: { "m": JSON.stringify(invite_msg), "uid": game.inviting }
                    };
                    proxy(request_options);
                    request(request_options, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            logger.info(`invite end for ${game.inviting} successfully sent`);
                            resolve();
                        } else {
                            reject(error);
                        }
                    });
                });
            }
        };

        this.inviteResponse = (invitee, accept, mediaUid) => {
            if(invitee !== this.inviting){
                logger.info(`sending invite response for ${invitee} while ${this.inviting} is invited instead`);
            } else {
                logger.info(`invite response received from ${invitee}, send back to ${this.gid}`);
                server.sig.messageInstantSend(this.gid, JSON.stringify({ type: "inviteResponse", data: { accept: accept, mediaUid: mediaUid, uid: invitee } }));
            }
        }
    };

    /*------------------------------------------------
    |   function : GameMaker
    \*----------------------------------------------*/
    this.add = function (game) {
        return new Promise((resolve, reject) => {
            let g = server.get(game.gid);
            if (g) {
                g.quizSet = game.quizSet;
                g.reset();
                resolve();
                return;
            }

            server.__games.push(game);
        });
    };

    this.get = function (gid) {
        let game = server.__games.filter(item => {
            return `${item.gid}` === `${gid}`;
        });
        return game.length > 0 ? game[0] : null;
    };

    this.init = () => {
        return Promise.resolve();
        // return new Promise((resolve, reject) => {
        //     let signal = new Signal(sig_appid);
        //     signal.setup_debugging('env', 'lbs100');
        //     server.sig = signal.login(cc_id, "_no_need_token");
        //     server.sig.onLoginSuccess = function () {
        //         logger.info(`agora cm login successful`);

        //         server.sig.onMessageInstantReceive = (account, uid, msg) => {
        //             logger.info(`cm received msg: ${msg} ${uid} ${account}`);
        //             let json = JSON.parse(msg);
        //             let game = server.get(account);
        //             let quiz = "quiz-1";
        //             let lang = 0;
        //             let encrypt = null;
        //             let inviteGame = null;

        //             switch (json.type) {
        //                 case "publish":
        //                     if (!game) {
        //                         server.sig.messageInstantSend(account, { type: "info", data: { err: "game not created yet" } })
        //                         return;
        //                     }
        //                     game.publish(result => {
        //                         logger.info(JSON.stringify(result));
        //                         server.sig.messageInstantSend(game.gid, JSON.stringify({ type: "info", data: result }));
        //                     });
        //                     break;
        //                 case "stopAnswer":
        //                     if (!game) {
        //                         server.sig.messageInstantSend(account, { type: "info", data: { err: "game not created yet" } })
        //                         return;
        //                     }
        //                     if (game.open) {
        //                         game.closeQuiz();
        //                         server.sig.messageInstantSend(game.gid, JSON.stringify({ type: "info", data: { err: "game closed, waiting for summary info..." } }));
        //                     } else {
        //                         logger.info("try to stop a quiz which is already closed");
        //                         server.sig.messageInstantSend(game.gid, JSON.stringify({ type: "info", data: { err: "try to stop a quiz which is already closed" } }));
        //                     }
        //                     break;
        //                 case "reset":
        //                     if (!game) {
        //                         server.sig.messageInstantSend(account, { type: "info", data: { err: "game not created yet" } })
        //                         return;
        //                     }
        //                     game.reset();
        //                     server.sig.messageInstantSend(game.gid, JSON.stringify({ type: "info", data: {} }));
        //                     break;
        //                 case "RequestChannelName":
        //                     if (!game) {
        //                         logger.info(`room not exist, create new...`);
        //                         quiz = json.QuestionLanguage === "0" ? "quiz-2" : "quiz-1";
        //                         encrypt = json.encrypt || null;
        //                         if (!cipher.supported.includes(encrypt)) {
        //                             encrypt = null;
        //                             logger.info(`ignore unsupported encrpyt method ${encrypt}`);
        //                         }
        //                         logger.info(`using quiz set ${quiz}`);
        //                         QuizFactory.load(quiz).then(result => {
        //                             server.add(new HQ.Game(account, "Test Game1", result, encrypt)).catch(_ => { });
        //                             logger.info(`game ${account} added`);
        //                             server.sig.messageInstantSend(account, JSON.stringify({ type: "channel", data: account }));
        //                         });
        //                     } else {
        //                         logger.info(`room exits, reuse ${game.gid}`);
        //                         game.reset();
        //                         encrypt = json.encrypt || null;
        //                         game.encrypt = encrypt;
        //                         server.sig.messageInstantSend(account, JSON.stringify({ type: "channel", data: account }));
        //                     }
        //                     break;
        //                 case "inviteRequest":
        //                     if (!game) {
        //                         logger.info(`room ${account} not exist, cannot invite`);
        //                         return;
        //                     }

        //                     if (!json.data || !json.data.uid) {
        //                         logger.info(`invitee not provided`)
        //                         return;
        //                     }

        //                     game.inviteRequest(json.data.uid).then(() => {
        //                         logger.info(`invite successfully sent to ${json.data.uid}`);
        //                     });

        //                     break;
        //             }
        //         };
        //         resolve();
        //     };
        //     server.sig.onLoginFailed = function () {
        //         logger.error(`agora cm login failed`);
        //         server.sig = null;
        //         reject("failed");
        //     };

        //     server.sig.onLogout = function () {
        //         logger.warn("Server has logged out");
        //         server.sig = null;
        //     };
        // });
    };
};

module.exports = HQ;