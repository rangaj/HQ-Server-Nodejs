const Signal = require("../modules/sig_agora")

if(process.argv.length !== 5){
    console.error("not enough args");
    exit(1);
}

const appid = process.argv[2];
const channel = process.argv[3];
const server_account = process.argv[4];

let signal  = new Signal(appid);
signal.setup_debugging('env', 'lbs100');
let session = signal.login(channel, "_no_need_token");
session.onLoginSuccess = function () {
    console.log("login successful");
    session.onMessageInstantReceive = (account, uid, msg) => {
        console.log(`msg received from ${account}: ${msg}`);
    };
    console.log(`message sent`);
    session.messageInstantSend(server_account, JSON.stringify({
        type: "RequestChannelName",
        QuestionLanguage:"1"
    }))

    let ch = session.channelJoin(channel);
    ch.onChannelJoined = function () {
        console.log(`channel joined`);

        ch.onMessageChannelReceive = (account, uid, msg) => {
            console.log(`channel msg received ${msg}`)
        };
        console.log(`start publish`);
        session.messageInstantSend(server_account, JSON.stringify({
            type: "publish"
        }))
    };
}