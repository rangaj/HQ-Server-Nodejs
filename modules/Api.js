const logger = require("./logger").get("hq");
const QuizFactory = require("./QuizFactory");
const HQ = require("./HQ");
let cipher = null;
try {
    cipher = require("./Encrypt");
} catch (e) {
    cipher = require("./FakeEncrypt");
}

function MasterApi(maker, app) {

    app.use(function (req, res, next) {
        logger.info(`incoming restful request: ${req.method}, ${req.url}, ${req.method === "GET" ? JSON.stringify(req.query) : JSON.stringify(req.body)}`);
        next();
    });

    app.get("/v1/vendor", (req, res) => {
        let vid = req.query.vid || null;
        if (!vid) {
            res.json({ err: "missing_vendor_id" });
            return;
        }
        res.json({
            err: "",
            ry_appid: "dummy_id"
        });
    });

    app.post("/v1/token", (req, res) => {
        let query = req.body;
        let uid = query.uid || null;
        let name = query.name || query.uid;

        if (!uid || !name) {
            res.json({ err: "info_missing" });
        } else {
            rongcloudSDK.user.getToken(uid, name, "", function (err, resultText) {
                if (err) {
                    // Handle the error
                    res.json({ err: "get_token_failed" });
                }
                else {
                    let result = JSON.parse(resultText);
                    if (result.code === 200) {
                        //Handle the result.token
                        logger.info(`user request token success: ${uid} ${name}`);
                        res.json({
                            uid: result.userId,
                            token: result.token
                        });
                    }
                }
            });
        }
    });

    app.post("/v1/reset", (req, res) => {
        let query = req.body;
        let gid = query.gid || null;

        if (!gid) {
            res.json({ err: "info_missing" });
        } else {
            let game = maker.get(gid);
            if (!game) {
                res.json({ err: "room_not_found" });
            } else {
                game.reset();
                res.json({});
            }
        }
    });

    app.post("/v1/inviteResponse", (req, res) => {
        let query = req.body;
        let account = query.account || null;
        let accept = query.accept || "false";
        let mediaUid = query.mediaUid || "";
        let gid = query.gid || "";

        if (!account || !mediaUid || !gid) {
            res.json({ err: "info_missing" });
            return;
        }

        accept = accept === "true";

        let game = maker.get(gid);
        if (!game) {
            res.json({ err: "room_not_found" });
        } else {
            logger.info(`api call invite response ${accept}`);
            game.inviteResponse(account, accept, mediaUid);
            res.json({ err: null });
        }

    });

    app.get("/v1/canplay", (req, res) => {
        let query = req.query;
        let gid = query.gid || null;
        let uid = query.uid || null;

        if (!gid || !uid) {
            res.json({ err: "info_missing" });
        } else {
            let game = maker.get(gid);
            if (!game) {
                res.json({ err: "room_not_found" });
            } else {
                res.json(game.canplay(uid));
            }
        }
    });

    app.post("/v1/relive", (req, res) => {
        let query = req.body;
        let gid = query.gid || null;
        let uid = query.uid || null;

        if (!gid || !uid) {
            res.json({ err: "info_missing" });
        } else {
            let game = maker.get(gid);
            if (!game) {
                res.json({ err: "room_not_found" });
            } else {
                game.relive(uid);
                res.json({});
            }
        }
    });

    app.post("/v1/publish", (req, res) => {
        let query = req.body;
        let gid = query.gid || null;

        if (!gid) {
            res.json({ err: "info_missing" });
        } else {
            let game = maker.get(gid);
            if (!game) {
                res.json({ err: "room_not_found" });
                return;
            }
            game.publish().then(result => {
                res.json({err: null, data: result});
            }).catch(e => {
                res.json({err: e});
            });
        }
    });

    app.post("/v1/stopAnswer", (req, res) => {
        let gid = query.gid || null;

        if (!gid) {
            res.json({ err: "missing_room_id" });
            return;
        }

        if (!game) {
            res.json({err: "room_not_exist"});
            return;
        }
        if (game.open) {
            game.closeQuiz();
            res.json({err: null});
        } else {
            res.json({err: "game_closed_already"});
        }
    });

    app.post("/v1/quiz", (req, res) => {
        let query = req.body;
        let gid = query.gid || null;
        let quiz = query.quiz || null;
        let timeout = query.timeout || 20;

        if (!gid || !quiz) {
            res.json({ err: "info_missing" });
            return;
        }

        let parsed = QuizFactory.parse(quiz);
        if (parsed.err) {
            res.json({ err: parsed.err });
        } else {
            //good quiz, set to channel
            let game = maker.get(gid);
            if (!game) {
                res.json({ err: "room_not_found" });
            } else {
                game.quizSet = parsed.data;
                logger.info(`updating quiz: ${JSON.stringify(game.quizSet)}`);
                game.timeout = timeout;
                game.reset();
                res.json({ err: null });
            }
        }
    });

    app.post("/v1/requestChannel", (req, res) => {
        let query = req.body;
        let gid = query.gid || "";
        let encrypt = query.encrypt || null;
        let lang = query.QuestionLanguage || "0";
        let quiz = "quiz-1";


        if (!gid) {
            res.json({ err: "missing_room_id" });
            return;
        }

        let game = maker.get(gid);

        if (!game) {
            logger.info(`room not exist, create new...`);
            quiz = lang === "0" ? "quiz-2" : "quiz-1";
            if (!cipher.supported.includes(encrypt)) {
                encrypt = null;
                logger.info(`ignore unsupported encrpyt method ${encrypt}`);
            }
            logger.info(`using quiz set ${quiz}`);
            QuizFactory.load(quiz).then(result => {
                maker.add(new HQ.Game(gid, "Test Game1", result, encrypt)).catch(_ => { });
                logger.info(`game ${gid} added`);
                res.json({ type: "channel", data: gid });
            });
        } else {
            logger.info(`room exits, reuse ${game.gid}`);
            game.encrypt = encrypt;
            game.reset();
            res.json({ type: "channel", data: gid });
        }
    });

    app.post("/v1/inviteRequest", (req, res) => {
        let query = req.body;
        let gid = query.gid || "";
        let uid = query.uid || "";

        if (!gid || !uid) {
            res.json({ err: "info_missing" })
            return;
        }
        let game = maker.get(gid);

        if (!game) {
            logger.info(`room ${gid} not exist, cannot invite`);
            res.json({ err: "room_not_exist" });
            return;
        }

        game.inviteRequest(uid).then(() => {
            logger.info(`invite successfully sent to ${uid}`);
            res.json({ err: null })
        });
    });



    app.post("/v1/answer", (req, res) => {
        let query = req.body;
        let uid = query.uid || null;
        let gid = query.gid || null;
        let sid = query.sid;
        let answer = query.result;

        logger.info(`will answer: ${uid} ${gid} ${sid} ${answer}`);
        if (!gid || sid === undefined || answer === undefined) {
            logger.info("info_missing");
            res.json({ err: "info_missing" });
        } else {
            let game = maker.get(gid);
            if (!game) {
                logger.info("room_not_found");
                res.json({ err: "room_not_found" });
            } else {
                if (parseInt(sid) !== parseInt(game.sequence)) {
                    logger.info(`mismatch quiz id given: ${sid}, current: ${game.sequence}`);
                    res.json({ err: "incorrect_quiz_id" });
                    return;
                }
                if (!game.open) {
                    logger.info(`game_closed`);
                    res.json({ err: "game_closed" });
                    return;
                }
                if (!game.canplay(uid)) {
                    logger.info(`cannot_play`);
                    res.json({ err: "cannot_play" });
                    return;
                }
                if (game.answerCommited(uid)) {
                    logger.info(`answer_given`);
                    res.json({ err: "answer_given" });
                    return;
                }

                logger.info(`passed check..`);
                game.commitanswer(uid, parseInt(answer));
                res.json({});
            }
        }
    });
}

function ClusterApi(app) {

}


module.exports = {
    cluster: ClusterApi,
    master: MasterApi
};