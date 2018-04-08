const logger = require("./logger").get("hq");
class MessageHandler{
    constructor(maker){
        this.midmap = {};
        this.maker = maker;
    }

    process(channel, mid, action, options){
        logger.info(`request ${channel} ${action} ${JSON.stringify(options)} ${ts}`);


        if(!channel || !ts || !action || options){
            logger.error(`request rejected, info missing`);
            return Promise.reject("info_missing");
        }

        if(!this.midmap[`${mid}`]){
            this.midmap[`${mid}`] = {
                ts: new Date()
            }
            logger.info(`process request ${mid} `);
            return this.maker.handle(action, options);
        } else {
            logger.info(`request omitted, ${mid} processed already`);
            //request omit but this is correct behavior
            return Promise.resolve();
        }
    }
}


module.exports = new MessageHandler();